/**
 * Prompt Composer — the bi-directional memory ↔ dictation loop.
 *
 * Before every dictation, the Cognitive Twin writes the next request's `prompt` (natural-language
 * DESCRIPTION of the audio, 20–50 words; language stated inside because `language_code` is ignored
 * when a custom prompt is set), `keyterms_prompt` (≤100 terms, ≤6 words each, exact spelling —
 * we self-impose the documented ≤2048-char guidance to avoid over-correction) and
 * `conversation_context` (previous utterances, oldest → newest).
 *
 * Everything is grounded in https://www.assemblyai.com/docs/sync-stt/prompting-and-keyterms and
 * https://www.assemblyai.com/docs/sync-stt/conversation-context
 */
import type { DictationConfig } from "@/lib/dictation/client";
import { LANGUAGES, type Domain, type Profile, type Thoughtform } from "@/lib/types";
import { rankedLabels, type TwinGraph } from "@/lib/twin/graph";

export const KEYTERMS_CHAR_BUDGET = 2048; // docs' recommended ceiling ("keep the total under 2048 characters")
export const KEYTERMS_MAX = 100; // hard API max
export const PROMPT_WORD_BUDGET = 50; // "detailed" band per docs
export const CONTEXT_TURNS = 6;

export const DOMAINS: Domain[] = [
  {
    id: "founder",
    name: "Founder",
    emoji: "🚀",
    prompt: "A startup founder dictating product decisions, investor updates, hiring notes and sprint planning.",
    keyterms: ["runway", "ARR", "MRR", "churn", "burn rate", "go-to-market", "SAFE note", "cap table", "product-market fit", "OKRs", "roadmap", "sprint", "pre-seed", "Series A", "term sheet"],
  },
  {
    id: "engineer",
    name: "Engineer",
    emoji: "🛠️",
    prompt: "A software engineer dictating technical notes about services, pull requests, incidents and architecture.",
    keyterms: ["pull request", "Kubernetes", "PostgreSQL", "pgvector", "Neo4j", "Supabase", "Next.js", "TypeScript", "WebSocket", "latency", "p50", "p99", "OAuth", "GraphQL", "Docker", "CI/CD", "monorepo", "Redis"],
  },
  {
    id: "researcher",
    name: "Researcher",
    emoji: "🔬",
    prompt: "An academic researcher dictating notes about papers, experiments, hypotheses and literature reviews.",
    keyterms: ["hypothesis", "ablation", "baseline", "arXiv", "peer review", "benchmark", "knowledge graph", "retrieval", "embedding", "MemGPT", "Graphiti", "Zep", "state of the art", "confidence interval", "p-value"],
  },
  {
    id: "clinician",
    name: "Clinician",
    emoji: "🩺",
    prompt: "A clinician dictating clinical notes between patients: symptoms, differentials, medications and follow-ups.",
    keyterms: ["differential diagnosis", "hypertension", "metformin", "lisinopril", "atorvastatin", "ECG", "tachycardia", "BP", "follow-up", "referral", "SOAP note", "PRN", "BID", "contraindication", "triage"],
  },
  {
    id: "student",
    name: "Student",
    emoji: "🎓",
    prompt: "A university student dictating lecture notes, assignment plans, deadlines and study reflections.",
    keyterms: ["syllabus", "midterm", "thesis", "office hours", "citation", "bibliography", "problem set", "GPA", "seminar", "deadline"],
  },
  {
    id: "parent",
    name: "Parent",
    emoji: "🏠",
    prompt: "A parent dictating family logistics: school pickups, appointments, groceries, activities and reminders.",
    keyterms: ["pediatrician", "PTA", "daycare", "soccer practice", "playdate", "permission slip", "carpool", "allergy", "babysitter"],
  },
  {
    id: "pm",
    name: "Product Manager",
    emoji: "🧭",
    prompt: "A product manager dictating user feedback, prioritisation decisions, PRDs and stakeholder updates.",
    keyterms: ["PRD", "user story", "backlog", "stakeholder", "NPS", "retention", "activation", "A/B test", "MVP", "roadmap", "Jira", "Figma", "Notion"],
  },
  {
    id: "broker",
    name: "Real-estate Broker",
    emoji: "🏡",
    prompt: "A real-estate broker dictating property tour highlights, listing details, client follow-ups and showings.",
    keyterms: ["listing", "escrow", "MLS", "square footage", "HOA", "closing costs", "open house", "pre-approval", "comps", "appraisal"],
  },
];

export const domainById = (id: string) => DOMAINS.find((d) => d.id === id);

function langName(code: string) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function words(s: string) {
  return s.split(/\s+/).filter(Boolean);
}
function capWords(s: string, n: number) {
  const w = words(s);
  return w.length <= n ? s : w.slice(0, n).join(" ");
}

export interface ComposerInput {
  profile: Profile;
  graph: TwinGraph;
  recent: Thoughtform[]; // newest first
  similar?: Thoughtform[]; // top-k by embedding for the current context (optional)
  currentProject?: string | null;
  learnedKeyterms: string[]; // from compiled.keyterms_learned across history (newest first)
  branch: string;
}

export interface ComposedConfig {
  config: DictationConfig;
  stats: { prompt_words: number; keyterms: number; keyterms_chars: number; context_turns: number; sources: Record<string, number> };
  explanation: string[];
}

