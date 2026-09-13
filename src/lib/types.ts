// ============================================================================
// VOXEMBLY — Core type system. The single source of truth.
//
// The atomic unit of VOXEMBLY is the Thoughtform: a typed, versioned,
// executable object produced from a single dictation. Everything else
// (the Cognitive Twin graph, the VCS, the agent fleet) operates on it.
// ============================================================================

/** The nine typed intents the Intent Kernel classifies a Thoughtform into. */
export type Intent =
  | "note"
  | "task"
  | "decision"
  | "question"
  | "idea"
  | "meeting"
  | "emotion"
  | "command"
  | "memory";

export const INTENTS: Intent[] = [
  "note",
  "task",
  "decision",
  "question",
  "idea",
  "meeting",
  "emotion",
  "command",
  "memory",
];

/** Node kinds in the Cognitive Twin temporal knowledge graph. */
export type NodeKind =
  | "Entity"
  | "Person"
  | "Project"
  | "Domain"
  | "Location"
  | "Concept"
  | "Task"
  | "Decision"
  | "Emotion"
  | "Memory";

/** Typed micro-agents dispatched by the Intent Kernel. */
export type AgentKind =
  | "Researcher"
  | "Executor"
  | "DevilsAdvocate"
  | "Historian"
  | "Scheduler"
  | "EmotionCurator";

export const ALL_AGENTS: AgentKind[] = [
  "Researcher",
  "Executor",
  "DevilsAdvocate",
  "Historian",
  "Scheduler",
  "EmotionCurator",
];

/** A per-word confidence pair as returned by the Dictation API. */
export interface Word {
  text: string;
  confidence: number; // 0..1
  start?: number; // ms, optional
  end?: number; // ms, optional
}

/**
 * The response shape after the transcribe round-trip is normalized by the
 * DictationClient adapter. Field names are mapped from the raw AssemblyAI
 * Sync response so beta drift only touches one file.
 */
export interface TranscribeResponse {
  text: string;
  words: Word[];
  confidence: number; // overall 0..1
  audio_duration_ms: number;
  session_id: string;
  request_time_ms: number; // server-side processing time from AAI
  language_code?: string;
  region: AaiRegion;
  endpoint: string;
  /** true when the demo/simulation path produced this (no API key). */
  simulated?: boolean;
}

export type AaiRegion = "us" | "eu" | "global";

/** A graph mutation emitted by the compile pass and applied to the Twin. */
export interface GraphMutation {
  op: "add_node" | "add_edge" | "update_node";
  // node ops
  nodeId?: string;
  kind?: NodeKind;
  label?: string;
  // edge ops
  from?: string;
  to?: string;
  rel?: string;
  // temporal semantics (Graphiti-style)
  valid_from?: number; // epoch ms
  valid_to?: number | null;
}

/** A node in the temporal knowledge graph. */
export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  valid_from: number;
  valid_to: number | null;
  degree?: number;
  createdBy?: string; // commit hash that created it
}

/** A temporal edge. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  rel: string;
  valid_from: number;
  valid_to: number | null;
  createdBy?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** An extracted action (Executor / Scheduler input). */
export interface ThoughtAction {
  kind: "calendar" | "reminder" | "message" | "pr" | "note" | "search";
  title: string;
  when?: string; // ISO string for time-based actions
  target?: string; // e.g. Slack channel, repo
  done?: boolean;
}

/** A named entity mentioned in the utterance. */
export interface Entity {
  name: string;
  kind: NodeKind;
}

/** The output of a single agent run. */
export interface AgentRun {
  id: string;
  agent: AgentKind;
  model: string;
  status: "pending" | "running" | "done" | "error";
  output?: string;
  citations?: { title: string; url: string }[];
  startedAt: number;
  finishedAt?: number;
  thoughtformId: string;
}

/**
 * The Thoughtform — VOXEMBLY's atomic, typed, versioned, executable unit.
 * Each one is a commit against the Cognitive Twin.
 */
export interface Thoughtform {
  id: string;
  commit_hash: string;
  parent_hash: string | null;
  merge_parents?: string[]; // for merge commits
  branch: string;

  createdAt: number;
  language_code?: string;

  // transcription
  raw_text: string;
  polished_text: string;
  words: Word[];
  confidence: number;
  request_time_ms: number;
  audio_duration_ms: number;
  session_id: string;
  region: AaiRegion;
  simulated?: boolean;

  // cognition
  intent: Intent;
  sentiment: number; // -1..1
  entities: Entity[];
  actions: ThoughtAction[];
  graph_mutations: GraphMutation[];
  spawned_agents: AgentKind[];

  // memory
  embedding?: number[];

  // context that produced this (auditable)
  prompt_used?: string;
  keyterms_used?: string[];
}

/** A branch ref in the VCS. */
export interface Branch {
  name: string;
  head: string | null; // commit hash
  createdAt: number;
  createdFrom?: string | null;
}

/** The user profile / onboarding output. */
export interface Profile {
  id: string;
  displayName: string;
  primaryLanguage: string;
  secondaryLanguages: string[];
  domains: string[]; // domain ids
  region: AaiRegion;
  latencyMode: "min_latency" | "balanced" | "max_accuracy";
  ambientDefault: boolean;
  onboarded: boolean;
}

/** A Life Domain preset (keyterms + base prompt). */
export interface Domain {
  id: string;
  label: string;
  icon: string;
  basePrompt: string;
  keyterms: string[];
}

/** A published (public) Thoughtform artifact. */
export interface PublishedThoughtform {
  hash: string;
  thoughtform: Thoughtform;
  agentRuns: AgentRun[];
  graphSnapshot: Graph;
  publishedAt: number;
  author: string;
}

/** The strict-JSON contract returned by the Groq compile pass. */
export interface CompileResult {
  intent: Intent;
  polished_text: string;
  sentiment: number;
  entities: Entity[];
  actions: ThoughtAction[];
  graph_mutations: GraphMutation[];
  spawned_agents: AgentKind[];
}

/** A composed dictation context (prompt + keyterms) from the Prompt Composer. */
export interface ComposedContext {
  prompt: string;
  keyterms_prompt: string[];
  language_code?: string;
}

/** A single DMR (Deep Memory Retrieval) probe result. */
export interface DmrProbe {
  question: string;
  expected: string;
  got: string;
  pass: boolean;
}
