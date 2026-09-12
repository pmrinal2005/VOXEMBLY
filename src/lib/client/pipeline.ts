/**
 * The Push-to-Think pipeline (client side).
 *
 * key-down  → GET /api/warm (handshake off the critical path) + compose config from the Twin
 * key-up    → POST /api/transcribe (Sync STT, ~134 ms p50) → POST /api/compile (Groq strict JSON)
 *           → commit hash → graph mutations → optional embedding → Agent Council dispatch
 *
 * Everything is measured so the Latency Dial shows real numbers: server `request_time_ms`, the proxy
 * round-trip, and the true mouth-to-meaning total from key-up.
 */

import type { CompiledThoughtform, DictationTrace, SyncTranscript, Thoughtform } from "@/lib/types";
import type { DictationConfig } from "@/lib/dictation/client";
import { composeDictationConfig, domainById } from "@/lib/twin/composer";
import { computeCommitHash } from "@/lib/twin/vcs";
import { rankedLabels } from "@/lib/twin/graph";
import { useTwin } from "@/lib/store/twin";
import { uid } from "@/lib/utils";
import type { CaptureResult } from "@/lib/client/recorder";

export interface WarmInfo {
  ok: boolean;
  ms: number;
  region: string;
  endpoint: string;
  at: number;
  reason?: string;
}

let lastWarm: WarmInfo | null = null;
export const getLastWarm = () => lastWarm;

/** Fire on key-DOWN. Never throws — a failed warm just costs latency, not the utterance. */
export async function warmUp(region: string): Promise<WarmInfo> {
  try {
    const res = await fetch(`/api/warm?region=${encodeURIComponent(region)}`, { cache: "no-store" });
    const j = (await res.json()) as Omit<WarmInfo, "at">;
    lastWarm = { ...j, at: Date.now() };
  } catch (e) {
    lastWarm = { ok: false, ms: 0, region, endpoint: "", at: Date.now(), reason: (e as Error).message };
  }
  return lastWarm;
}

/** Compose the next request's prompt/keyterms/context from current Twin state (the bi-directional loop). */
export function composeNow() {
  const s = useTwin.getState();
  return composeDictationConfig({
    profile: s.profile,
    graph: s.graph,
    recent: s.recentOnBranch(),
    learnedKeyterms: s.learnedKeyterms(),
    branch: s.currentBranch,
    currentProject: null,
  });
}

export interface TranscribeResponse {
  transcript: SyncTranscript;
  meta: {
    model: string;
    route: "sync" | "prerecorded";
    region: DictationTrace["region"];
    endpoint: string;
    warmed: boolean;
    retries: number;
    proxy_ms: number;
    route_total_ms: number;
    audio_bytes: number;
    audio_format: "audio/wav" | "audio/pcm";
    sent_config: DictationConfig | null;
  };
}

