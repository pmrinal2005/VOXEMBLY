// ============================================================================
// VOXEMBLY — Prompt Composer.
//
// THE key differentiator: the bi-directional memory ↔ dictation loop. Before
// every dictation, this composes the `prompt` (<=50 words) and `keyterms_prompt`
// (<=1000 phrases) from the LIVE Cognitive Twin — current domain, active
// project/people, and the most-relevant recent Thoughtforms — so the API gets
// smarter with every utterance.
// ============================================================================

import type { ComposedContext, Graph, Profile, Thoughtform } from "@/lib/types";
import { clampKeyterms, clampPrompt } from "@/lib/dictation/client";
import { rankedLabels } from "@/lib/twin/graph";
import { domainById } from "@/lib/twin/domains";
import { cosine } from "@/lib/utils";

export { domainById };

export interface ComposeInput {
  profile: Profile;
  graph: Graph;
  thoughtforms: Thoughtform[]; // history
  queryEmbedding?: number[]; // optional, for relevance retrieval
}

/**
 * Compose the next dictation context from memory.
 *   prompt   = domain base + active people + recent topic (natural sentence)
 *   keyterms = domain vocab → graph proper nouns → recent entities
 */
export function compose(input: ComposeInput): ComposedContext {
  const { profile, graph, thoughtforms, queryEmbedding } = input;

  // ---- prompt (natural language scene-setting) ----
  const parts: string[] = [];
  const domains = profile.domains.map(domainById).filter(Boolean);
  if (domains.length) {
    parts.push(domains.map((d) => d!.basePrompt).join(" "));
  }

  // active people (Person nodes with recent activity)
  const people = graph.nodes
    .filter((n) => n.kind === "Person")
    .sort((a, b) => b.valid_from - a.valid_from)
    .slice(0, 3)
    .map((n) => n.label);
  if (people.length) parts.push(`Active people: ${people.join(", ")}.`);

  // last topic from the most recent thoughtform
  const recent = [...thoughtforms].sort((a, b) => b.createdAt - a.createdAt);
  if (recent[0]) {
    const t = recent[0].polished_text.slice(0, 60);
    parts.push(`Last topic: ${t}.`);
  }

  // language hint
  const langNote =
    profile.secondaryLanguages.length > 0
      ? `Language: ${profile.primaryLanguage} with occasional ${profile.secondaryLanguages.join("/")}.`
      : `Language: ${profile.primaryLanguage}.`;
  parts.push(langNote);

  const prompt = clampPrompt(parts.join(" "));

  // ---- keyterms (priority-ordered) ----
  const keyterms: string[] = [];

  // 1) pinned domain vocab
  for (const d of domains) keyterms.push(...(d!.keyterms || []));

  // 2) graph proper nouns (Person/Project/Entity), ranked by degree+recency
  const ranked = rankedLabels(graph, 200);
  keyterms.push(...ranked);

  // 3) relevance-retrieved entities from similar past thoughtforms
  if (queryEmbedding && queryEmbedding.length) {
    const scored = thoughtforms
      .filter((t) => t.embedding && t.embedding.length)
      .map((t) => ({ t, s: cosine(queryEmbedding, t.embedding!) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 20);
    for (const { t } of scored) {
      for (const e of t.entities) keyterms.push(e.name);
    }
  } else {
    // fallback: recent thoughtform entities
    for (const t of recent.slice(0, 10)) {
      for (const e of t.entities) keyterms.push(e.name);
    }
  }

  const keyterms_prompt = clampKeyterms(keyterms);

  // ---- language code (omit for multilingual auto-detect) ----
  const language_code =
    profile.secondaryLanguages.length > 0 ? undefined : profile.primaryLanguage;

  return { prompt, keyterms_prompt, language_code };
}
