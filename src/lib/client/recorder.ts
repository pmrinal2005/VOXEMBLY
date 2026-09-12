/**
 * Push-to-Think capture (browser).
 *
 * The Sync API accepts WAV (`audio/wav`) or raw PCM S16LE (`audio/pcm`) — 16-bit only, mono or stereo,
 * at 8000/16000/22050/24000/32000/44100/48000 Hz, 80 ms–120 s, ≤40 MB.
 * `MediaRecorder` produces WebM/Opus, which is NOT accepted, so we capture Float32 PCM through the
 * WebAudio graph and encode 16 kHz mono S16LE ourselves (WAV for compatibility, raw PCM for ~15% less payload).
 *
 * Also provides an energy-based VAD (RMS + hangover) so Ambient Mode can segment continuous speech into
 * ≤90 s utterances that stay inside the documented 120 s ceiling, and so silent regions are trimmed.
 */

import { LIMITS } from "@/lib/dictation/client";

export const TARGET_SAMPLE_RATE = 16000;

export interface CaptureResult {
  wav: Blob;
  pcm: Blob;
  samples: Float32Array;
  durationMs: number;
  sampleRate: number;
  peak: number;
  rms: number;
  /** true when the whole clip was below the speech threshold */
  silent: boolean;
}

/** Linear-interpolation resampler to 16 kHz (the rate Universal-3.5 Pro is happiest with). */
export function resample(input: Float32Array, from: number, to = TARGET_SAMPLE_RATE): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Float32 [-1,1] → 16-bit little-endian PCM. */
export function floatToPCM16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Wrap S16LE PCM in a 44-byte RIFF/WAVE header — sample rate + channels live in the header. */
export function encodeWAV(pcm: ArrayBuffer, sampleRate = TARGET_SAMPLE_RATE, channels = 1): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  const byteRate = sampleRate * channels * 2;
  wstr(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // format = PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, channels * 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample — 16-bit only
  wstr(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  return new Blob([header, pcm], { type: "audio/wav" });
}

export function rmsOf(x: Float32Array): number {
  if (!x.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}

export function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** Trim leading/trailing silence, keeping a short pad so word onsets survive. */
export function trimSilence(x: Float32Array, threshold = 0.01, padMs = 120, sampleRate = TARGET_SAMPLE_RATE): Float32Array {
  const win = Math.max(1, Math.floor(sampleRate * 0.02));
  const pad = Math.floor((padMs / 1000) * sampleRate);
  let start = 0;
  let end = x.length;
  for (let i = 0; i + win <= x.length; i += win) {
    if (rmsOf(x.subarray(i, i + win)) > threshold) {
      start = Math.max(0, i - pad);
      break;
    }
  }
  for (let i = x.length - win; i >= 0; i -= win) {
    if (rmsOf(x.subarray(i, i + win)) > threshold) {
      end = Math.min(x.length, i + win + pad);
      break;
    }
  }
  return end > start ? x.slice(start, end) : x;
}

const SPEECH_RMS = 0.006;

/**
 * PushToTalkRecorder — one long-lived AudioContext + MediaStream so key-down is instant
 * (permission and graph setup are paid once, not per utterance).
 */
export class PushToTalkRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private startedAt = 0;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array | null = null;

  /** Ambient Mode segmentation state */
  private vadVoiced = false;
  private vadSilenceMs = 0;
  private vadVoicedMs = 0;

  onLevel?: (level: number) => void;
  /** Fired in Ambient Mode when a natural utterance boundary is detected. */
  onUtterance?: (result: CaptureResult) => void;
  onMaxDuration?: () => void;

  ambient = false;
  /** stay well inside the documented 120 s ceiling */
  maxUtteranceMs = 90_000;
  silenceHangoverMs = 700;
  minUtteranceMs = 320;

  get isRecording() {
    return this.recording;
  }
  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }
  get elapsedMs() {
    return this.recording ? Date.now() - this.startedAt : 0;
  }

  /** Call on app open / first interaction: acquires the mic and builds the graph once. */
  async prepare(): Promise<void> {
    if (this.ctx && this.stream) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.levelBuf = new Uint8Array(this.analyser.frequencyBinCount);
    this.source.connect(this.analyser);

    // ScriptProcessor is deprecated but universally available and needs no separate worklet file —
    // the right trade-off for a $0, single-file build. Buffer 2048 ≈ 43 ms at 48 kHz.
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => this.onAudio(e);
    this.source.connect(this.node);
    // Zero-gain sink: keeps the graph pulling without echoing the mic to the speakers.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
  }

  private onAudio(e: AudioProcessingEvent) {
    const input = e.inputBuffer.getChannelData(0);
    const frameMs = (input.length / this.sampleRate) * 1000;
    const level = rmsOf(input);
    this.onLevel?.(Math.min(1, level * 12));

    if (this.recording) {
      this.chunks.push(new Float32Array(input));
      if (this.elapsedMs >= LIMITS.maxDurationMs - 2000) {
        this.onMaxDuration?.();
        return;
      }
    }

    if (!this.ambient) return;

    // ── Ambient Mode VAD: RMS gate + hangover, cutting utterances at natural pauses ──
    const voiced = level > SPEECH_RMS;
    if (voiced) {
      if (!this.vadVoiced) {
        this.vadVoiced = true;
        this.vadVoicedMs = 0;
        this.vadSilenceMs = 0;
        if (!this.recording) this.start();
      }
      this.vadVoicedMs += frameMs;
      this.vadSilenceMs = 0;
    } else if (this.vadVoiced) {
      this.vadSilenceMs += frameMs;
    }

    const tooLong = this.recording && this.elapsedMs >= this.maxUtteranceMs;
    const settled = this.vadVoiced && this.vadSilenceMs >= this.silenceHangoverMs;
    if (this.recording && (tooLong || settled)) {
      this.vadVoiced = false;
      this.vadSilenceMs = 0;
      const result = this.stop();
      if (result && result.durationMs >= this.minUtteranceMs && !result.silent) this.onUtterance?.(result);
    }
  }

  /** Instantaneous mic level (0..1) for the Orb's confidence ring. */
  level(): number {
    if (!this.analyser || !this.levelBuf) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const v = (this.levelBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 4);
  }

  start() {
    this.chunks = [];
    this.recording = true;
    this.startedAt = Date.now();
  }

  /** Stop and encode. Returns null if nothing was captured. */
  stop(): CaptureResult | null {
    if (!this.recording) return null;
    this.recording = false;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    if (!total) return null;

    const raw = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) {
      raw.set(c, off);
      off += c.length;
    }
    this.chunks = [];

    const down = resample(raw, this.sampleRate, TARGET_SAMPLE_RATE);
    const trimmed = trimSilence(down);
    const samples = trimmed.length > TARGET_SAMPLE_RATE * 0.05 ? trimmed : down;
    const pcmBuf = floatToPCM16(samples);
    const durationMs = Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000);
    const rms = rmsOf(samples);

    return {
      wav: encodeWAV(pcmBuf, TARGET_SAMPLE_RATE, 1),
      pcm: new Blob([pcmBuf], { type: "audio/pcm" }),
      samples,
      durationMs,
      sampleRate: TARGET_SAMPLE_RATE,
      peak: peakOf(samples),
      rms,
      silent: rms < SPEECH_RMS * 0.6,
    };
  }

  setAmbient(on: boolean) {
    this.ambient = on;
    this.vadVoiced = false;
    this.vadSilenceMs = 0;
    if (!on && this.recording) this.stop();
  }

  /** Release the mic (settings toggle / page unload). */
  dispose() {
    this.recording = false;
    this.chunks = [];
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      this.analyser?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.ctx?.close();
    } catch {
      /* already torn down */
    }
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.analyser = null;
  }
}

/** Downsampled waveform peaks for the published-artifact waveform. */
export function waveformPeaks(samples: Float32Array, buckets = 120): number[] {
  if (!samples.length) return new Array(buckets).fill(0);
  const size = Math.floor(samples.length / buckets) || 1;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    out.push(Math.min(1, peakOf(samples.subarray(i * size, (i + 1) * size))));
  }
  return out;
}