/** The composer: memory → next request. */
export function composeDictationConfig(input: ComposerInput): ComposedConfig {
  const { profile, graph, recent, similar = [], learnedKeyterms, branch } = input;
  const explanation: string[] = [];
  const sources: Record<string, number> = { domain: 0, project: 0, graph: 0, learned: 0, acronyms: 0 };

  // ---------- prompt (description of the audio, NOT instructions) ----------
  const domains = profile.domains.map(domainById).filter(Boolean) as Domain[];
  const langs = [profile.primary_language, ...profile.secondary_languages].filter(Boolean);
  const langPhrase =
    langs.length > 1
      ? `Speech in ${langs.map(langName).join(", ")} with code-switching between them`
      : `Speech in ${langName(langs[0] ?? "en")}`;

  const people = rankedLabels(graph, Date.now(), 4, ["Person"]).map((n) => n.label);
  const projects = rankedLabels(graph, Date.now(), 2, ["Project"]).map((n) => n.label);
  const project = input.currentProject ?? projects[0] ?? null;
  const lastTopics = recent.slice(0, 3).map((t) => t.compiled.title).filter(Boolean);

  const parts: string[] = [];
  parts.push(domains.length ? `${profile.display_name || "A"} ${domains.map((d) => d.name.toLowerCase()).join(" and ")} dictating personal notes.` : `${profile.display_name || "A person"} dictating personal notes.`);
  if (project) parts.push(`Current project: ${project}.`);
  if (people.length) parts.push(`People mentioned: ${people.join(", ")}.`);
  if (lastTopics.length) parts.push(`Recent topics: ${lastTopics.join("; ")}.`);
  parts.push(`${langPhrase}.`);
  let prompt = parts.join(" ");
  if (words(prompt).length > PROMPT_WORD_BUDGET) {
    // trim recent topics first, then people
    const trimmed = [parts[0], project ? `Current project: ${project}.` : "", people.length ? `People: ${people.slice(0, 3).join(", ")}.` : "", `${langPhrase}.`].filter(Boolean).join(" ");
    prompt = words(trimmed).length > PROMPT_WORD_BUDGET ? capWords(trimmed, PROMPT_WORD_BUDGET) : trimmed;
  }
  explanation.push(`prompt: ${words(prompt).length} words (domain + project + people + recent topics + language)`);

  // ---------- keyterms (priority ladder) ----------
  const terms: string[] = [];
  const seen = new Set<string>();
  let chars = 0;
  const push = (t: string, src: keyof typeof sources) => {
    const clean = t.trim();
    if (!clean || clean.length < 2) return false;
    if (words(clean).length > 6) return false;
    if (/^[a-z]{1,4}$/.test(clean)) return false; // common short lowercase words hurt (docs: avoid common words)
    const k = clean.toLowerCase();
    if (seen.has(k)) return false;
    if (terms.length >= KEYTERMS_MAX || chars + clean.length > KEYTERMS_CHAR_BUDGET) return false;
    seen.add(k);
    terms.push(clean);
    chars += clean.length;
    sources[src]++;
    return true;
  };

  // 0. brand + product vocabulary
  ["VOXEMBLY", "Thoughtform", "Cognitive Twin", "AssemblyAI"].forEach((t) => push(t, "domain"));
  // 1. pinned domain vocab
  for (const d of domains) for (const k of d.keyterms) push(k, "domain");
  // 2. private acronyms
  for (const a of profile.private_acronyms) push(a, "acronyms");
  // 3. current project's proper nouns (graph neighbourhood)
  for (const n of rankedLabels(graph, Date.now(), 12, ["Project"])) push(n.label, "project");
  // 4. recent people / entities from graph (recency × mentions × degree)
  for (const n of rankedLabels(graph, Date.now(), 60, ["Person", "Entity", "Concept", "Location", "Task", "Decision"])) push(n.label, "graph");
  // 5. keyterms the compiler learned (newest first)
  for (const k of learnedKeyterms) push(k, "learned");
  // 6. proper nouns from semantically similar past thoughtforms
  for (const t of similar) for (const e of t.compiled.entities) push(e.name, "graph");

  explanation.push(`keyterms: ${terms.length} terms / ${chars} chars — domain ${sources.domain}, project ${sources.project}, graph ${sources.graph}, learned ${sources.learned}, acronyms ${sources.acronyms}`);

  // ---------- conversation context (oldest → newest) ----------
  const ctx = recent
    .filter((t) => t.branch === branch)
    .slice(0, CONTEXT_TURNS)
    .reverse()
    .map((t) => t.compiled.polished_text)
    .filter(Boolean);
  if (ctx.length) explanation.push(`conversation_context: ${ctx.length} previous turns on branch "${branch}"`);

  const config: DictationConfig = {
    prompt,
    keyterms_prompt: terms,
    // language_code is ignored when prompt is set (docs) — but we pass it anyway so the no-prompt fallback path stays correct.
    language_code: langs.length > 1 ? langs : langs[0] ?? "en",
    conversation_context: ctx.length ? ctx : undefined,
    timestamps: true,
  };

  return {
    config,
    stats: { prompt_words: words(prompt).length, keyterms: terms.length, keyterms_chars: chars, context_turns: ctx.length, sources },
    explanation,
  };
}
