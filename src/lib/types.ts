// ============================================================================
// VOXEMBLY — Core type system. The single source of truth for the whole app.
//
// The atomic unit of VOXEMBLY is the Thoughtform: a typed, versioned,
// executable object produced from a single dictation. Everything else
// (the Cognitive Twin graph, the VCS, the agent fleet) operates on it.
// ============================================================================

/* ─────────────────────────── AssemblyAI Sync STT ─────────────────────────── */

/** Region routing for the Dictation / Sync STT endpoint. */
export type SyncRegion = "us" | "eu" | "global";

/** A per-word confidence pair as returned by the Dictation API. */
export interface SyncWord {
  text: string;
  confidence: number; // 0..1
  start?: number; // ms, optional
  end?: number; // ms, optional
}

/**
 * The normalized transcript returned by the DictationClient adapter — mapped
 * from the raw AssemblyAI Sync response so beta drift only touches one file.
 */
export interface SyncTranscript {
  text: string;
  words: SyncWord[];
  confidence: number; // overall 0..1
  audio_duration_ms: number;
  session_id: string;
  request_time_ms: number; // server-side processing time from AAI
  language_code: string | null;
}

/**
 * The full trace attached to a Thoughtform — everything auditable about how the
 * dictation was captured, sent, and transcribed. Powers the Latency Dial,
 * Confidence Heatmap and the trace sheet.
 */
export interface DictationTrace {
  region: SyncRegion;
  endpoint: string;
  model: string;
  session_id: string;
  request_time_ms: number | null; // AAI server-side time
  client_roundtrip_ms: number; // key-up → response, measured client-side
  proxy_roundtrip_ms: number | null; // our route handler round-trip
  audio_duration_ms: number;
  audio_bytes: number;
  audio_format: string;
  prompt: string;
  keyterms_prompt: string[];
  language_code: string | null;
  conversation_context: string[];
  timestamps: boolean;
  warmed: boolean;
  route: "sync" | "prerecorded" | "simulated";
  retries: number;
  simulated?: boolean;
}

/* ─────────────────────────── Cognition types ─────────────────────────── */

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
export type NodeType =
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

/** Typed micro-agents dispatched by the Intent Kernel (snake_case ids). */
export type AgentKind =
  | "researcher"
  | "executor"
  | "devils_advocate"
  | "historian"
  | "scheduler"
  | "emotion_curator";

export const ALL_AGENTS: AgentKind[] = [
  "researcher",
  "executor",
  "devils_advocate",
  "historian",
  "scheduler",
  "emotion_curator",
];

/** A named entity mentioned in the utterance. */
export interface Entity {
  name: string;
  type: NodeType;
  description?: string;
}

/** Sentiment / valence analysis. */
export interface Sentiment {
  valence: number; // -1..1
  label: "positive" | "neutral" | "negative";
}

/** An extracted action (Executor / Scheduler input). */
export interface ThoughtAction {
  kind: "calendar" | "reminder" | "message" | "pr_draft" | "note" | "search";
  title: string;
  when?: string | null; // ISO string for time-based actions
  target?: string; // e.g. Slack channel, repo
  status: "proposed" | "done" | "skipped";
  payload?: string;
}

/* ─────────────────────────── Graph (Record-based) ─────────────────────────── */

/** A graph mutation emitted by the compile pass and applied to the Twin. */
export interface GraphMutation {
  op: "add_node" | "add_edge" | "update_node" | "invalidate_edge";
  // node ops
  id?: string;
  type?: NodeType;
  label?: string;
  description?: string;
  // edge ops
  from?: string;
  to?: string;
  weight?: number;
}

/** A node in the temporal knowledge graph (Graphiti-style validity window). */
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  valid_from: number;
  valid_to: number | null;
  degree: number;
  mentions: number;
  createdBy: string; // commit hash that created it
  lastSeen: number;
}

/** A temporal edge. */
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  weight: number;
  valid_from: number;
  valid_to: number | null;
  createdBy: string;
}

