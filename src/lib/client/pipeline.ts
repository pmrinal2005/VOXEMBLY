"use client";

import type {
  AgentKind,
  CompiledThoughtform,
  CompileResult,
  ComposedContext,
  DictationConfig,
  SyncRegion,
  Thoughtform,
  TranscribeResponse,
} from "@/lib/types";
import { compose } from "@/lib/twin/composer";
import { computeCommitHash } from "@/lib/twin/vcs";
import { uid } from "@/lib/utils";
import { useTwin } from "@/lib/store/twin";
import { LIMITS } from "@/lib/dictation/client";
import type { CaptureResult } from "@/lib/client/recorder";

export type { TranscribeResponse };

export class PipelineError extends Error {
  code: string;
  swallowed: boolean;
  constructor(code: string, message: string, swallowed = false) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.swallowed = swallowed;
  }
}

export async function warmUp(region?: string): Promise<{
  ok: boolean;
  ms: number;
  region: string;
  endpoint: string;
  reason?: string;
}> {
  try {
    const q = region ? `?region=${region}` : "";
    const res = await fetch(`/api/warm${q}`, { method: "GET" });
    return await res.json();
  } catch {
    return { ok: false, ms: 0, region: region || "global", endpoint: "", reason: "network" };
  }
}

export function composeNow(): ComposedContext {
  const s = useTwin.getState();
  return compose({ profile: s.profile, graph: s.graph, thoughtforms: s.thoughtforms });
}

export async function transcribe(
  capture: CaptureResult,
  config: DictationConfig,
  region?: SyncRegion,
  usePCM = false,
): Promise<TranscribeResponse> {
  if (capture.durationMs < LIMITS.minDurationMs) {
    throw new PipelineError("audio_too_short", "Clip shorter than 80 ms", true);
  }
  const form = new FormData();
  if (usePCM) {
    form.append("audio", capture.pcm, "clip.pcm");
    form.append("content_type", "audio/pcm");
  } else {
    form.append("audio", capture.wav, "clip.wav");
  }
  form.append("prompt", config.prompt || "");
  form.append("keyterms_prompt", JSON.stringify(config.keyterms_prompt || []));
  if (config.language_code) form.append("language_code", config.language_code);
  if (region) form.append("region", region);
  if (config.timestamps) form.append("timestamps", "1");

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new PipelineError(`transcribe_${res.status}`, t || res.statusText);
  }
  return res.json();
}

export async function compile(rawText: string, signal?: AbortSignal): Promise<CompileResult> {
  const res = await fetch("/api/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: rawText }),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new PipelineError(`compile_${res.status}`, t || res.statusText);
  }
  return res.json();
}

export async function embed(text: string): Promise<{ vector: number[]; model: string }> {
  try {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { vector: [], model: "none" };
    const j = (await res.json()) as { vector?: number[]; model?: string };
    return { vector: j.vector || [], model: j.model || "hash" };
  } catch {
    return { vector: [], model: "none" };
  }
}

export async function buildThoughtform(args: {
  capture: CaptureResult;
  response: TranscribeResponse;
  compiled: CompiledThoughtform;
  compile_ms: number;
  composed: ComposedContext;
  clientRoundtripMs: number;
  totalMs: number;
}): Promise<Thoughtform> {
  const s = useTwin.getState();
  const parent = s.branches[s.currentBranch]?.head ?? null;
  const created_at = Date.now();
  const tr = args.response.transcript;
  const commit_hash = await computeCommitHash({
    parent_hashes: parent ? [parent] : [],
    branch: s.currentBranch,
    created_at,
    raw_text: tr.text,
    polished_text: args.compiled.polished_text,
    intent: args.compiled.intent,
    session_id: tr.session_id,
  });
  return {
    id: uid("tf"),
    commit_hash,
    parent_hashes: parent ? [parent] : [],
    branch: s.currentBranch,
    created_at,
    raw_text: tr.text,
    words: tr.words,
    confidence: tr.confidence,
    compiled: args.compiled,
    trace: {
      region: args.response.meta.region,
      endpoint: args.response.meta.endpoint,
      model: LIMITS.MODEL,
      session_id: tr.session_id,
      request_time_ms: tr.request_time_ms,
      client_roundtrip_ms: args.clientRoundtripMs,
      proxy_roundtrip_ms: args.response.meta.proxy_ms,
      audio_duration_ms: tr.audio_duration_ms || args.capture.durationMs,
      audio_bytes: (args.capture.wav?.size ?? 0) || args.capture.pcm.size,
      audio_format: args.capture.wav.type || "audio/wav",
      prompt: args.composed.config.prompt,
      keyterms_prompt: args.composed.config.keyterms_prompt,
      language_code: tr.language_code,
      conversation_context: [],
      timestamps: Boolean(args.composed.config.timestamps),
      warmed: args.response.meta.warmed,
      route: args.response.meta.route,
      retries: args.response.meta.retries,
      simulated: args.response.meta.simulated,
    },
    agent_runs: [],
    compile_ms: args.compile_ms,
    total_ms: args.totalMs,
  };
}

export type VoiceCommand =
  | { verb: "checkout"; args: string[] }
  | { verb: "return"; args: string[] }
  | { verb: "branch"; args: string[] }
  | { verb: "switch"; args: string[] }
  | { verb: "merge"; args: string[] }
  | { verb: "council"; args: string[] }
  | { verb: "publish"; args: string[] }
  | { verb: "ambient"; args: string[] }
  | { verb: "search"; args: string[] }
  | { verb: "undo"; args: string[] };

export function resolveCommand(
  compiled: CompiledThoughtform,
  text: string,
): VoiceCommand | null {
  const raw = `${compiled.intent === "command" ? compiled.polished_text : ""} ${text}`.toLowerCase();
  const t = raw.replace(/^voxembly[,:\s]+/, "").trim();
  if (/return to head|go to head|leave time travel/.test(t)) return { verb: "return", args: [] };
  if (/^(checkout|check out|go to|rewind)/.test(t) || /tuesday brain|my \w+ brain/.test(t)) {
    const m = t.match(/(?:checkout|check out|go to|rewind)\s+(.*)/);
    const arg = m?.[1]?.trim() || (t.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/)?.[1] ?? "");
    return { verb: "checkout", args: [arg] };
  }
  if (/^branch/.test(t) || /branch this into/.test(t)) {
    const m = t.match(/into\s+(.*)/) || t.match(/branch(?:\s+this)?(?:\s+into)?\s+(.*)/);
    const names = (m?.[1] || "branch")
      .split(/\s+and\s+|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { verb: "branch", args: names };
  }
  if (/^switch to/.test(t)) {
    return { verb: "switch", args: [t.replace(/^switch to\s+/, "").trim()] };
  }
  if (/^merge/.test(t)) {
    const m = t.match(/merge\s+(\S+)(?:\s+into\s+(\S+))?/);
    return { verb: "merge", args: [m?.[1] || "", m?.[2] || ""] };
  }
  if (/convene|council|let the fleet debate/.test(t)) return { verb: "council", args: [] };
  if (/^publish|publish this/.test(t)) return { verb: "publish", args: [] };
  if (/start ambient|ambient mode|think out loud/.test(t)) return { verb: "ambient", args: ["on"] };
  if (/stop ambient/.test(t)) return { verb: "ambient", args: ["off"] };
  if (/^search |^research /.test(t)) return { verb: "search", args: [t.replace(/^(search|research)\s+/, "")] };
  if (/^undo/.test(t)) return { verb: "undo", args: [] };
  return compiled.intent === "command" ? { verb: "council", args: [] } : null;
}