export class PipelineError extends Error {
  constructor(
    public code: string,
    message: string,
    public swallowed = false,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/** POST the captured audio to the Sync STT proxy. */
export async function transcribe(capture: CaptureResult, config: DictationConfig, region: string, usePCM = false): Promise<TranscribeResponse> {
  const form = new FormData();
  const blob = usePCM ? capture.pcm : capture.wav;
  form.append("audio", blob, usePCM ? "dictation.pcm" : "dictation.wav");
  const cfg: DictationConfig = usePCM ? { ...config, sample_rate: capture.sampleRate, channels: 1 } : config;
  form.append("config", JSON.stringify(cfg));
  form.append("region", region);
  form.append("duration_ms", String(capture.durationMs));

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  const json = (await res.json()) as TranscribeResponse & { error?: { code: string; message: string }; swallowed?: boolean };

  if (json.error) throw new PipelineError(json.error.code, json.error.message, Boolean(json.swallowed));
  if (!res.ok) throw new PipelineError("http_error", `Transcription failed (${res.status})`);
  return json;
}

/** Cleanup Pass → strict CompiledThoughtform. */
export async function compile(transcript: string): Promise<{ compiled: CompiledThoughtform; model: string; provider: string; compile_ms: number; degraded: boolean }> {
  const s = useTwin.getState();
  const recent = s.recentOnBranch();
  const people = rankedLabels(s.graph, Date.now(), 12, ["Person"]).map((n) => n.label);
  const projects = rankedLabels(s.graph, Date.now(), 3, ["Project"]).map((n) => n.label);

  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript,
      context: {
        domain: s.profile.domains.map((d) => domainById(d)?.name).filter(Boolean).join(" / ") || "general",
        project: projects[0] ?? null,
        people,
        recentTitles: recent.slice(0, 5).map((t) => t.compiled.title),
        branch: s.currentBranch,
        normalizeTo: s.profile.normalize_to,
        localePack: s.profile.locale_pack,
        knownNodeLabels: rankedLabels(s.graph, Date.now(), 40).map((n) => n.label),
      },
    }),
  });

  if (!res.ok) throw new PipelineError("compile_failed", `Compile failed (${res.status})`);
  return (await res.json()) as { compiled: CompiledThoughtform; model: string; provider: string; compile_ms: number; degraded: boolean };
}

/** Embed the polished text so future dictations can retrieve it (best-effort). */
export async function embed(text: string): Promise<{ vector?: number[]; model?: string }> {
  try {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: [text], task: "text-matching" }),
    });
    if (!res.ok) return {};
    const j = (await res.json()) as { vectors: number[][]; model: string };
    return { vector: j.vectors?.[0], model: j.model };
  } catch {
    return {};
  }
}

export interface CommitInput {
  capture: CaptureResult;
  response: TranscribeResponse;
  compiled: CompiledThoughtform;
  compile_ms: number;
  composed: { config: DictationConfig };
  clientRoundtripMs: number;
  totalMs: number;
}

/** Build the Thoughtform commit (hash over parents + branch + time + session + text). */
export async function buildThoughtform(input: CommitInput): Promise<Thoughtform> {
  const s = useTwin.getState();
  const branch = s.currentBranch;
  const parent = s.branches[branch]?.head ?? null;
  const created_at = Date.now();
  const t = input.response.transcript;

  const commit_hash = await computeCommitHash({
    parent_hashes: parent ? [parent] : [],
    branch,
    created_at,
    raw_text: t.text ?? "",
    polished_text: input.compiled.polished_text,
    intent: input.compiled.intent,
    session_id: t.session_id ?? uid("sess"),
  });

  const trace: DictationTrace = {
    region: input.response.meta.region,
    endpoint: input.response.meta.endpoint,
    model: "universal-3-5-pro",
    session_id: t.session_id ?? "",
    request_time_ms: typeof t.request_time_ms === "number" ? t.request_time_ms : null,
    client_roundtrip_ms: input.clientRoundtripMs,
    proxy_roundtrip_ms: input.response.meta.proxy_ms,
    audio_duration_ms: t.audio_duration_ms ?? input.capture.durationMs,
    audio_bytes: input.response.meta.audio_bytes,
    audio_format: input.response.meta.audio_format,
    prompt: input.composed.config.prompt ?? "",
    keyterms_prompt: input.composed.config.keyterms_prompt ?? [],
    language_code: input.composed.config.language_code ?? null,
    conversation_context: input.composed.config.conversation_context ?? [],
    timestamps: Boolean(input.composed.config.timestamps),
    warmed: input.response.meta.warmed,
    route: input.response.meta.route,
    retries: input.response.meta.retries,
  };

  return {
    id: commit_hash,
    commit_hash,
    parent_hashes: parent ? [parent] : [],
    branch,
    created_at,
    raw_text: t.text ?? "",
    words: t.words ?? [],
    confidence: t.confidence ?? 0,
    compiled: input.compiled,
    trace,
    agent_runs: [],
    compile_ms: input.compile_ms,
    total_ms: input.totalMs,
  };
}

