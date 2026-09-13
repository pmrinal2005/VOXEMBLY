"use client";

// ============================================================================
// VOXEMBLY — Push-to-Talk recorder (CLIENT-SIDE).
//
// Captures mic audio via WebAudio, downsamples to 16 kHz mono, and encodes to
// 16-bit PCM WAV — the format blessed by the Dictation API. Includes a simple
// energy-based VAD trim (silence hangover) to cut leading/trailing silence,
// standing in for the Silero-VAD-WASM path described in the plan.
// ============================================================================

import { LIMITS } from "@/lib/dictation/client";

export interface CaptureResult {
  wav: Blob;
  durationMs: number;
  peaks: number[]; // downsampled waveform for visualization
  sampleRate: number;
  tooShort: boolean;
}

const TARGET_RATE = 16000;

export class PushToTalkRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recordingRate = 48000;
  private startedAt = 0;
  private levelCb?: (level: number) => void;

  get supported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      (typeof AudioContext !== "undefined" ||
        typeof (globalThis as any).webkitAudioContext !== "undefined")
    );
  }

  onLevel(cb: (level: number) => void) {
    this.levelCb = cb;
  }

  async start(): Promise<void> {
    if (!this.supported) throw new Error("mic_unsupported");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const Ctx =
      (typeof AudioContext !== "undefined"
        ? AudioContext
        : (globalThis as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx();
    this.recordingRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is deprecated but universally supported and needs no
    // worklet file — ideal for a zero-build, Vercel-friendly capture path.
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.startedAt = Date.now();

    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
      if (this.levelCb) {
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        this.levelCb(Math.min(1, Math.sqrt(sum / input.length) * 4));
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
  }

  async stop(): Promise<CaptureResult> {
    const durationMs = Date.now() - this.startedAt;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();

    const merged = mergeChunks(this.chunks);
    const down = downsample(merged, this.recordingRate, TARGET_RATE);
    const trimmed = vadTrim(down, TARGET_RATE);
    const wav = encodeWav(trimmed, TARGET_RATE);
    const peaks = computePeaks(trimmed, 64);
    const realDur = Math.round((trimmed.length / TARGET_RATE) * 1000);

    this.chunks = [];
    this.ctx = null;
    this.stream = null;

    return {
      wav,
      durationMs: realDur || durationMs,
      peaks,
      sampleRate: TARGET_RATE,
      tooShort: (realDur || durationMs) < LIMITS.MIN_MS,
    };
  }

  cancel() {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") this.ctx.close();
    } catch {
      /* noop */
    }
    this.chunks = [];
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(buffer: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buffer;
  const ratio = from / to;
  const newLen = Math.floor(buffer.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = Math.floor(i * ratio);
    out[i] = buffer[idx];
  }
  return out;
}

/** Energy-based VAD trim: drop leading/trailing silence, keep a hangover. */
function vadTrim(buffer: Float32Array, rate: number): Float32Array {
  if (buffer.length === 0) return buffer;
  const win = Math.floor(rate * 0.02); // 20ms windows
  const threshold = 0.008;
  let first = -1;
  let last = -1;
  for (let i = 0; i < buffer.length; i += win) {
    let sum = 0;
    const end = Math.min(i + win, buffer.length);
    for (let j = i; j < end; j++) sum += buffer[j] * buffer[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms > threshold) {
      if (first === -1) first = i;
      last = end;
    }
  }
  if (first === -1) return buffer; // all quiet — keep as-is
  const hang = Math.floor(rate * 0.2); // 200ms hangover
  const s = Math.max(0, first - hang);
  const e = Math.min(buffer.length, last + hang);
  return buffer.slice(s, e);
}

/** Encode Float32 mono samples into a 16-bit PCM WAV Blob. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

/** Peaks for the waveform visualization. */
export function computePeaks(samples: Float32Array, bins: number): number[] {
  if (samples.length === 0) return new Array(bins).fill(0);
  const size = Math.floor(samples.length / bins) || 1;
  const peaks: number[] = [];
  for (let b = 0; b < bins; b++) {
    let max = 0;
    const start = b * size;
    const end = Math.min(start + size, samples.length);
    for (let i = start; i < end; i++) max = Math.max(max, Math.abs(samples[i]));
    peaks.push(max);
  }
  return peaks;
}

/** Random peaks (for the demo/simulated path). */
export function waveformPeaks(bins = 64, seed = Math.random()): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < bins; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const env = Math.sin((i / bins) * Math.PI);
    out.push(0.15 + r * 0.85 * env);
  }
  return out;
}
