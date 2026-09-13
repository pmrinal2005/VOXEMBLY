// ============================================================================
// Prompt Composer — the bi-directional loop (§3.2/§4.3 Stage 1).
// Assembles the AssemblyAI `prompt` (<= ~50 words) and `keyterms_prompt`
// (<= 1000 phrases, <= 6 words each, total < 2048 chars) from the LIVE
// Cognitive Twin state, so the API gets smarter with every utterance.
// ============================================================================

import type { CognitiveState, GraphNode, Thoughtform } from "./types";

const KEYTERMS_CHAR_BUDGET = 2000; // stay safely under the 2048 char ceiling
const MAX_PROMPT_WORDS = 48; // under the 50-word "detailed" ceiling

export interface ComposedContext {
  prompt: string;
  keyterms_prompt: string[];
  activeProject?: string;
  activePeople: string[];
  lastTopics: string[];
}

function liveNodes(state: CognitiveState): GraphNode[] {
  return state.nodes.filter((n) => n.valid_to === null);
}

export function composePrompt(
  state: CognitiveState,
  opts?: { domain?: string; language?: string }
): ComposedContext {
  const nodes = liveNodes(state);

  const project = nodes.find((n) => n.kind === "Project");
  const people = nodes.filter((n) => n.kind === "Person").map((n) => n.label);

  const recent: Thoughtform[] = state.order
    .slice(-3)
    .map((h) => state.thoughtforms[h])
    .filter(Boolean);
  const lastTopics = recent.map((t) => t.title).filter(Boolean);

  const domain = opts?.domain ?? "Founder";
  const lang = opts?.language ?? "English";

  // Compose a <=48-word natural-language scene setter.
  const parts: string[] = [];
  parts.push(`${domain} at VOXEMBLY, sprint week.`);
  if (project) parts.push(`Current project: ${project.label}.`);
  if (people.length) parts.push(`Active people: ${people.slice(0, 4).join(", ")}.`);
  if (lastTopics.length) parts.push(`Last topic: ${lastTopics[lastTopics.length - 1]}.`);
  parts.push(`Language: ${lang} with occasional code-switching.`);
  let prompt = parts.join(" ");
  const words = prompt.split(/\s+/);
  if (words.length > MAX_PROMPT_WORDS) {
    prompt = words.slice(0, MAX_PROMPT_WORDS).join(" ");
  }

  // Build keyterms in priority order, deduped, char-budgeted.
  const domainVocab = DOMAIN_KEYTERMS[domain] ?? [];
  const projectTerms = project ? [project.label] : [];
  const conceptTerms = nodes
    .filter((n) => n.kind === "Concept" || n.kind === "Task" || n.kind === "Decision")
    .map((n) => n.label);
  const peopleTerms = people;

  const ordered = [
    ...BASE_KEYTERMS,
    ...domainVocab,
    ...projectTerms,
    ...peopleTerms,
    ...conceptTerms,
  ];

  const keyterms: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const raw of ordered) {
    const term = raw.trim();
    if (!term) continue;
    // <= 6 words each
    if (term.split(/\s+/).length > 6) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    if (chars + term.length + 1 > KEYTERMS_CHAR_BUDGET) break;
    if (keyterms.length >= 1000) break;
    seen.add(key);
    keyterms.push(term);
    chars += term.length + 1;
  }

  return {
    prompt,
    keyterms_prompt: keyterms,
    activeProject: project?.label,
    activePeople: people,
    lastTopics,
  };
}

export const BASE_KEYTERMS = [
  "VOXEMBLY",
  "Thoughtform",
  "Cognitive Twin",
  "AssemblyAI",
  "Universal 3 5 Pro",
  "GroqCloud",
  "LangGraph",
  "pgvector",
];

export const DOMAIN_KEYTERMS: Record<string, string[]> = {
  Founder: ["runway", "cap table", "seed round", "ARR", "MRR", "roadmap"],
  Researcher: ["ablation", "benchmark", "corpus", "embedding", "citation"],
  Clinician: ["differential", "dosage", "contraindication", "triage"],
  Engineer: ["monorepo", "pull request", "refactor", "latency", "rate limit"],
  Parent: ["pediatrician", "carpool", "PTA", "bedtime"],
  Student: ["syllabus", "midterm", "thesis", "office hours"],
};
