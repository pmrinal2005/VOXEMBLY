// ============================================================================
// VOXEMBLY — Deep Memory Retrieval (DMR) eval. Live "Memory Recall %" score.
// ============================================================================

import type { DmrProbe, Thoughtform } from "@/lib/types";
import { hashEmbed } from "@/lib/kernel/embeddings";
import { cosine } from "@/lib/utils";

export interface DMRResult {
  probes: number;
  hits: number;
  recall: number;
  mrr: number;
  k: number;
  ran: number;
  ran_at: number;
  degraded?: string;
  details: DmrProbe[];
  per_probe: DmrProbe[];
}

export type DmrResult = DMRResult;

export function runDMR(thoughtforms: Thoughtform[], k = 5, sampleSize = 40): DMRResult {
  const withText = thoughtforms.filter((t) => (t.compiled?.polished_text || "").length > 4);
  if (withText.length === 0) {
    return {
      probes: 0,
      hits: 0,
      recall: 0,
      mrr: 0,
      k,
      ran: 0,
      degraded: "No Thoughtforms yet — dictate or load the demo Twin first.",
      details: [],
      per_probe: [],
      ran_at: Date.now(),
    };
  }
  const sample = withText.slice(0, sampleSize);
  const corpus = withText.map((t) => ({
    id: t.commit_hash,
    vec: t.embedding && t.embedding.length ? t.embedding : hashEmbed(t.compiled.polished_text),
    text: t.compiled.polished_text,
  }));

  const details: DmrProbe[] = [];
  let hits = 0;
  let rrSum = 0;
  for (const t of sample) {
    const query =
      [t.compiled.intent, ...t.compiled.entities.map((e) => e.name)].join(" ") ||
      t.compiled.polished_text.slice(0, 40);
    const qvec = hashEmbed(query);
    const ranked = corpus
      .map((c) => ({ ...c, score: cosine(qvec, c.vec) }))
      .sort((a, b) => b.score - a.score);
    const rank = ranked.findIndex((c) => c.id === t.commit_hash);
    const inTop = rank >= 0 && rank < k;
    if (inTop) hits++;
    if (rank >= 0) rrSum += 1 / (rank + 1);
    details.push({
      question: `Recall thought about: ${query.slice(0, 48)}`,
      expected: t.compiled.polished_text.slice(0, 60),
      got: ranked[0]?.text.slice(0, 60) ?? "",
      pass: inTop,
    });
  }
  return {
    probes: sample.length,
    hits,
    recall: hits / sample.length,
    mrr: rrSum / sample.length,
    k,
    ran: sample.length,
    ran_at: Date.now(),
    details,
    per_probe: details,
  };
}

export const runDmr = runDMR;
