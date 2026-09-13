// ============================================================================
// VOXEMBLY core domain types
// A Thoughtform is a typed, versioned, executable "cognitive commit".
// ============================================================================

export type IntentType =
  | "note"
  | "task"
  | "decision"
  | "question"
  | "idea"
  | "meeting"
  | "emotion"
  | "command"
  | "memory";

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export type NodeKind =
  | "Person"
  | "Project"
  | "Concept"
  | "Task"
  | "Decision"
  | "Domain"
  | "Location"
  | "Emotion"
  | "Memory"
  | "Entity";

export type AgentName =
  | "Researcher"
  | "Executor"
  | "Devil's Advocate"
  | "Historian"
  | "Scheduler"
  | "Emotion Curator";

// A word from the AssemblyAI response, with per-word confidence.
export interface WordConfidence {
  text: string;
  confidence: number; // 0..1
  start?: number;
  end?: number;
}

// Raw response shape we consume from the Dictation / Sync STT endpoint.
export interface DictationResponse {
  text: string;
  words: WordConfidence[];
  confidence: number;
  audio_duration_ms?: number;
  session_id?: string;
  request_time_ms?: number; // drives the Latency Dial
  language_code?: string;
}

// A node in the temporal knowledge graph (the Cognitive Twin).
export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x?: number;
  y?: number;
  valid_from: number; // epoch ms
  valid_to: number | null; // null = still live
  createdByCommit?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  valid_from: number;
  valid_to: number | null;
}

export interface GraphMutation {
  op: "add_node" | "add_edge" | "invalidate_node" | "invalidate_edge";
  node?: Partial<GraphNode>;
  edge?: Partial<GraphEdge>;
}

// Output of an individual Agent Council member.
export interface AgentRun {
  agent: AgentName;
  model: string; // the Groq model this agent used
  status: "pending" | "running" | "done" | "error";
  output?: string;
  startedAt?: number;
  finishedAt?: number;
}

// The atomic unit of cognition: a commit against your knowledge graph.
export interface Thoughtform {
  commit_hash: string;
  parent_hashes: string[];
  branch: string;
  intent: IntentType;
  raw_text: string;
  polished_text: string;
  final_text: string;
  entities: string[];
  actions: string[];
  sentiment: Sentiment;
  language: string;
  confidence: number;
  request_time_ms: number;
  audio_duration_ms?: number;
  session_id?: string;
  words: WordConfidence[];
  graph_mutations: GraphMutation[];
  spawned_agents: AgentName[];
  agent_runs?: AgentRun[];
  title: string;
  created_at: number; // epoch ms
}

export interface Branch {
  name: string;
  head: string; // commit hash
  color: string;
  parentBranch?: string;
  forkedFrom?: string; // commit hash
}

// The full versioned state of a user's mind.
export interface CognitiveState {
  thoughtforms: Record<string, Thoughtform>;
  order: string[]; // chronological commit hashes
  branches: Branch[];
  currentBranch: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Composed dictation config (what we send to AssemblyAI).
export interface DictationConfig {
  prompt: string;
  keyterms_prompt: string[];
  language_code?: string;
  region: "us" | "eu" | "global";
}
