// ============================================================================
// VOXEMBLY core domain types — the NEW family.
//
// A Thoughtform is a typed, versioned, executable "cognitive commit": the atomic
// operation of the voice-native cognition OS. It carries the verbatim transcript,
// the compiled (Intent-Kernel) interpretation, the dictation trace (latency/telemetry),
// and any Agent Council runs — all hashed like a Git commit.
// ============================================================================

/* ─────────────────────────── enums / vocabularies ─────────────────────────── */

export const INTENTS = [
  "note",
  "task",
  "decision",
  "question",
  "idea",
  "meeting",
  "emotion",
  "command",
  "memory",
] as const;
export type Intent = (typeof INTENTS)[number];
/** Back-compat alias used by some UI code. */
export type IntentType = Intent;

export const NODE_TYPES = [
  "Person",
  "Project",
  "Concept",
  "Task",
  "Decision",
  "Domain",
  "Location",
  "Emotion",
  "Memory",
  "Entity",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];
/** Back-compat alias. */
export type NodeKind = NodeType;

export const AGENTS = [
  "researcher",
  "executor",
  "devils_advocate",
  "historian",
  "scheduler",
  "emotion_curator",
] as const;
export type AgentKind = (typeof AGENTS)[number];

export type SyncRegion = "us" | "eu" | "global";

/* ─────────────────────────── AssemblyAI Sync STT ─────────────────────────── */

/** A word from the Sync STT response, with per-word confidence (drives the heatmap). */
export interface SyncWord {
  text: string;
  confidence: number; // 0..1
  start?: number; // ms
  end?: number; // ms
}
/** Back-compat alias. */
export type WordConfidence = SyncWord;

/** The raw payload we consume from `sync.assemblyai.com/transcribe`. */
export interface SyncTranscript {
  text: string;
  words: SyncWord[];
  confidence: number;
  audio_duration_ms?: number;
  session_id?: string;
  request_time_ms?: number; // drives the Latency Dial
  language_code?: string;
}
/** Back-compat alias. */
export type DictationResponse = SyncTranscript;

/** Everything we recorded about a single dictation round-trip (telemetry + config echo). */
export interface DictationTrace {
  region: SyncRegion;
  endpoint: string;
  model: string;
  session_id: string;
  request_time_ms: number | null;
  client_roundtrip_ms: number;
  proxy_roundtrip_ms: number;
  audio_duration_ms: number;
  audio_bytes: number;
  audio_format: "audio/wav" | "audio/pcm";
  prompt: string;
  keyterms_prompt: string[];
  language_code: string | string[] | null;
  conversation_context: string[];
  timestamps: boolean;
  warmed: boolean;
  route: "sync" | "prerecorded" | "local";
  retries: number;
}

/* ─────────────────────────── compiled thoughtform ─────────────────────────── */

export interface Entity {
  name: string;
  type: NodeType;
  description?: string;
}

export type ActionKind =
  | "calendar"
  | "reminder"
  | "message"
  | "pr_draft"
  | "note"
  | "search"
  | "other";

export interface ThoughtAction {
  kind: ActionKind;
  title: string;
  when: string | null; // ISO-8601
  target: string | null;
  payload: string | null;
  status: "proposed" | "done" | "dismissed";
}

/* graph mutations (temporal knowledge-graph ops) */
export type GraphMutation =
  | { op: "add_node"; id: string; type: NodeType; label: string; description?: string }
  | { op: "update_node"; id: string; label?: string; description?: string }
  | { op: "add_edge"; id: string; from: string; to: string; label: string; weight?: number }
  | { op: "invalidate_edge"; id: string };

export interface Sentiment {
  valence: number; // -1..1
  label: "negative" | "neutral" | "positive";
}
/** Back-compat string sentiment alias for old UI. */
export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed";

export interface VoiceCommandSpec {
  verb: string;
  args: string[];
}

/** The Intent Kernel's structured interpretation of an utterance. */
export interface CompiledThoughtform {
  intent: Intent;
  polished_text: string;
  title: string;
  entities: Entity[];
  actions: ThoughtAction[];
  graph_mutations: GraphMutation[];
  suggested_agents: AgentKind[];
  sentiment: Sentiment;
  language_detected: string;
  command: VoiceCommandSpec | null;
  keyterms_learned: string[];
}

