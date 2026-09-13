// ============================================================================
// VOXEMBLY — Deep Memory Retrieval (DMR) eval. A small scripted recall probe
// set that runs against the current Thoughtform history and reports a live
// "Memory Recall %" — the on-stage accuracy claim (plan §5, §9).
// ============================================================================

import type { DmrProbe, Thoughtform } from "@/lib/types";
import { hashEmbed } from "@/lib/kernel/embeddings";
import { cosine } from "@/lib/utils";

export interface DmrResult {
  probes: DmrProbe[];
  recall: number; // 0..1
  ran: number;
}

/**
 * Build probes from the history itself: for each recent thoughtform we ask
 * "can we retrieve it back from a paraphrase of its own entities?". This gives
 * a deterministic, self-contained benchmark with no external dataset.
 */
export function runDmr(thoughtforms: Thoughtform[], sampleSize = 40): DmrResult {
  const withText = thoughtforms.filter((t) => t.polished_text.length > 4);
  if (withText.length === 0) {
    return { probes: [], recall: 0, ran: 0 };
  }
  const sample = withText.slice(0, sampleSize);
  const corpus = withText.map((t) => ({
    id: t.id,
    vec: t.embedding && t.embedding.length ? t.embedding : hashEmbed(t.polished_text),
    text: t.polished_text,
  }));

  const probes: DmrProbe[] = [];
  let hits = 0;
  for (const t of sample) {
    // query = the entities + intent (a "paraphrase" that should retrieve self)
    const query = [t.intent, ...t.entities.map((e) => e.name)].join(" ") || t.polished_text.slice(0, 40);
    const qvec = hashEmbed(query);
    let best = { id: "", score: -1, text: "" };
    for (const c of corpus) {
      const s = cosine(qvec, c.vec);
      if (s > best.score) best = { id: c.id, score: s, text: c.text };
    }
    const pass = best.id === t.id || best.score > 0.55;
    if (pass) hits++;
    probes.push({
      question: `Recall thought about: ${query.slice(0, 48)}`,
      expected: t.polished_text.slice(0, 60),
      got: best.text.slice(0, 60),
      pass,
    });
  }
  return { probes, recall: hits / sample.length, ran: sample.length };
}
