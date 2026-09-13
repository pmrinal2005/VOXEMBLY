"use client";

import { LIMITS } from "@/lib/dictation/client";

export interface CaptureResult {
  wav: Blob;
  pcm: Blob;
  samples: Float32Array;
  durationMs: number;
  sampleRate: number;
  peak: number;
  rms: number;
  silent: boolean;
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
  private _recording = false;
  private _ambient = false;
  private _level = 0;
  private silenceMs = 0;
  private utteranceAcc: Float32Array[] = [];
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  onLevel?: (level: number) => void;
  onMaxDuration?: () => void;
  onUtterance?: (res: CaptureResult) => void;

  get isRecording() {
    return this._recording;
  }
  get elapsedMs() {
    return this._recording ? Date.now() - this.startedAt : 0;
  }
  level() {
    return this._level;
  }

  async prepare(): Promise<void> {
    if (this.stream && this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx();
    this.recordingRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input);
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < copy.length; i++) {
        const v = Math.abs(copy[i]);
        if (v > peak) peak = v;
        sum += copy[i] * copy[i];
      }
      const rms = Math.sqrt(sum / copy.length);
      this._level = Math.min(1, rms * 4);
      this.onLevel?.(this._level);

      if (!this._recording && !this._ambient) return;
      this.chunks.push(copy);

      if (this._ambient) {
        this.utteranceAcc.push(copy);
        const frameMs = (copy.length / this.recordingRate) * 1000;
        if (rms < 0.012) this.silenceMs += frameMs;
        else this.silenceMs = 0;
        const accLen = this.utteranceAcc.reduce((a, c) => a + c.length, 0);
        const accMs = (accLen / this.recordingRate) * 1000;
        if ((this.silenceMs > 700 && accMs > 400) || accMs > 90_000) {
          const merged = mergeChunks(this.utteranceAcc);
          this.utteranceAcc = [];
          this.silenceMs = 0;
          const cap = finalize(merged, this.recordingRate);
          if (!cap.silent && cap.durationMs >= LIMITS.minDurationMs) this.onUtterance?.(cap);
        }
      }
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  start(): void {
    this.chunks = [];
    this.startedAt = Date.now();
    this._recording = true;
    this.silenceMs = 0;
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.maxTimer = setTimeout(() => {
      this.onMaxDuration?.();
    }, LIMITS.maxDurationMs);
  }

  stop(): CaptureResult | null {
    this._recording = false;
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    const merged = mergeChunks(this.chunks);
    this.chunks = [];
    if (!merged.length) return null;
    return finalize(merged, this.recordingRate);
  }

  setAmbient(on: boolean) {
    this._ambient = on;
    this.utteranceAcc = [];
    this.silenceMs = 0;
    if (!on) this._recording = false;
  }

  dispose() {
    this._recording = false;
    this._ambient = false;
    if (this.maxTimer) clearTimeout(this.maxTimer);
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
    this.stream = null;
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
  for (let i = 0; i < newLen; i++) out[i] = buffer[Math.floor(i * ratio)];
  return out;
}

function vadTrim(buffer: Float32Array, rate: number): Float32Array {
  if (buffer.length === 0) return buffer;
  const win = Math.floor(rate * 0.02);
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
  if (first === -1) return buffer;
  const hang = Math.floor(rate * 0.2);
  return buffer.slice(Math.max(0, first - hang), Math.min(buffer.length, last + hang));
}

function encodeWav(samples: Float32Array, rate: number): Blob {
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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

function encodePcm(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/pcm" });
}

function finalize(raw: Float32Array, fromRate: number): CaptureResult {
  const down = downsample(raw, fromRate, TARGET_RATE);
  const trimmed = vadTrim(down, TARGET_RATE);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const v = Math.abs(trimmed[i]);
    if (v > peak) peak = v;
    sum += trimmed[i] * trimmed[i];
  }
  const rms = trimmed.length ? Math.sqrt(sum / trimmed.length) : 0;
  const durationMs = Math.round((trimmed.length / TARGET_RATE) * 1000);
  return {
    wav: encodeWav(trimmed, TARGET_RATE),
    pcm: encodePcm(trimmed),
    samples: trimmed,
    durationMs,
    sampleRate: TARGET_RATE,
    peak,
    rms,
    silent: peak < 0.01,
  };
}

export function waveformPeaks(samples: Float32Array | number, bins = 64): number[] {
  if (typeof samples === "number") {
    const out: number[] = [];
    let s = samples;
    for (let i = 0; i < bins; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      out.push(0.15 + r * 0.85 * Math.sin((i / bins) * Math.PI));
    }
    return out;
  }
  if (!samples.length) return new Array(bins).fill(0);
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
