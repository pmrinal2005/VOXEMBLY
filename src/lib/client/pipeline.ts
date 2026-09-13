"use client";

// ============================================================================
// VOXEMBLY — client pipeline. Thin fetch wrappers around the API routes that
// orchestrate the Push-to-Think loop, plus the buildThoughtform assembler that
// stitches a transcribe + compile result into a committed Thoughtform.
// ============================================================================

import type {
  AgentKind,
  CompileResult,
  ComposedContext,
  Graph,
  Profile,
  Thoughtform,
  TranscribeResponse,
} from "@/lib/types";
import { compose } from "@/lib/twin/composer";
import { computeCommitHash } from "@/lib/twin/vcs";
import { uid } from "@/lib/utils";

export class PipelineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new PipelineError(`http_${res.status}`, t || res.statusText);
  }
  return res.json() as Promise<T>;
}

/** Pre-warm the Dictation connection (fired on key-down). */
export async function warmUp(region?: string): Promise<{ ok: boolean; ms: number; region: string; endpoint: string }> {
  try {
    const q = region ? `?region=${region}` : "";
    const res = await fetch(`/api/warm${q}`, { method: "GET" });
    return await res.json();
  } catch (e) {
    return { ok: false, ms: 0, region: region || "global", endpoint: "" };
  }
}

/** Compose the next dictation context from the live Twin (bi-directional loop). */
export function composeNow(input: {
  profile: Profile;
  graph: Graph;
  thoughtforms: Thoughtform[];
}): ComposedContext {
  return compose(input);
}

/** Transcribe a WAV clip via the Sync STT endpoint (server proxies AAI). */
export async function transcribe(
  wav: Blob,
  ctx: ComposedContext,
  region?: string,
): Promise<TranscribeResponse> {
  const form = new FormData();
  form.append("audio", wav, "clip.wav");
  form.append("prompt", ctx.prompt || "");
  form.append("keyterms_prompt", JSON.stringify(ctx.keyterms_prompt || []));
  if (ctx.language_code) form.append("language_code", ctx.language_code);
  if (region) form.append("region", region);

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new PipelineError(`transcribe_${res.status}`, t || res.statusText);
  }
  return res.json();
}

/** Compile a raw transcript into a strict-JSON Thoughtform payload. */
export async function compile(rawText: string, signal?: AbortSignal): Promise<CompileResult> {
  return postJson<CompileResult>("/api/compile", { text: rawText }, signal);
}

/** Embed text for semantic memory. */
export async function embed(text: string): Promise<number[]> {
  try {
    const { vector } = await postJson<{ vector: number[]; source: string }>("/api/embed", { text });
    return vector;
  } catch {
    return [];
  }
}

/** Assemble a committed Thoughtform from transcribe + compile results. */
export async function buildThoughtform(args: {
  transcribe: TranscribeResponse;
  compile: CompileResult;
  branch: string;
  parent: string | null;
  ctx: ComposedContext;
  embedding?: number[];
}): Promise<Thoughtform> {
  const { transcribe: tr, compile: co, branch, parent, ctx, embedding } = args;
  const createdAt = Date.now();
  const commit_hash = await computeCommitHash(
    { polished_text: co.polished_text, intent: co.intent, createdAt },
    parent,
  );
  return {
    id: uid("tf"),
    commit_hash,
    parent_hash: parent,
    branch,
    createdAt,
    language_code: tr.language_code || ctx.language_code,
    raw_text: tr.text,
    polished_text: co.polished_text,
    words: tr.words,
    confidence: tr.confidence,
    request_time_ms: tr.request_time_ms,
    audio_duration_ms: tr.audio_duration_ms,
    session_id: tr.session_id,
    region: tr.region,
    simulated: tr.simulated,
    intent: co.intent,
    sentiment: co.sentiment,
    entities: co.entities,
    actions: co.actions,
    graph_mutations: co.graph_mutations,
    spawned_agents: co.spawned_agents,
    embedding,
    prompt_used: ctx.prompt,
    keyterms_used: ctx.keyterms_prompt,
  };
}

/** Resolve a spoken command into a hands-free action (voice grammar). */
export function resolveCommand(text: string):
  | { kind: "checkout"; arg?: string }
  | { kind: "branch"; arg?: string }
  | { kind: "merge"; arg?: string }
  | { kind: "council" }
  | { kind: "publish" }
  | { kind: "ambient" }
  | { kind: "search"; arg: string }
  | null {
  const t = text.toLowerCase().trim().replace(/^voxembly[,\s]+/, "");
  if (/^(checkout|check out|go to|rewind)/.test(t)) {
    const m = t.match(/(?:checkout|check out|go to|rewind)\s+(.*)/);
    return { kind: "checkout", arg: m?.[1]?.trim() };
  }
  if (/^branch/.test(t)) {
    const m = t.match(/branch(?:\s+this)?(?:\s+into)?\s+(.*)/);
    return { kind: "branch", arg: m?.[1]?.trim() };
  }
  if (/^merge/.test(t)) {
    const m = t.match(/merge\s+(.*)/);
    return { kind: "merge", arg: m?.[1]?.trim() };
  }
  if (/convene council|let the fleet debate|convene the council/.test(t)) return { kind: "council" };
  if (/^publish|publish this/.test(t)) return { kind: "publish" };
  if (/ambient mode|think out loud/.test(t)) return { kind: "ambient" };
  if (/^search /.test(t)) return { kind: "search", arg: t.replace(/^search /, "") };
  return null;
}
