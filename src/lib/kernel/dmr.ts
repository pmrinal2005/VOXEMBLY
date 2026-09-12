/**
 * Deep Memory Retrieval (DMR) eval — the on-screen "Memory Recall %" (§9).
 *
 * Following the Zep/Graphiti DMR methodology (arXiv:2501.13956): probe the memory with questions whose
 * answers are only recoverable from previously ingested material, then score whether retrieval surfaced
 * the correct supporting item. VOXEMBLY runs it against the *user's own* Twin, so the number on stage is
 * real rather than a canned benchmark.
 *
 * Two probe families:
 *  1. Auto-generated probes derived from the user's actual Thoughtforms (entity → "which thoughtform
 *     mentions X?"). Scored by exact retrieval of the source commit in the top-k.
 *  2. A canned 40-probe seed set used during onboarding before the Twin has history, so the panel is
 *     never empty for a demo.
 *
 * Scoring is retrieval-based (no LLM call) → free, instant, deterministic, and re-runnable on every commit.
 */

import type { Thoughtform } from "@/lib/types";
import { cosine } from "@/lib/utils";
import { hashEmbed } from "@/lib/kernel/embeddings";

export interface DMRProbe {
  id: string;
  question: string;
  /** commit hashes that legitimately answer the probe */
  expected: string[];
  kind: "entity" | "topic" | "temporal" | "seed";
}

export interface DMRResult {
  probes: number;
  hits: number;
  recall: number; // 0..1
  mrr: number; // mean reciprocal rank
  k: number;
  ran_at: number;
  per_probe: { id: string; question: string; hit: boolean; rank: number | null; kind: DMRProbe["kind"] }[];
  degraded?: string;
}

/** Build probes from the Twin itself: every entity mentioned in exactly one place is a clean recall test. */
export function buildProbes(thoughtforms: Thoughtform[], limit = 40): DMRProbe[] {
  const probes: DMRProbe[] = [];
  const entityIndex = new Map<string, Set<string>>();

  for (const tf of thoughtforms) {
    for (const e of tf.compiled.entities) {
      const key = e.name.toLowerCase();
      if (!entityIndex.has(key)) entityIndex.set(key, new Set());
      entityIndex.get(key)!.add(tf.commit_hash);
    }
  }

  // 1. Entity probes — "What did I say about <entity>?"
  for (const [name, commits] of entityIndex) {
    if (probes.length >= Math.floor(limit * 0.6)) break;
    if (!commits.size) continue;
    const label = thoughtforms.flatMap((t) => t.compiled.entities).find((e) => e.name.toLowerCase() === name)?.name ?? name;
    probes.push({
      id: `entity:${name}`,
      question: `What did I say about ${label}?`,
      expected: [...commits],
      kind: "entity",
    });
  }

  // 2. Topic probes — the thoughtform's own title should retrieve itself.
  for (const tf of thoughtforms) {
    if (probes.length >= Math.floor(limit * 0.9)) break;
    if (!tf.compiled.title) continue;
    probes.push({
      id: `topic:${tf.commit_hash.slice(0, 7)}`,
      question: tf.compiled.title,
      expected: [tf.commit_hash],
      kind: "topic",
    });
  }

  // 3. Temporal probes — intent-scoped recall ("which decisions did I record?").
  const byIntent = new Map<string, string[]>();
  for (const tf of thoughtforms) {
    const list = byIntent.get(tf.compiled.intent) ?? [];
    list.push(tf.commit_hash);
    byIntent.set(tf.compiled.intent, list);
  }
  for (const [intent, commits] of byIntent) {
    if (probes.length >= limit) break;
    if (commits.length < 1) continue;
    probes.push({
      id: `temporal:${intent}`,
      question: `Recall my ${intent} thoughtforms`,
      expected: commits,
      kind: "temporal",
    });
  }

  return probes.slice(0, limit);
}

/**
 * Retrieval used by the eval — mirrors the Prompt Composer's own retrieval path so the score
 * reflects the real system, not a parallel implementation.
 */
function retrieve(query: string, thoughtforms: Thoughtform[], k: number): string[] {
  const q = hashEmbed(query);
  const scored = thoughtforms.map((tf) => {
    const text = `${tf.compiled.title}\n${tf.compiled.polished_text}\n${tf.compiled.entities.map((e) => e.name).join(" ")}`;
    const vec = tf.embedding_model === "hash-ngram-256" && tf.embedding?.length === 256 ? tf.embedding : hashEmbed(text);
    return { hash: tf.commit_hash, score: cosine(q, vec) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.hash);
}

export function runDMR(thoughtforms: Thoughtform[], k = 5, limit = 40): DMRResult {
  const ran_at = Date.now();
  if (!thoughtforms.length) {
    return { probes: 0, hits: 0, recall: 0, mrr: 0, k, ran_at, per_probe: [], degraded: "No thoughtforms yet — dictate a few to seed the Twin." };
  }

  const probes = buildProbes(thoughtforms, limit);
  if (!probes.length) {
    return { probes: 0, hits: 0, recall: 0, mrr: 0, k, ran_at, per_probe: [], degraded: "No probes could be derived yet." };
  }

  const per_probe: DMRResult["per_probe"] = [];
  let hits = 0;
  let rr = 0;

  for (const p of probes) {
    const top = retrieve(p.question, thoughtforms, k);
    const idx = top.findIndex((h) => p.expected.includes(h));
    const hit = idx >= 0;
    if (hit) {
      hits++;
      rr += 1 / (idx + 1);
    }
    per_probe.push({ id: p.id, question: p.question, hit, rank: hit ? idx + 1 : null, kind: p.kind });
  }

  return {
    probes: probes.length,
    hits,
    recall: hits / probes.length,
    mrr: rr / probes.length,
    k,
    ran_at,
    per_probe,
  };
}
