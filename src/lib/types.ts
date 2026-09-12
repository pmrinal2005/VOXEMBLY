/**
 * VOXEMBLY core types.
 * A Thoughtform is the atomic unit: a typed, versioned, executable commit
 * produced from one dictation.
 */

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

export const NODE_TYPES = [
  "Person",
  "Project",
  "Concept",
  "Task",
  "Decision",
  "Emotion",
  "Location",
  "Domain",
  "Memory",
  "Entity",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const AGENTS = [
  "researcher",
  "executor",
  "devils_advocate",
  "historian",
  "scheduler",
  "emotion_curator",
] as const;
export type AgentKind = (typeof AGENTS)[number];

export const LANGUAGES: { code: string; name: string; native: string }[] = [
  { code: "en", name: "English", native: "English" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "no", name: "Norwegian", native: "Norsk" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "he", name: "Hebrew", native: "עברית" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ur", name: "Urdu", native: "اردو" },
  { code: "zh", name: "Mandarin", native: "中文" },
];

export type SyncRegion = "global" | "us" | "eu";
export type LatencyMode = "min_latency" | "balanced" | "max_accuracy";

/** Sync STT (Dictation) response — mirrors the AssemblyAI API reference exactly. */
export interface SyncWord {
  text: string;
  confidence: number;
  start?: number;
  end?: number;
}
export interface SyncTranscript {
  text: string;
  words: SyncWord[];
  confidence: number;
  audio_duration_ms: number;
  session_id: string;
  request_time_ms?: number;
}

/** Everything VOXEMBLY records about one Dictation API round-trip. */
export interface DictationTrace {
  region: SyncRegion;
  endpoint: string;
  model: "universal-3-5-pro";
  session_id: string;
  request_time_ms: number | null; // server-side (from AssemblyAI)
  client_roundtrip_ms: number; // browser keyup -> transcript received
  proxy_roundtrip_ms: number; // Next.js route -> AssemblyAI -> back
  audio_duration_ms: number;
  audio_bytes: number;
  audio_format: "audio/wav" | "audio/pcm";
  prompt: string;
  keyterms_prompt: string[];
  language_code: string | string[] | null;
  conversation_context: string[];
  timestamps: boolean;
  warmed: boolean;
  route: "sync" | "prerecorded"; // prerecorded when audio_too_large fallback fired
  retries: number;
}

export interface Entity {
  name: string;
  type: NodeType;
  description?: string;
}

export interface Action {
  kind: "calendar" | "reminder" | "message" | "pr_draft" | "note" | "search" | "other";
  title: string;
  when?: string | null; // ISO 8601
  target?: string | null; // person / channel / repo
  payload?: string | null;
  status: "proposed" | "done" | "skipped";
}

export type GraphMutation =
  | { op: "add_node"; id: string; type: NodeType; label: string; description?: string }
  | { op: "add_edge"; id: string; from: string; to: string; label: string; weight?: number }
  | { op: "invalidate_edge"; id: string }
  | { op: "update_node"; id: string; label?: string; description?: string };

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  created_at: number; // epoch ms
  branch: string;
  commit: string;
  mentions: number;
  last_seen: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  weight: number;
  valid_from: number; // epoch ms
  valid_to: number | null;
  branch: string;
  commit: string;
}

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

export interface AgentOutput {
  headline: string;
  bullets: string[];
  citations?: { title: string; url: string }[];
  risk_register?: { risk: string; severity: "low" | "med" | "high"; mitigation: string }[];
  related?: { commit: string; when: string; why: string }[];
  schedule?: { title: string; iso: string; human: string }[];
  actions?: Action[];
  valence?: number; // -1..1
  arousal?: number; // 0..1
  raw?: string;
}

/** Strict JSON returned by the Cleanup Pass (Groq llama-3.1-8b-instant). */
export interface CompiledThoughtform {
  intent: Intent;
  polished_text: string;
  title: string;
  entities: Entity[];
  actions: Action[];
  graph_mutations: GraphMutation[];
  suggested_agents: AgentKind[];
  sentiment: { valence: number; label: "negative" | "neutral" | "positive" };
  language_detected: string;
  command?: { verb: string; args: string[] } | null;
  keyterms_learned: string[];
}

export interface Thoughtform {
  id: string;
  commit_hash: string;
  parent_hashes: string[];
  branch: string;
  created_at: number;
  raw_text: string;
  words: SyncWord[];
  confidence: number;
  compiled: CompiledThoughtform;
  trace: DictationTrace;
  agent_runs: AgentRun[];
  embedding?: number[];
  embedding_model?: string;
  compile_ms: number;
  total_ms: number; // keyup -> compiled
  published?: boolean;
  merged_from?: string[]; // branches merged (merge commit)
}

export interface Branch {
  name: string;
  head: string | null; // commit hash
  created_at: number;
  parent_branch: string | null;
  forked_from: string | null; // commit hash
  color: string;
}

export interface Domain {
  id: string;
  name: string;
  emoji: string;
  prompt: string;
  keyterms: string[];
}

export interface Profile {
  id: string;
  display_name: string;
  primary_language: string;
  secondary_languages: string[];
  domains: string[];
  region: SyncRegion;
  latency_mode: LatencyMode;
  normalize_to: string | null; // target language for cleanup normalization
  locale_pack: "none" | "keigo" | "usted" | "hinglish";
  private_acronyms: string[];
  onboarded_at: number | null;
  high_contrast: boolean;
  reduce_motion: boolean;
}

export interface TwinSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  at: number;
  branch: string;
}

export interface PublishedThoughtform {
  hash: string;
  thoughtform: Thoughtform;
  snapshot: TwinSnapshot;
  author: string;
  published_at: number;
}
