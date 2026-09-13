// ============================================================================
// VOXEMBLY — DictationClient adapter (SERVER-SIDE ONLY).
//
// The ONE file that touches the AssemblyAI Dictation / Sync STT beta endpoint.
// Per the plan's §6.1 risk mitigation: all AssemblyAI calls are wrapped here so
// that if any beta parameter name drifts, exactly one file changes.
//
// Verified against AssemblyAI's official docs (Sync API technical walkthrough +
// Universal-3.5 Pro prompting guide):
//   • Endpoint:  POST https://sync[.<region>].assemblyai.com/transcribe
//   • Auth:      Authorization: <API_KEY>   (raw key, NOT "Bearer ...")
//   • Model:     header  X-AAI-Model: universal-3-5-pro
//   • Body:      multipart/form-data with an "audio" file part
//   • Prompt:    "prompt" (<=50 words natural language)
//   • Keyterms:  "keyterms_prompt" (up to 1000 phrases, <=6 words each)
//   • Language:  "language_code" (omit for auto-detect / code-switch)
//   • Limits:    80 ms .. 120 s clip, up to 40 MB, WAV / raw PCM
//   • Response:  { text, words[].confidence, confidence, audio_duration_ms,
//                  session_id, request_time_ms }
//   • Pre-warm:  a HEAD/GET to warm TLS+TCP while the user is still recording.
// ============================================================================

import type { AaiRegion, SyncTranscript, Word } from "@/lib/types";

/**
 * Hard limits from the Dictation API spec (80 ms .. 120 s clip, <=40 MB, WAV /
 * raw PCM; prompt <=50 words; keyterms <=1000 phrases, <=6 words each, <2048
 * chars). Both `minDurationMs`/`maxDurationMs` (client-facing) and the terse
 * MIN_MS/MAX_MS aliases are exposed so callers can use either name.
 */
export const LIMITS = {
  minDurationMs: 80,
  maxDurationMs: 120_000,
  MIN_MS: 80,
  MAX_MS: 120_000,
  MAX_BYTES: 40 * 1024 * 1024,
  MAX_KEYTERMS: 1000,
  MAX_KEYTERM_WORDS: 6,
  MAX_KEYTERMS_CHARS: 2048,
  MAX_PROMPT_WORDS: 50,
  MODEL: "universal-3-5-pro",
} as const;

function baseUrl(region: AaiRegion): string {
  switch (region) {
    case "us":
      return "https://sync.us.assemblyai.com";
    case "eu":
      return "https://sync.eu.assemblyai.com";
    default:
      return "https://sync.assemblyai.com";
  }
}

export interface DictationRequestConfig {
  prompt?: string;
  keyterms_prompt?: string[];
  language_code?: string | null;
  region?: AaiRegion;
}

export class DictationError extends Error {
  code: string;
  status?: number;
  retryable: boolean;
  constructor(code: string, message: string, status?: number, retryable = false) {
    super(message);
    this.name = "DictationError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Clamp a prompt to <= MAX_PROMPT_WORDS words. */
export function clampPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length <= LIMITS.MAX_PROMPT_WORDS) return prompt.trim();
  return words.slice(0, LIMITS.MAX_PROMPT_WORDS).join(" ");
}

/** Clamp keyterms to the API envelope (count, per-phrase words, total chars). */
export function clampKeyterms(keyterms: string[]): string[] {
  const out: string[] = [];
  let chars = 0;
  const seen = new Set<string>();
  for (let term of keyterms) {
    term = term.trim();
    if (!term) continue;
    // cap words per phrase
    const w = term.split(/\s+/);
    if (w.length > LIMITS.MAX_KEYTERM_WORDS) {
      term = w.slice(0, LIMITS.MAX_KEYTERM_WORDS).join(" ");
    }
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (out.length >= LIMITS.MAX_KEYTERMS) break;
    if (chars + term.length + 1 > LIMITS.MAX_KEYTERMS_CHARS) break;
    seen.add(key);
    out.push(term);
    chars += term.length + 1;
  }
  return out;
}

export class DictationClient {
  private apiKey: string;
  private defaultRegion: AaiRegion;