/** The Cognitive Twin graph — Record-keyed for O(1) mutation. */
export interface Graph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
}

/* ─────────────────────────── Agents ─────────────────────────── */

export interface RiskItem {
  risk: string;
  severity: "low" | "med" | "high";
  mitigation: string;
}

export interface ScheduleItem {
  title: string;
  iso: string;
  human: string;
}

export interface Citation {
  title: string;
  url: string;
}

export interface AgentAction {
  kind: string;
  title: string;
  payload?: string;
  when?: string;
  target?: string;
}

export interface RelatedCommit {
  commit: string;
  when: string;
  why: string;
}

/** The structured output a single agent produces. */
export interface AgentOutput {
  headline: string;
  bullets: string[];
  citations?: Citation[];
  risk_register?: RiskItem[];
  schedule?: ScheduleItem[];
  actions?: AgentAction[];
  related?: RelatedCommit[];
  valence?: number;
  arousal?: number;
  raw?: string;
}

export type AgentStatus = "queued" | "running" | "done" | "error" | "paused";

/** The record of a single agent run. */
export interface AgentRun {
  id: string;
  agent: AgentKind;
  model: string;
  provider: string;
  status: AgentStatus;
  started_at: number;
  finished_at?: number;
  latency_ms?: number;
  output?: AgentOutput;
  error?: string;
}

/* ─────────────────────────── Thoughtform ─────────────────────────── */

/** The strict-JSON contract the Groq compile pass returns. */
export interface CompiledThoughtform {
  intent: Intent;
  title: string;
  polished_text: string;
  entities: Entity[];
  actions: ThoughtAction[];
  suggested_agents: AgentKind[];
  sentiment: Sentiment;
  language_detected: string;
  keyterms_learned: string[];
  graph_mutations: GraphMutation[];
}

/**
 * The Thoughtform — VOXEMBLY's atomic, typed, versioned, executable unit.
 * Each one is a commit against the Cognitive Twin.
 */
export interface Thoughtform {
  id: string;
  commit_hash: string;
  parent_hashes: string[]; // 0 = genesis, 1 = normal, 2 = merge
  branch: string;
  created_at: number;

  // transcription (verbatim)
  raw_text: string;
  words: SyncWord[];
  confidence: number;

  // cognition (the compiled, polished, typed payload)
  compiled: CompiledThoughtform;

  // provenance
  trace: DictationTrace;
  agent_runs: AgentRun[];
  compile_ms: number;
  total_ms: number;

  // memory
  embedding?: number[];
  embedding_model?: string;

  // lifecycle
  published?: boolean;
  /** Set on two-parent merge commits. */
  merged_from?: string[];
}

/* ─────────────────────────── VCS ─────────────────────────── */

/** A branch ref in the VCS. */
export interface Branch {
  name: string;
  head: string | null; // commit hash
  created_at: number;
  parent_branch?: string | null;
  forked_from?: string | null;
  color: string;
}

/* ─────────────────────────── Profile / domains ─────────────────────────── */

export type LatencyMode = "min_latency" | "balanced" | "max_accuracy";

/** The user profile / onboarding output. */
export interface Profile {
  id: string;
  display_name: string;
  primary_language: string;
  secondary_languages: string[];
  domains: string[]; // domain ids
  region: SyncRegion;
  latency_mode: LatencyMode;
  normalize_to: string | null; // normalize code-switched output to this language
  locale_pack: "none" | "keigo" | "usted" | "devanagari";
  private_acronyms: string[];
  onboarded_at: number | null;
  high_contrast: boolean;
  reduce_motion: boolean;
}

/** A Life Domain preset (keyterms + base prompt). */
export interface Domain {
  id: string;
  label: string;
  name: string;
  icon: string;
  emoji: string;
  base_prompt: string;
  prompt: string;
  keyterms: string[];
}

/** A supported dictation language. */
export interface Language {
  code: string;
  label: string;
  name: string;
  native: string;
}