/* ───────────────────────── voice command grammar (§3.6 hands-free) ───────────────────────── */

export interface VoiceCommand {
  verb: "checkout" | "branch" | "merge" | "council" | "publish" | "search" | "undo" | "switch" | "ambient" | "return";
  args: string[];
  source: "kernel" | "grammar";
}

/**
 * Local grammar fallback: recognises every app action from raw speech even when the LLM pass is
 * degraded, so zero-keyboard operability never depends on an API being up.
 */
export function parseVoiceCommand(text: string): VoiceCommand | null {
  const t = text.toLowerCase().trim().replace(/[.!?]+$/, "");
  const strip = (s: string) => s.replace(/^(the|my|this|to)\s+/, "").trim();

  let m = t.match(/^(?:voxembly,?\s*)?(?:check ?out|checkout|go back to|rewind to|time travel to)\s+(.+)$/);
  if (m) return { verb: "checkout", args: [strip(m[1])], source: "grammar" };

  m = t.match(/^(?:voxembly,?\s*)?(?:branch|fork)\s+(?:this\s+)?(?:into\s+)?(.+?)\s+and\s+(.+)$/);
  if (m) return { verb: "branch", args: [strip(m[1]), strip(m[2])], source: "grammar" };

  m = t.match(/^(?:voxembly,?\s*)?(?:branch|fork)\s+(?:this\s+)?(?:into\s+)?(.+)$/);
  if (m) return { verb: "branch", args: [strip(m[1])], source: "grammar" };

  m = t.match(/^(?:voxembly,?\s*)?merge\s+(.+?)(?:\s+into\s+(.+))?$/);
  if (m) return { verb: "merge", args: [strip(m[1]), m[2] ? strip(m[2]) : ""].filter(Boolean), source: "grammar" };

  m = t.match(/^(?:voxembly,?\s*)?(?:switch to|use branch|go to branch)\s+(.+)$/);
  if (m) return { verb: "switch", args: [strip(m[1])], source: "grammar" };

  if (/^(?:voxembly,?\s*)?(?:convene|summon)(?:\s+the)?\s+council/.test(t)) return { verb: "council", args: [], source: "grammar" };
  if (/^(?:voxembly,?\s*)?publish(?:\s+(?:this|it))?$/.test(t)) return { verb: "publish", args: [], source: "grammar" };
  if (/^(?:voxembly,?\s*)?(?:undo|delete)(?:\s+(?:that|this|last))?/.test(t)) return { verb: "undo", args: [], source: "grammar" };
  if (/^(?:voxembly,?\s*)?(?:return|back)\s+to\s+(?:head|now|live|present)/.test(t)) return { verb: "return", args: [], source: "grammar" };
  if (/^(?:voxembly,?\s*)?(?:start|enter|enable)\s+ambient/.test(t)) return { verb: "ambient", args: ["on"], source: "grammar" };
  if (/^(?:voxembly,?\s*)?(?:stop|exit|disable|leave)\s+ambient/.test(t)) return { verb: "ambient", args: ["off"], source: "grammar" };

  m = t.match(/^(?:voxembly,?\s*)?(?:search|look up|research)\s+(?:for\s+)?(.+)$/);
  if (m) return { verb: "search", args: [strip(m[1])], source: "grammar" };

  return null;
}

/** Prefer the Intent Kernel's structured command, fall back to the local grammar. */
export function resolveCommand(compiled: CompiledThoughtform, rawText: string): VoiceCommand | null {
  const c = compiled.command;
  if (c?.verb) {
    const verbs = ["checkout", "branch", "merge", "council", "publish", "search", "undo", "switch", "ambient", "return"];
    if (verbs.includes(c.verb)) return { verb: c.verb as VoiceCommand["verb"], args: c.args ?? [], source: "kernel" };
  }
  return parseVoiceCommand(compiled.polished_text) ?? parseVoiceCommand(rawText);
}