  constructor(apiKey: string, defaultRegion: AaiRegion = "global") {
    this.apiKey = apiKey;
    this.defaultRegion = defaultRegion;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  private endpoint(region: AaiRegion): string {
    return `${baseUrl(region)}/transcribe`;
  }

  /**
   * Pre-warm the connection to move DNS/TCP/TLS off the critical path.
   * Fired on key-down while the user is still recording.
   */
  async warm(region?: AaiRegion): Promise<{ ok: boolean; ms: number; region: AaiRegion; endpoint: string; reason?: string }> {
    const r = region ?? this.defaultRegion;
    const url = this.endpoint(r);
    const t0 = Date.now();
    if (!this.configured) {
      return { ok: false, ms: 0, region: r, endpoint: url, reason: "no_api_key" };
    }
    try {
      // A lightweight request establishes the connection pool. We accept any
      // HTTP response (even 4xx) because the goal is the handshake, not a body.
      await fetch(url, {
        method: "OPTIONS",
        headers: { Authorization: this.apiKey },
        // Keep it snappy — the handshake is what matters.
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined);
      return { ok: true, ms: Date.now() - t0, region: r, endpoint: url };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, region: r, endpoint: url, reason: String(e) };
    }
  }

  /**
   * Transcribe a clip via the Sync endpoint. Returns a normalized response.
   * Handles structured recovery: retries once on 503, backoff on 429, and
   * surfaces audio_too_short / audio_too_large as typed errors for callers.
   */
  async transcribe(
    audio: Blob | Buffer | ArrayBuffer | Uint8Array,
    cfg: DictationRequestConfig = {},
    filename = "clip.wav",
    contentType = "audio/wav",
  ): Promise<SyncTranscript & { region: AaiRegion; endpoint: string }> {
    if (!this.configured) {
      throw new DictationError("no_api_key", "ASSEMBLYAI_API_KEY is not set");
    }
    const region = cfg.region ?? this.defaultRegion;
    const url = this.endpoint(region);

    // Normalize audio into a Blob for multipart form data.
    const blob = toBlob(audio, contentType);
    if (blob.size > LIMITS.MAX_BYTES) {
      throw new DictationError(
        "audio_too_large",
        `Audio ${blob.size} bytes exceeds ${LIMITS.MAX_BYTES}. Route to pre-recorded STT.`,
      );
    }

    const form = new FormData();
    form.append("audio", blob, filename);
    if (cfg.prompt) form.append("prompt", clampPrompt(cfg.prompt));
    if (cfg.keyterms_prompt && cfg.keyterms_prompt.length) {
      // AssemblyAI accepts keyterms as a JSON array field.
      form.append("keyterms_prompt", JSON.stringify(clampKeyterms(cfg.keyterms_prompt)));
    }
    if (cfg.language_code) form.append("language_code", cfg.language_code);

    const doPost = async (): Promise<Response> =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: this.apiKey,
          "X-AAI-Model": LIMITS.MODEL,
        },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });

    let res: Response;
    try {
      res = await doPost();
      if (res.status === 503) {
        // retry once
        res = await doPost();
      } else if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 900));
        res = await doPost();
      }
    } catch (e) {
      throw new DictationError("network", `Dictation request failed: ${String(e)}`, undefined, true);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const code =
        res.status === 429
          ? "rate_limited"
          : res.status === 413
          ? "audio_too_large"
          : res.status === 400 && /short/i.test(bodyText)
          ? "audio_too_short"
          : `http_${res.status}`;
      throw new DictationError(code, bodyText || res.statusText, res.status, res.status >= 500);
    }

    const json: any = await res.json();
    return normalize(json, region, url);
  }
}

/** Convert any supported audio input into a Blob. */
function toBlob(audio: Blob | Buffer | ArrayBuffer | Uint8Array, contentType: string): Blob {
  if (audio instanceof Blob) return audio;
  if (audio instanceof ArrayBuffer) return new Blob([audio], { type: contentType });
  // Buffer / Uint8Array
  return new Blob([new Uint8Array(audio as Uint8Array)], { type: contentType });
}

/** Map the raw AAI Sync response into VOXEMBLY's normalized SyncTranscript. */
function normalize(
  json: any,
  region: AaiRegion,
  endpoint: string,
): SyncTranscript & { region: AaiRegion; endpoint: string } {
  const words: Word[] = Array.isArray(json?.words)
    ? json.words.map((w: any) => ({
        text: String(w.text ?? ""),
        confidence: typeof w.confidence === "number" ? w.confidence : 0.9,
        start: w.start,
        end: w.end,
      }))
    : [];
  return {
    text: String(json?.text ?? ""),
    words,
    confidence: typeof json?.confidence === "number" ? json.confidence : avgConf(words),
    audio_duration_ms:
      typeof json?.audio_duration_ms === "number"
        ? json.audio_duration_ms
        : typeof json?.audio_duration === "number"
        ? Math.round(json.audio_duration * 1000)
        : 0,
    session_id: String(json?.session_id ?? ""),
    request_time_ms: typeof json?.request_time_ms === "number" ? json.request_time_ms : 0,
    language_code: json?.language_code ?? null,
    region,
    endpoint,
  };
}

function avgConf(words: Word[]): number {
  if (!words.length) return 0.9;
  return words.reduce((a, w) => a + (w.confidence || 0), 0) / words.length;
}

/** Factory reading env; returns a client that may be unconfigured. */
export function getDictationClient(): DictationClient {
  const key = process.env.ASSEMBLYAI_API_KEY || "";
  const region = (process.env.NEXT_PUBLIC_AAI_REGION as AaiRegion) || "global";
  return new DictationClient(key, region);
}