/** The 18-language matrix Universal-3.5 Pro supports. */
export const LANGUAGES: Language[] = [
  { code: "en", label: "English", name: "English", native: "English" },
  { code: "es", label: "Spanish", name: "Spanish", native: "Español" },
  { code: "fr", label: "French", name: "French", native: "Français" },
  { code: "de", label: "German", name: "German", native: "Deutsch" },
  { code: "it", label: "Italian", name: "Italian", native: "Italiano" },
  { code: "pt", label: "Portuguese", name: "Portuguese", native: "Português" },
  { code: "nl", label: "Dutch", name: "Dutch", native: "Nederlands" },
  { code: "hi", label: "Hindi", name: "Hindi", native: "हिन्दी" },
  { code: "ja", label: "Japanese", name: "Japanese", native: "日本語" },
  { code: "zh", label: "Chinese", name: "Chinese", native: "中文" },
  { code: "ko", label: "Korean", name: "Korean", native: "한국어" },
  { code: "ru", label: "Russian", name: "Russian", native: "Русский" },
  { code: "tr", label: "Turkish", name: "Turkish", native: "Türkçe" },
  { code: "pl", label: "Polish", name: "Polish", native: "Polski" },
  { code: "uk", label: "Ukrainian", name: "Ukrainian", native: "Українська" },
  { code: "vi", label: "Vietnamese", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "id", label: "Indonesian", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "fi", label: "Finnish", name: "Finnish", native: "Suomi" },
];

/* ─────────────────────────── Compose / publish / DMR ─────────────────────────── */

/** The dictation config sent to the Sync STT endpoint. */
export interface DictationConfig {
  prompt: string;
  keyterms_prompt: string[];
  language_code: string | null;
  timestamps?: boolean;
}

/** A composed dictation context (prompt + keyterms) plus telemetry stats. */
export interface ComposedContext {
  config: DictationConfig;
  stats: {
    prompt_words: number;
    keyterms: number;
    keyterms_chars: number;
    context_turns: number;
  };
}

/** A published (public) Thoughtform artifact. */
export interface PublishedThoughtform {
  hash: string;
  thoughtform: Thoughtform;
  snapshot: Graph;
  author: string;
  published_at: number;
}

/** A single DMR (Deep Memory Retrieval) probe result. */
export interface DmrProbe {
  question: string;
  expected: string;
  got: string;
  pass: boolean;
  id?: string;
  kind?: string;
  hit?: boolean;
  rank?: number;
}

/* ─────────────────────────── Pipeline transport types ─────────────────────────── */

/**
 * Region alias. The Dictation adapter and the API routes both refer to routing
 * regions as `AaiRegion`; it is identical to `SyncRegion`.
 */
export type AaiRegion = SyncRegion;

/** Alias kept for the DictationClient adapter's normalized word shape. */
export type Word = SyncWord;

/**
 * The normalized response the `/api/transcribe` route returns and the client
 * pipeline consumes. `transcript` is the AssemblyAI Sync payload mapped into
 * VOXEMBLY's shape; `meta` carries our own proxy-side telemetry.
 */
export interface TranscribeResponse {
  transcript: SyncTranscript;
  meta: {
    proxy_ms: number | null; // route-handler round-trip to AAI
    warmed: boolean;
    region: SyncRegion;
    endpoint: string;
    route: "sync" | "prerecorded" | "simulated";
    retries: number;
    simulated?: boolean;
  };
}

/** The result of the Groq compile pass, returned by `/api/compile`. */
export interface CompileResult {
  compiled: CompiledThoughtform;
  compile_ms: number;
  degraded: boolean; // true when the heuristic (no-LLM) compiler was used
}

/**
 * An offline draft: a dictation captured while offline, queued in IndexedDB and
 * replayed when connectivity returns (accessibility / low-bandwidth path).
 */
export interface DraftRecord {
  id: string;
  created_at: number;
  audio: Blob;
  contentType: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  branch: string;
  config: DictationConfig;
  attempts: number;
}
