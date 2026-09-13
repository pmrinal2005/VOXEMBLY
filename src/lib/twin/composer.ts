// ============================================================================
// VOXEMBLY — Prompt Composer.
//
// THE key differentiator: the bi-directional memory ↔ dictation loop. Before
// every dictation, this composes the `prompt` (<=50 words) and `keyterms_prompt`
// (<=1000 phrases) from the LIVE Cognitive Twin — current domain, active
// project/people, and the most-relevant recent Thoughtforms — so the API gets
// smarter with every utterance.
// ============================================================================

import type { ComposedContext, DictationConfig, Graph, Profile, Thoughtform } from "@/lib/types";
import { clampKeyterms, clampPrompt } from "@/lib/dictation/client";
import { rankedLabels } from "@/lib/twin/graph";
import { DOMAINS, domainById, languageLabel } from "@/lib/twin/domains";
import { cosine } from "@/lib/utils";

export { DOMAINS, domainById, languageLabel };

export interface ComposeInput {
  profile: Profile;
  graph: Graph;
  thoughtforms: Thoughtform[]; // history
  queryEmbedding?: number[]; // optional, for relevance retrieval
}

/**
 * Compose the next dictation context from memory.
 *   prompt   = domain base + active people + recent topic (natural sentence)
 *   keyterms = domain vocab → graph proper nouns → recent entities → acronyms
 */
export function compose(input: ComposeInput): ComposedContext {
  const { profile, graph, thoughtforms, queryEmbedding } = input;

  /* ---- prompt (natural-language scene-setting) ---- */
  const parts: string[] = [];
  const domains = profile.domains.map(domainById).filter(Boolean) as NonNullable<ReturnType<typeof domainById>>[];
  if (domains.length) parts.push(domains.map((d) => d.base_prompt).join(" "));

  // active people (Person nodes with recent activity)
  const people = Object.values(graph.nodes)
    .filter((n) => n.type === "Person" && n.valid_to == null)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, 3)
    .map((n) => n.label);
  if (people.length) parts.push(`Active people: ${people.join(", ")}.`);

  // last topic from the most recent thoughtform
  const recent = [...thoughtforms].sort((a, b) => b.created_at - a.created_at);
  if (recent[0]) parts.push(`Last topic: ${recent[0].compiled.polished_text.slice(0, 60)}.`);

  // language hint
  const langNote =
    profile.secondary_languages.length > 0
      ? `Language: ${languageLabel(profile.primary_language)} with occasional ${profile.secondary_languages
          .map(languageLabel)
          .join("/")}.`
      : `Language: ${languageLabel(profile.primary_language)}.`;
  parts.push(langNote);

  const prompt = clampPrompt(parts.join(" "));

  /* ---- keyterms (priority-ordered) ---- */
  const keyterms: string[] = [];
  // 1) pinned domain vocab
  for (const d of domains) keyterms.push(...(d.keyterms || []));
  // 2) graph proper nouns ranked by degree × mentions × recency
  keyterms.push(...rankedLabels(graph, 200));
  // 3) relevance-retrieved entities from similar past thoughtforms
  if (queryEmbedding && queryEmbedding.length) {
    const scored = thoughtforms
      .filter((t) => t.embedding && t.embedding.length)
      .map((t) => ({ t, s: cosine(queryEmbedding, t.embedding!) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 20);
    for (const { t } of scored) for (const e of t.compiled.entities) keyterms.push(e.name);
  } else {
    for (const t of recent.slice(0, 10)) for (const e of t.compiled.entities) keyterms.push(e.name);
  }
  // 4) the user's private acronym list
  keyterms.push(...(profile.private_acronyms || []));

  const keyterms_prompt = clampKeyterms(keyterms);

  // language_code — omit (null) for multilingual code-switch, else primary
  const language_code = profile.secondary_languages.length > 0 ? null : profile.primary_language;

  const config: DictationConfig = {
    prompt,
    keyterms_prompt,
    language_code,
    timestamps: profile.latency_mode === "max_accuracy",
  };

  return {
    config,
    stats: {
      prompt_words: prompt ? prompt.split(/\s+/).filter(Boolean).length : 0,
      keyterms: keyterms_prompt.length,
      keyterms_chars: keyterms_prompt.join(",").length,
      context_turns: Math.min(recent.length, 10),
    },
  };
}
