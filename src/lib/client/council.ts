/**
 * Client-side Agent Council dispatcher.
 *
 * Reads the NDJSON stream from POST /api/agents and yields events as they land, so each agent card
 * fills in the moment its own model returns instead of waiting on the slowest one.
 */

import type { AgentKind, AgentRun, Thoughtform } from "@/lib/types";
import type { CouncilSynthesis } from "@/components/council";
import { rankedLabels } from "@/lib/twin/graph";
import { domainById } from "@/lib/twin/composer";
import { useTwin } from "@/lib/store/twin";
import { hashEmbed } from "@/lib/kernel/embeddings";
import { cosine } from "@/lib/utils";

export type CouncilEvent =
  | { type: "start"; agents: { agent: AgentKind; name: string; model: string }[]; at: number }
  | { type: "running"; agent: AgentKind; model: string }
  | { type: "result"; agent: AgentKind; model: string; provider: AgentRun["provider"]; status: "done" | "error" | "paused"; output?: AgentRun["output"]; error?: string; latency_ms: number }
  | { type: "synthesizing" }
  | { type: "synthesis"; synthesis: CouncilSynthesis | null }
  | { type: "done"; at: number; paused: boolean };

/**
 * Retrieve the past Thoughtforms most related to `tf`, for the Historian and for grounding.
 * Uses stored embeddings when they share a model, else falls back to the local hashed embedding so
 * retrieval still works at $0 with no keys.
 */
export function relatedThoughtforms(tf: Thoughtform, k = 6) {
  const s = useTwin.getState();
  const pool = s.thoughtforms.filter((t) => t.commit_hash !== tf.commit_hash);
  if (!pool.length) return [];

  const textOf = (t: Thoughtform) => `${t.compiled.title}\n${t.compiled.polished_text}\n${t.compiled.entities.map((e) => e.name).join(" ")}`;

  let scored: { t: Thoughtform; score: number }[];
  if (tf.embedding?.length && tf.embedding_model) {
    const sameModel = pool.filter((t) => t.embedding_model === tf.embedding_model && t.embedding?.length === tf.embedding!.length);
    scored = sameModel.length
      ? sameModel.map((t) => ({ t, score: cosine(tf.embedding!, t.embedding!) }))
      : pool.map((t) => ({ t, score: cosine(hashEmbed(textOf(tf)), hashEmbed(textOf(t))) }));
  } else {
    const q = hashEmbed(textOf(tf));
    scored = pool.map((t) => ({ t, score: cosine(q, hashEmbed(textOf(t))) }));
  }

  return scored
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => ({
      commit: x.t.commit_hash,
      when: new Date(x.t.created_at).toLocaleString(),
      title: x.t.compiled.title,
      text: x.t.compiled.polished_text,
      score: Number(x.score.toFixed(3)),
    }));
}

export function buildAgentContext(tf: Thoughtform) {
  const s = useTwin.getState();
  return {
    compiled: tf.compiled,
    raw_text: tf.raw_text,
    related: relatedThoughtforms(tf),
    knownNodes: rankedLabels(s.graph, Date.now(), 50).map((n) => n.label),
    domain: s.profile.domains.map((d) => domainById(d)?.name).filter(Boolean).join(" / ") || "general",
    project: rankedLabels(s.graph, Date.now(), 1, ["Project"])[0]?.label ?? null,
    nowISO: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: tf.compiled.language_detected,
  };
}

/** Stream the council. `onEvent` is called for every NDJSON line as it arrives. */
export async function convene(
  tf: Thoughtform,
  agents: AgentKind[] | undefined,
  onEvent: (e: CouncilEvent) => void,
  opts: { synthesize?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agents: agents ?? tf.compiled.suggested_agents,
      context: buildAgentContext(tf),
      synthesize: opts.synthesize !== false,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    let message = `Council request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) message = j.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as CouncilEvent);
      } catch {
        /* partial or malformed line — skip */
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as CouncilEvent);
    } catch {
      /* ignore trailing partial */
    }
  }
}
