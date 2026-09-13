// ============================================================================
// DictationClient — the single adapter around AssemblyAI's beta Dictation /
// Sync STT endpoint. Per §6.1 of the brief, ALL Dictation calls flow through
// here, so if a beta parameter name drifts, only this file changes.
//
// Endpoint:   POST https://sync.<region>.assemblyai.com/transcribe
// Model:      header  X-AAI-Model: universal-3-5-pro
// Pre-warm:   GET  https://sync.<region>.assemblyai.com/warm
// Fields:     prompt, keyterms_prompt, language_code
// Consumed:   text, words[].confidence, confidence, audio_duration_ms,
//             session_id, request_time_ms
// ============================================================================

import type { DictationResponse, WordConfidence } from "./types";

export type Region = "us" | "eu" | "global";

const MODEL_HEADER = "universal-3-5-pro";

export function regionHost(region: Region): string {
  switch (region) {
    case "us":
      return "https://sync.us.assemblyai.com";
    case "eu":
      return "https://sync.eu.assemblyai.com";
    default:
      return "https://sync.assemblyai.com";
  }
}

export interface TranscribeParams {
  apiKey: string;
  region: Region;
  audio: Buffer | Uint8Array | ArrayBuffer;
  contentType?: string; // audio/wav default
  prompt?: string;
  keyterms_prompt?: string[];
  language_code?: string;
}

export class DictationError extends Error {
  code:
    | "audio_too_short"
    | "audio_too_large"
    | "rate_limited"
    | "unavailable"
    | "unauthorized"
    | "unknown";
  status?: number;
  constructor(code: DictationError["code"], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "DictationError";
  }
}

// Pre-warm the connection pool (TLS/TCP handshake) — the 350ms→134ms trick.
export async function warm(region: Region, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${regionHost(region)}/warm`, {
      method: "GET",
      headers: { authorization: apiKey },
      // Keep it snappy; warming should never block the UX.
      signal: AbortSignal.timeout(2500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function classifyStatus(status: number): DictationError["code"] {
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "audio_too_large";
  if (status === 400) return "audio_too_short";
  return "unknown";
}

// Core transcribe call with retry (once on 503) and normalized response.
export async function transcribe(
  p: TranscribeParams
): Promise<DictationResponse> {
  const host = regionHost(p.region);
  const bytes =
    p.audio instanceof ArrayBuffer ? new Uint8Array(p.audio) : p.audio;

  // The Dictation beta accepts the audio body directly with query/form
  // configuration. We send a multipart form so prompt/keyterms travel with it.
  const form = new FormData();
  const blob = new Blob([bytes as BlobPart], {
    type: p.contentType ?? "audio/wav",
  });
  form.append("audio", blob, "dictation.wav");
  if (p.prompt) form.append("prompt", p.prompt);
  if (p.keyterms_prompt && p.keyterms_prompt.length) {
    form.append("keyterms_prompt", JSON.stringify(p.keyterms_prompt));
  }
  if (p.language_code) form.append("language_code", p.language_code);

  const doPost = async (): Promise<Response> =>
    fetch(`${host}/transcribe`, {
      method: "POST",
      headers: {
        authorization: p.apiKey,
        "X-AAI-Model": MODEL_HEADER,
      },
      body: form,
      signal: AbortSignal.timeout(30000),
    });

  const t0 = Date.now();
  let res = await doPost();

  // Retry once on transient unavailability.
  if (res.status === 503) {
    await new Promise((r) => setTimeout(r, 400));
    res = await doPost();
  }

  if (!res.ok) {
    const code = classifyStatus(res.status);
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new DictationError(code, detail || `HTTP ${res.status}`, res.status);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return normalize(raw, Date.now() - t0);
}

// Normalize the (possibly-drifting) beta response into our stable shape.
function normalize(raw: Record<string, unknown>, roundTripMs: number): DictationResponse {
  const wordsRaw = (raw.words as unknown[]) ?? [];
  const words: WordConfidence[] = wordsRaw.map((w) => {
    const o = w as Record<string, unknown>;
    return {
      text: String(o.text ?? ""),
      confidence: Number(o.confidence ?? 1),
      start: o.start != null ? Number(o.start) : undefined,
      end: o.end != null ? Number(o.end) : undefined,
    };
  });

  return {
    text: String(raw.text ?? ""),
    words,
    confidence: Number(raw.confidence ?? averageConfidence(words)),
    audio_duration_ms:
      raw.audio_duration_ms != null ? Number(raw.audio_duration_ms) : undefined,
    session_id: raw.session_id != null ? String(raw.session_id) : undefined,
    request_time_ms:
      raw.request_time_ms != null ? Number(raw.request_time_ms) : roundTripMs,
    language_code:
      raw.language_code != null ? String(raw.language_code) : undefined,
  };
}

function averageConfidence(words: WordConfidence[]): number {
  if (!words.length) return 1;
  return words.reduce((a, w) => a + w.confidence, 0) / words.length;
}
