// ============================================================================
// Intent Kernel — deterministic router. Reads the structured JSON returned by
// the Groq cleanup pass and decides which typed agents to dispatch.
// Also defines the strict-JSON cleanup system prompt.
// ============================================================================

import type { AgentName, IntentType } from "./types";
import { GROQ_MODELS } from "./groq-client";

export const CLEANUP_SYSTEM_PROMPT = `You are the VOXEMBLY Intent Kernel cleanup pass.
Given a raw voice transcript, return STRICT JSON only (no prose, no markdown) with this exact shape:
{
  "intent": one of ["note","task","decision","question","idea","meeting","emotion","command","memory"],
  "polished_text": string (<= 300 chars, filler-free, fix disfluencies/false starts, preserve meaning),
  "title": string (<= 60 chars, a concise headline for this thought),
  "entities": string[] (proper nouns: people, projects, products, places),
  "actions": string[] (imperative next-steps implied by the thought),
  "sentiment": one of ["positive","neutral","negative","mixed"],
  "graph_mutations": [ { "op": "add_node"|"add_edge", "kind": "Person"|"Project"|"Concept"|"Task"|"Decision"|"Memory", "label": string } ],
  "suggested_agents": string[] (subset of ["Researcher","Executor","Devil's Advocate","Historian","Scheduler","Emotion Curator"])
}
Rules: Strip fillers ("um","uh","like","you know"), false starts, and repetitions. Keep the user's intent. Output ONLY the JSON object.`;

export interface CleanupResult {
  intent: IntentType;
  polished_text: string;
  title: string;
  entities: string[];
  actions: string[];
  sentiment: "positive" | "neutral" | "negative" | "mixed";
  graph_mutations: { op: string; kind: string; label: string }[];
  suggested_agents: AgentName[];
}

// Map intents → the agent fleet that should debate them.
const INTENT_AGENTS: Record<IntentType, AgentName[]> = {
  question: ["Researcher", "Historian"],
  idea: ["Researcher", "Devil's Advocate"],
  decision: ["Devil's Advocate", "Historian", "Researcher"],
  task: ["Executor", "Scheduler"],
  command: ["Executor"],
  meeting: ["Historian", "Scheduler"],
  memory: ["Historian"],
  emotion: ["Emotion Curator"],
  note: [],
};

export function dispatchAgents(intent: IntentType, suggested?: AgentName[]): AgentName[] {
  const base = INTENT_AGENTS[intent] ?? [];
  if (!suggested?.length) return base;
  // Union of deterministic mapping + LLM suggestions, deduped.
  return Array.from(new Set([...base, ...suggested]));
}

export const AGENT_MODELS: Record<AgentName, string> = {
  Researcher: GROQ_MODELS.reasoner,
  Executor: GROQ_MODELS.tools,
  "Devil's Advocate": GROQ_MODELS.contrarian,
  Historian: GROQ_MODELS.reasoner,
  Scheduler: GROQ_MODELS.multilingual,
  "Emotion Curator": GROQ_MODELS.fast,
};

export const AGENT_SYSTEM_PROMPTS: Record<AgentName, string> = {
  Researcher:
    "You are the Researcher agent. Given a thought, produce 2-3 crisp, cited-sounding findings that would advance it. Be concrete. <= 90 words.",
  Executor:
    "You are the Executor agent. Propose concrete tool actions (calendar event, PR draft, Slack message, Notion entry) with exact fields. <= 90 words.",
  "Devil's Advocate":
    "You are the Devil's Advocate. Produce a sharp contrarian risk register: the 3 strongest reasons this could fail. <= 90 words.",
  Historian:
    "You are the Historian. Recall whether this echoes a prior decision and surface the relevant context ('you already said X'). <= 80 words.",
  Scheduler:
    "You are the Scheduler. Extract date/time expressions and emit normalized ISO reminders + a one-line plan. <= 70 words.",
  "Emotion Curator":
    "You are the Emotion Curator. Assess valence/arousal and suggest one supportive, actionable nudge. <= 60 words.",
};
