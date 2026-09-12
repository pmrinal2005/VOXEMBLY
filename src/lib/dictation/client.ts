/**
 * DictationClient — the single adapter around AssemblyAI Sync STT ("Dictation API").
 *
 * Grounded in the official docs:
 *  - POST https://sync{,.us,.eu}.assemblyai.com/transcribe     (multipart: `audio` + optional `config` JSON part)
 *  - Header `X-AAI-Model: universal-3-5-pro` is REQUIRED on every request (also on /warm)
 *  - `Authorization: <API_KEY>` (no Bearer prefix needed; Bearer is also accepted)
 *  - `audio` part content-type: `audio/wav` or `audio/pcm` (S16LE; requires config.sample_rate + config.channels)
 *  - config: prompt (≤6000 chars), keyterms_prompt (≤100 terms / ≤8000 chars), language_code (string | string[]),
 *            conversation_context (string | string[] ≤500 turns / 16000 chars), timestamps (bool), sample_rate, channels
 *  - `language_code` is IGNORED when a custom `prompt` is set → we state languages inside the prompt.
 *  - GET /warm is an unauthenticated no-op that pre-establishes DNS/TCP/TLS.
 *  - Errors: 400 bad_audio | audio_too_short | bad_request, 413 audio_too_large, 415 unsupported_media_type,
 *            429 (Retry-After), 503 capacity_exceeded | service_unavailable (Retry-After), 504 inference_timeout, 500 inference_error
 *
 * All beta-parameter names live in this one file (feature-flagged) so drift is a one-file fix.
 */

import type { SyncRegion, SyncTranscript } from "@/lib/types";

export const SYNC_MODEL = "universal-3-5-pro" as const;

export const SYNC_ENDPOINTS: Record<SyncRegion, string> = {
  global: "https://sync.assemblyai.com",
  us: "https://sync.us.assemblyai.com",
  eu: "https://sync.eu.assemblyai.com",
};

export const PRERECORDED_ENDPOINTS: Record<SyncRegion, string> = {
  global: "https://api.assemblyai.com",
  us: "https://api.assemblyai.com",
  eu: "https://api.eu.assemblyai.com",
};

/** Beta field names — flip here if the API drifts. */
export const FIELD = {
  prompt: "prompt",
  keyterms: "keyterms_prompt",
  language: "language_code",
  context: "conversation_context",
  timestamps: "timestamps",
  sampleRate: "sample_rate",
  channels: "channels",
} as const;

export const LIMITS = {
  minDurationMs: 80,
  maxDurationMs: 120_000,
  maxBytes: 40 * 1024 * 1024,
  promptMaxChars: 6000,
  keytermsMaxTerms: 100,
  keytermsMaxChars: 8000,
  keytermMaxWords: 6,
  contextMaxTurns: 500,
  contextMaxChars: 16000,
  sampleRates: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
} as const;

/**
 * Verified against the live docs (Sync STT error handling table):
 *  400 bad_audio | audio_too_short | bad_request, 401 (detail), 413 audio_too_large,
 *  415 unsupported_media_type, 429 (Retry-After), 503 capacity_exceeded | service_unavailable,
 *  504 inference_timeout (30 s server deadline), 500 inference_error.
 * 400/413/415 are request-side: never blind-retry them.
 */
export const TERMINAL_CODES = new Set(["bad_audio", "audio_too_short", "bad_request", "unsupported_media_type", "unauthorized"]);

/** Human-readable recovery hints surfaced in the UI instead of a raw error. */
export const ERROR_HINTS: Record<string, string> = {
  audio_too_short: "That was under 80 ms — hold the key a little longer.",
  bad_audio: "The clip was malformed. Re-record as 16-bit WAV.",
  bad_request: "The dictation config exceeded a field limit. Trimming and retrying.",
  unsupported_media_type: "Unsupported audio format — VOXEMBLY needs 16-bit WAV or PCM S16LE.",
  audio_too_large: "Over 120 s / 40 MB — routed to the Long-form Thoughtform pathway.",
  unauthorized: "ASSEMBLYAI_API_KEY is missing or invalid.",
  rate_limited: "AssemblyAI rate limit hit — retrying with backoff.",
  capacity_exceeded: "AssemblyAI is at capacity — retrying shortly.",
  service_unavailable: "Model is warming up (cold start) — retrying.",
  inference_timeout: "The request exceeded the 30 s server deadline.",
  inference_error: "Internal model error — retried once.",
};