/* ─────────────────────────── agents ─────────────────────────── */

export interface AgentCitation {
  title: string;
  url: string;
}

export interface RiskItem {
  risk: string;
  severity: "low" | "med" | "high";
  mitigation: string;
}

export interface RelatedRef {
  commit: string;
  when: string;
  why: string;
}

export interface ScheduleItem {
  title: string;
  iso: string;
  human: string;
}

/** Structured output of a single agent (shape depends on the agent kind). */
export interface AgentOutput {
  headline: string;
  bullets: string[];
  citations?: AgentCitation[];
  graph_suggestions?: { label: string; type: NodeType }[];
  actions?: ThoughtAction[];
  risk_register?: RiskItem[];
  related?: RelatedRef[];
  schedule?: ScheduleItem[];
  valence?: number;
  arousal?: number;
  reframe?: string;
  raw?: string;
}

/** A single Agent Council run, as persisted on the Thoughtform. */
export interface AgentRun {
  id: string;
  agent: AgentKind;
  model: string;
  provider: "groq" | "assemblyai-llm-gateway" | "local";
  status: "queued" | "running" | "done" | "error" | "paused";
  started_at: number;
  finished_at?: number;
  output?: AgentOutput;
  error?: string;
  latency_ms?: number;
}

/* ─────────────────────────── the Thoughtform commit ─────────────────────────── */

export interface Thoughtform {
  id: string;
  commit_hash: string;
  parent_hashes: string[];
  branch: string;
  created_at: number; // epoch ms
  raw_text: string;
  words: SyncWord[];
  confidence: number;
  compiled: CompiledThoughtform;
  trace: DictationTrace;
  agent_runs: AgentRun[];
  compile_ms: number;
  total_ms: number;
  /** vector for k-NN retrieval; only compared within the same model */
  embedding?: number[];
  embedding_model?: string;
  merged_from?: string[];
  published?: boolean;
}

/* ─────────────────────────── temporal knowledge graph ─────────────────────────── */

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  created_at: number;
  branch: string;
  commit: string;
  mentions: number;
  last_seen: number;
  // layout hints (optional, used by the canvas)
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  weight: number;
  valid_from: number;
  valid_to: number | null; // null = still live
  branch: string;
  commit: string;
}

/** A point-in-time slice of the graph (Time Travel). */
export interface TwinSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  at: number;
  branch: string;
}

/* ─────────────────────────── VCS ─────────────────────────── */

export interface Branch {
  name: string;
  head: string | null; // commit hash
  created_at: number;
  parent_branch: string | null;
  forked_from: string | null; // commit hash
  color: string;
}

/* ─────────────────────────── profile / domains / languages ─────────────────────────── */

export type LatencyMode = "min_latency" | "balanced" | "max_accuracy";
export type LocalePack = "none" | "keigo" | "usted" | "hinglish";

export interface Profile {
  id: string;
  display_name: string;
  primary_language: string;
  secondary_languages: string[];
  domains: string[]; // domain ids
  region: SyncRegion;
  latency_mode: LatencyMode;
  /** normalise polished_text into this ISO code, or null to preserve source language */
  normalize_to: string | null;
  locale_pack: LocalePack;
  private_acronyms: string[];
  onboarded_at: number | null;
  high_contrast: boolean;
  reduce_motion: boolean;
}

export interface Domain {
  id: string;
  name: string;
  emoji: string;
  prompt: string;
  keyterms: string[];
}

export interface Language {
  code: string;
  name: string;
  native?: string;
}

/** The 18-language matrix Universal-3.5 Pro supports (native code-switching). */
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "fr", name: "French", native: "Français" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
];

/* ─────────────────────────── published artifact ─────────────────────────── */

export interface PublishedThoughtform {
  hash: string;
  thoughtform: Thoughtform;
  snapshot: TwinSnapshot;
  author: string;
  published_at: number;
}