export interface DictationConfig {
  prompt?: string;
  keyterms_prompt?: string[];
  language_code?: string | string[];
  conversation_context?: string[];
  timestamps?: boolean;
  /** only for raw PCM */
  sample_rate?: number;
  channels?: 1 | 2;
}

export interface DictationRequest {
  audio: ArrayBuffer | Uint8Array;
  contentType: "audio/wav" | "audio/pcm";
  config?: DictationConfig;
  region?: SyncRegion;
  /** approximate duration (ms) if the client knows it — used to pre-route >120s clips */
  durationHintMs?: number;
}

export interface DictationResult {
  transcript: SyncTranscript;
  route: "sync" | "prerecorded";
  retries: number;
  proxy_ms: number;
  endpoint: string;
  region: SyncRegion;
  warmed: boolean;
}

export class DictationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
    public sessionId?: string,
  ) {
    super(message);
    this.name = "DictationError";
  }
  toJSON() {
    return { status: this.status, code: this.code, message: this.message, retryAfter: this.retryAfter, sessionId: this.sessionId };
  }
}

/** Normalise config against documented limits before it leaves the process. */
export function sanitizeConfig(cfg: DictationConfig | undefined): DictationConfig | undefined {
  if (!cfg) return undefined;
  const out: DictationConfig = {};

  if (cfg.prompt && cfg.prompt.trim()) {
    out.prompt = cfg.prompt.trim().slice(0, LIMITS.promptMaxChars);
  }

  if (cfg.keyterms_prompt?.length) {
    const seen = new Set<string>();
    const terms: string[] = [];
    let chars = 0;
    for (const raw of cfg.keyterms_prompt) {
      const t = String(raw ?? "").trim();
      if (!t) continue;
      if (t.split(/\s+/).length > LIMITS.keytermMaxWords) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      if (terms.length >= LIMITS.keytermsMaxTerms) break;
      if (chars + t.length > LIMITS.keytermsMaxChars) break;
      seen.add(key);
      terms.push(t);
      chars += t.length;
    }
    if (terms.length) out.keyterms_prompt = terms;
  }

  // language_code is ignored when prompt is set (docs) — the Prompt Composer already names
  // the languages in the prose. We still pass it through for the no-prompt path.
  if (cfg.language_code && !out.prompt) {
    out.language_code = cfg.language_code;
  }

  if (cfg.conversation_context?.length) {
    let turns = cfg.conversation_context.map((s) => String(s ?? "").trim()).filter(Boolean);
    turns = turns.slice(-LIMITS.contextMaxTurns);
    let total = turns.reduce((a, b) => a + b.length, 0);
    while (turns.length && total > LIMITS.contextMaxChars) {
      total -= turns.shift()!.length;
    }
    if (turns.length) out.conversation_context = turns;
  }

  if (cfg.timestamps) out.timestamps = true;
  if (cfg.sample_rate) out.sample_rate = cfg.sample_rate;
  if (cfg.channels) out.channels = cfg.channels;

  return Object.keys(out).length ? out : undefined;
}

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) ? n : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DictationClient {
  private apiKey: string;
  private defaultRegion: SyncRegion;
  private lastWarm: Record<SyncRegion, number> = { global: 0, us: 0, eu: 0 };

  constructor(apiKey: string | undefined, region: SyncRegion = "global") {
    if (!apiKey) throw new DictationError(500, "missing_api_key", "ASSEMBLYAI_API_KEY is not configured");
    this.apiKey = apiKey;
    this.defaultRegion = region;
  }

  endpointFor(region: SyncRegion = this.defaultRegion) {
    return SYNC_ENDPOINTS[region] ?? SYNC_ENDPOINTS.global;
  }

  /**
   * GET /warm — unauthenticated no-op. Forces DNS + TCP + TLS so the next /transcribe reuses the pooled
   * connection (Node's undici agent keeps it alive). Same X-AAI-Model header so the warmed path matches.
   */
  async warm(region: SyncRegion = this.defaultRegion): Promise<{ ok: boolean; ms: number; region: SyncRegion; endpoint: string }> {
    const endpoint = this.endpointFor(region);
    const t0 = performance.now();
    try {
      const res = await fetch(`${endpoint}/warm`, {
        method: "GET",
        headers: { "X-AAI-Model": SYNC_MODEL },
        keepalive: true,
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      this.lastWarm[region] = Date.now();
      return { ok: res.ok || res.status < 500, ms: Math.round(performance.now() - t0), region, endpoint };
    } catch {
      return { ok: false, ms: Math.round(performance.now() - t0), region, endpoint };
    }
  }

  wasWarmedRecently(region: SyncRegion = this.defaultRegion, withinMs = 90_000) {
    return Date.now() - this.lastWarm[region] < withinMs;
  }

  /** POST /transcribe with structured recovery. */
  async transcribe(req: DictationRequest): Promise<DictationResult> {
    const region = req.region ?? this.defaultRegion;
    const endpoint = this.endpointFor(region);
    const bytes = req.audio instanceof Uint8Array ? req.audio : new Uint8Array(req.audio);
    const cfg = sanitizeConfig(req.config);

    // Pre-route: clips the client already knows are >120s / >40MB go straight to Pre-recorded STT.
    if (bytes.byteLength > LIMITS.maxBytes || (req.durationHintMs ?? 0) > LIMITS.maxDurationMs) {
      return this.transcribePrerecorded(bytes, req.contentType, cfg, region, 0);
    }

    if (req.contentType === "audio/pcm" && (!cfg?.sample_rate || !cfg?.channels)) {
      throw new DictationError(400, "bad_audio", "Raw PCM requires config.sample_rate and config.channels");
    }

    // `audio_too_short`: a <80 ms key tap is a user slip, not an error — swallow it before it costs a request.
    if ((req.durationHintMs ?? Infinity) < LIMITS.minDurationMs) {
      throw new DictationError(400, "audio_too_short", ERROR_HINTS.audio_too_short);
    }

    let retries = 0;
    let cfgInFlight = cfg;
    const t0 = performance.now();
    const warmed = this.wasWarmedRecently(region);

    for (;;) {
      const form = new FormData();
      form.append("audio", new Blob([bytes as BlobPart], { type: req.contentType }), req.contentType === "audio/wav" ? "dictation.wav" : "dictation.pcm");
      if (cfgInFlight) form.append("config", new Blob([JSON.stringify(cfgInFlight)], { type: "application/json" }), "config.json");

      let res: Response;
      try {
        res = await fetch(`${endpoint}/transcribe`, {
          method: "POST",
          headers: { Authorization: this.apiKey, "X-AAI-Model": SYNC_MODEL },
          body: form,
          keepalive: true,
          cache: "no-store",
          signal: AbortSignal.timeout(40_000),
        });
      } catch (e) {
        if (retries < 1) {
          retries++;
          await sleep(300);
          continue;
        }
        throw new DictationError(502, "network_error", (e as Error).message);
      }

      if (res.ok) {
        const json = (await res.json()) as SyncTranscript;
        return {
          transcript: json,
          route: "sync",
          retries,
          proxy_ms: Math.round(performance.now() - t0),
          endpoint,
          region,
          warmed,
        };
      }

      let body: { error_code?: string; detail?: string; message?: string; session_id?: string } = {};
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      const code = body.error_code ?? (res.status === 429 ? "rate_limited" : res.status === 401 ? "unauthorized" : `http_${res.status}`);
      const retryAfter = parseRetryAfter(res);

      // 413 audio_too_large → Long-form Thoughtform pathway (Pre-recorded STT).
      if (res.status === 413 || code === "audio_too_large") {
        return this.transcribePrerecorded(bytes, req.contentType, cfgInFlight, region, retries);
      }

      // 400 bad_request can mean "config field limits exceeded" — the Prompt Composer is memory-driven and
      // can grow. Shed the optional context/keyterms once and retry rather than losing the utterance.
      if (res.status === 400 && code === "bad_request" && cfgInFlight && retries < 1) {
        retries++;
        cfgInFlight = sanitizeConfig({ prompt: cfgInFlight.prompt, timestamps: cfgInFlight.timestamps, sample_rate: cfgInFlight.sample_rate, channels: cfgInFlight.channels });
        continue;
      }

      // 429 / 503 are transient — honour Retry-After, exponential backoff, cap at 2 retries.
      if ((res.status === 429 || res.status === 503) && retries < 2) {
        retries++;
        const wait = retryAfter ? retryAfter * 1000 : 400 * 2 ** retries;
        await sleep(Math.min(wait, 4000));
        continue;
      }
      // 500 / 504 safe to retry once.
      if ((res.status === 500 || res.status === 504) && retries < 1) {
        retries++;
        await sleep(500);
        continue;
      }

      throw new DictationError(res.status, code, ERROR_HINTS[code] ?? body.detail ?? body.message ?? `Sync STT failed (${code})`, retryAfter, body.session_id);
    }
  }

  /**
   * Long-form pathway: Pre-recorded STT (upload → transcript → poll) with the same model + prompt/keyterms.
   * Only used when Sync rejects the clip as audio_too_large.
   */
  private async transcribePrerecorded(
    bytes: Uint8Array,
    contentType: "audio/wav" | "audio/pcm",
    cfg: DictationConfig | undefined,
    region: SyncRegion,
    retries: number,
  ): Promise<DictationResult> {
    const base = PRERECORDED_ENDPOINTS[region];
    const t0 = performance.now();
    if (contentType === "audio/pcm") {
      throw new DictationError(413, "audio_too_large", "Clip exceeds 120 s. Raw PCM long-form is not supported — re-record as WAV.");
    }
    const up = await fetch(`${base}/v2/upload`, {
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/octet-stream" },
      body: bytes as BodyInit,
    });
    if (!up.ok) throw new DictationError(up.status, "upload_failed", "Pre-recorded upload failed");
    const { upload_url } = (await up.json()) as { upload_url: string };

    const body: Record<string, unknown> = { audio_url: upload_url, speech_models: [SYNC_MODEL] };
    if (cfg?.prompt) body.prompt = cfg.prompt;
    if (cfg?.keyterms_prompt) body.keyterms_prompt = cfg.keyterms_prompt;
    if (cfg?.language_code) {
      const lc = Array.isArray(cfg.language_code) ? cfg.language_code : [cfg.language_code];
      if (lc.length > 1) body.language_detection = true;
      else body.language_code = lc[0];
    }

    const tr = await fetch(`${base}/v2/transcript`, {
      method: "POST",
      headers: { Authorization: this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!tr.ok) throw new DictationError(tr.status, "transcript_create_failed", "Pre-recorded transcript request failed");
    const created = (await tr.json()) as { id: string };

    for (let i = 0; i < 120; i++) {
      await sleep(1500);
      const poll = await fetch(`${base}/v2/transcript/${created.id}`, { headers: { Authorization: this.apiKey } });
      const j = (await poll.json()) as {
        status: string;
        text?: string;
        words?: { text: string; confidence: number; start: number; end: number }[];
        confidence?: number;
        audio_duration?: number;
        error?: string;
      };
      if (j.status === "completed") {
        return {
          transcript: {
            text: j.text ?? "",
            words: (j.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, start: w.start, end: w.end })),
            confidence: j.confidence ?? 0,
            audio_duration_ms: Math.round((j.audio_duration ?? 0) * 1000),
            session_id: created.id,
            request_time_ms: undefined,
          },
          route: "prerecorded",
          retries,
          proxy_ms: Math.round(performance.now() - t0),
          endpoint: base,
          region,
          warmed: false,
        };
      }
      if (j.status === "error") throw new DictationError(500, "prerecorded_error", j.error ?? "Pre-recorded transcription failed");
    }
    throw new DictationError(504, "prerecorded_timeout", "Pre-recorded transcription timed out");
  }
}

let singleton: DictationClient | null = null;
/** One process-wide client so /warm and /transcribe share the same connection pool (a documented requirement). */
export function getDictationClient(): DictationClient {
  if (!singleton) {
    const region = (process.env.ASSEMBLYAI_SYNC_REGION as SyncRegion) || "global";
    singleton = new DictationClient(process.env.ASSEMBLYAI_API_KEY, ["global", "us", "eu"].includes(region) ? region : "global");
  }
  return singleton;
}
