/**
 * Demo seed for the Cognitive Twin — a realistic, self-contained fixture.
 *
 * Why this exists: the Studio is gated behind onboarding and the graph canvas is *derived from*
 * `compiled.graph_mutations`. A demo/screenshot with an empty `graph_mutations` renders a blank
 * canvas (the exact bug called out in the build transcript). This module seeds a small commit DAG
 * — a `main` line plus a fork — where every Thoughtform carries proper `add_node` / `add_edge`
 * mutations, so the graph, timeline, commits list, and Thoughtform panel all populate at once.
 *
 * It is invoked only on demand (Settings → "Load demo Twin", or `/studio?seed=demo` in a dev build)
 * and never runs as part of the normal Push-to-Think loop.
 */

import type { AgentOutput, AgentRun, Branch, CompiledThoughtform, GraphMutation, NodeType, Profile, Thoughtform } from "@/lib/types";
import { computeCommitHash, mainBranch, BRANCH_COLORS } from "@/lib/twin/vcs";
import { uid } from "@/lib/utils";
import * as store from "@/lib/store/db";

const MIN = 60_000;

export const DEMO_PROFILE: Profile = {
  id: "me",
  display_name: "Priya Shah",
  primary_language: "en",
  secondary_languages: ["ja", "es"],
  domains: ["founder", "engineer"],
  region: "global",
  latency_mode: "balanced",
  normalize_to: null,
  locale_pack: "none",
  private_acronyms: ["PTT", "DMR", "RSC"],
  onboarded_at: Date.now() - 6 * 24 * 3600_000,
  high_contrast: false,
  reduce_motion: false,
};

interface Seed {
  minsAgo: number;
  branch: string;
  parents: "prev-on-branch" | "fork-from-decision" | string[];
  raw: string;
  compiled: Omit<CompiledThoughtform, "graph_mutations"> & { graph_mutations: GraphMutation[] };
  request_time_ms: number;
  agents?: AgentRun[];
}

const node = (id: string, type: NodeType, label: string, description?: string): GraphMutation => ({ op: "add_node", id, type, label, description });
const edge = (id: string, from: string, to: string, label: string, weight = 1): GraphMutation => ({ op: "add_edge", id, from, to, label, weight });

function agent(kind: AgentRun["agent"], model: string, headline: string, bullets: string[], extra?: Partial<AgentOutput>): AgentRun {
  return {
    id: `${kind}-seed-${uid()}`,
    agent: kind,
    model,
    provider: "groq",
    status: "done",
    started_at: Date.now() - 1400,
    finished_at: Date.now(),
    latency_ms: 900 + Math.round(Math.random() * 700),
    output: { headline, bullets, ...extra },
  };
}

/** The seed script. Ordered oldest → newest; `prev-on-branch` chains parent hashes automatically. */
const SEEDS: Seed[] = [
  {
    minsAgo: 60 * 22,
    branch: "main",
    parents: [],
    raw: "um so introduce myself I'm Priya I'm the founder building VOXEMBLY the voice native cognition OS with Kenji and Leo",
    request_time_ms: 128,
    compiled: {
      intent: "memory",
      title: "Founding the VOXEMBLY team",
      polished_text: "I'm Priya, founder of VOXEMBLY — a voice-native cognition OS — building it with Kenji and Leo.",
      entities: [
        { name: "Priya Shah", type: "Person" },
        { name: "VOXEMBLY", type: "Project" },
        { name: "Kenji Tanaka", type: "Person" },
        { name: "Leo Alvarez", type: "Person" },
      ],
      actions: [],
      suggested_agents: [],
      sentiment: { valence: 0.4, label: "positive" },
      language_detected: "en",
      keyterms_learned: ["VOXEMBLY", "Priya Shah", "Kenji Tanaka", "Leo Alvarez"],
      graph_mutations: [
        node("priya", "Person", "Priya Shah", "Founder"),
        node("voxembly", "Project", "VOXEMBLY", "Voice-native cognition OS"),
        node("kenji", "Person", "Kenji Tanaka", "Engineer"),
        node("leo", "Person", "Leo Alvarez", "Design"),
        edge("e1", "priya", "voxembly", "founds"),
        edge("e2", "kenji", "voxembly", "builds"),
        edge("e3", "leo", "voxembly", "builds"),
      ],
    },
  },
  {
    minsAgo: 60 * 9,
    branch: "main",
    parents: "prev-on-branch",
    raw: "idea what if every dictation becomes a typed thoughtform a git style commit for your mind",
    request_time_ms: 131,
    compiled: {
      intent: "idea",
      title: "Thoughtform as a cognitive commit",
      polished_text: "Every dictation becomes a typed Thoughtform — a Git-style commit for your mind.",
      entities: [
        { name: "Thoughtform", type: "Concept" },
        { name: "Cognitive Twin", type: "Concept" },
      ],
      actions: [],
      suggested_agents: ["devils_advocate", "historian"],
      sentiment: { valence: 0.6, label: "positive" },
      language_detected: "en",
      keyterms_learned: ["Thoughtform", "Cognitive Twin"],
      graph_mutations: [
        node("thoughtform", "Concept", "Thoughtform", "Typed, versioned dictation commit"),
        node("twin", "Concept", "Cognitive Twin", "Temporal knowledge graph + vector memory"),
        edge("e4", "thoughtform", "voxembly", "core primitive of"),
        edge("e5", "thoughtform", "twin", "mutates"),
      ],
    },
    agents: [
      agent("devils_advocate", "moonshotai/kimi-k2-instruct", "Commit metaphor may confuse non-engineers", [
        "Git framing is powerful for developers but opaque for clinicians and students.",
        "Mitigate with a plain-language mode: 'snapshots of your thinking'.",
      ], { risk_register: [{ risk: "Jargon alienates non-technical users", severity: "med", mitigation: "Plain-language toggle in onboarding" }] }),
      agent("historian", "llama-3.3-70b-versatile", "You raised versioned notes before", [
        "On Monday you compared this to Obsidian + Git plugins — but manual.",
        "This idea makes it automatic and voice-first.",
      ]),
    ],
  },
  {
    minsAgo: 60 * 6,
    branch: "main",
    parents: "prev-on-branch",
    raw: "task move the agent council latency task to Priya and Kenji before Friday",
    request_time_ms: 119,
    compiled: {
      intent: "task",
      title: "Assign Agent Council latency task",
      polished_text: "Move the Agent Council latency task to Priya and Kenji before Friday.",
      entities: [
        { name: "Agent Council", type: "Concept" },
        { name: "Priya Shah", type: "Person" },
        { name: "Kenji Tanaka", type: "Person" },
      ],
      actions: [{ kind: "reminder", title: "Agent Council latency — assign to Priya & Kenji", when: null, status: "proposed" }],
      suggested_agents: ["scheduler", "executor"],
      sentiment: { valence: 0.1, label: "neutral" },
      language_detected: "en",
      keyterms_learned: ["Agent Council"],
      graph_mutations: [
        node("council", "Concept", "Agent Council", "Society-of-Mind multi-agent debate"),
        node("task-latency", "Task", "Council latency task", "Reduce p95 under 2s"),
        edge("e6", "task-latency", "council", "improves"),
        edge("e7", "priya", "task-latency", "owns"),
        edge("e8", "kenji", "task-latency", "owns"),
      ],
    },
    agents: [
      agent("scheduler", "qwen/qwen3-32b", "Deadline normalised to Friday 17:00", [
        "Reminder set for Thu 16:00 as a buffer.",
      ], { schedule: [{ title: "Council latency task due", iso: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(), human: "Friday 5:00 PM" }] }),
    ],
  },
  {
    minsAgo: 60 * 3,
    branch: "main",
    parents: "prev-on-branch",
    raw: "decision should we stay on Neo4j Aura or migrate to FalkorDB I'm worried about the rate limits",
    request_time_ms: 134,
    compiled: {
      intent: "decision",
      title: "Graph store: Aura vs FalkorDB",
      polished_text: "Decide whether to stay on Neo4j Aura or migrate to FalkorDB, given the Aura Free rate limits.",
      entities: [
        { name: "Neo4j Aura", type: "Concept" },
        { name: "FalkorDB", type: "Concept" },
      ],
      actions: [],
      suggested_agents: ["researcher", "devils_advocate"],
      sentiment: { valence: -0.2, label: "negative" },
      language_detected: "en",
      keyterms_learned: ["Neo4j Aura", "FalkorDB"],
      graph_mutations: [
        node("aura", "Concept", "Neo4j Aura", "Managed graph, 3-day sleep on free tier"),
        node("falkor", "Concept", "FalkorDB", "500× faster traversals; self-host"),
        node("decision-graph", "Decision", "Graph store choice", "Open decision"),
        edge("e9", "decision-graph", "aura", "considers"),
        edge("e10", "decision-graph", "falkor", "considers"),
        edge("e11", "decision-graph", "twin", "affects"),
      ],
    },
    agents: [
      agent("researcher", "openai/gpt-oss-120b", "FalkorDB wins on traversal latency", [
        "FalkorDB benchmarks show large speedups on multi-hop Cypher.",
        "Aura Free sleeps after 3 days — needs a keep-alive cron either way.",
      ], { citations: [{ title: "FalkorDB vs Neo4j benchmark", url: "https://www.falkordb.com" }] }),
      agent("devils_advocate", "moonshotai/kimi-k2-instruct", "Don't migrate mid-hackathon", [
        "Switching graph stores 2 days before the deadline is high-risk.",
        "Keep Aura as primary, wire FalkorDB as hot standby.",
      ], { risk_register: [{ risk: "Migration eats build time", severity: "high", mitigation: "Standby now, migrate after demo" }] }),
    ],
  },
];

/** The fork: "Branch this into Plan A stay-on-Aura and Plan B migrate-to-FalkorDB." */
const FORK_SEEDS: Seed[] = [
  {
    minsAgo: 60 * 2,
    branch: "plan-a-stay-on-aura",
    parents: "fork-from-decision",
    raw: "plan A keep Aura as primary add a github action to ping it every sixty hours",
    request_time_ms: 122,
    compiled: {
      intent: "task",
      title: "Plan A — keep Aura, add keep-alive",
      polished_text: "Keep Neo4j Aura as primary; add a GitHub Action to ping it every 60 hours to defeat the sleep timer.",
      entities: [{ name: "GitHub Action", type: "Concept" }],
      actions: [{ kind: "pr_draft", title: "Add Aura keep-alive workflow", status: "proposed" }],
      suggested_agents: [],
      sentiment: { valence: 0.3, label: "positive" },
      language_detected: "en",
      keyterms_learned: ["GitHub Action"],
      graph_mutations: [
        node("keepalive", "Task", "Aura keep-alive cron", "GitHub Action every 60h"),
        edge("e12", "keepalive", "aura", "sustains"),
      ],
    },
  },
  {
    minsAgo: 60 * 1.5,
    branch: "plan-b-migrate-to-falkor",
    parents: "fork-from-decision",
    raw: "plan B stand up FalkorDB on a hugging face space and mirror the cypher subset",
    request_time_ms: 126,
    compiled: {
      intent: "task",
      title: "Plan B — FalkorDB on HF Space",
      polished_text: "Stand up FalkorDB on a Hugging Face Space and mirror the Cypher subset for hot failover.",
      entities: [{ name: "Hugging Face Space", type: "Concept" }],
      actions: [],
      suggested_agents: [],
      sentiment: { valence: 0.3, label: "positive" },
      language_detected: "en",
      keyterms_learned: ["Hugging Face Space"],
      graph_mutations: [
        node("hf-space", "Concept", "HF Space", "Docker CPU Basic, always-on"),
        edge("e13", "falkor", "hf-space", "deployed on"),
      ],
    },
  },
];

/** Build the full DAG and persist it. Returns the last commit on main to select. */
export async function seedDemoTwin(): Promise<{ selected: string; count: number }> {
  await store.wipeLocalTwin();

  const branches: Record<string, Branch> = { main: mainBranch() };
  const thoughtforms: Thoughtform[] = [];
  const now = Date.now();
  let colorIdx = 1;

  const lastHashOnBranch: Record<string, string | null> = { main: null };
  let decisionHash = "";

  async function commit(seed: Seed, parents: string[]): Promise<Thoughtform> {
    const created_at = now - seed.minsAgo * MIN;
    const hash = await computeCommitHash({
      parent_hashes: parents,
      branch: seed.branch,
      created_at,
      raw_text: seed.raw,
      polished_text: seed.compiled.polished_text,
      intent: seed.compiled.intent,
      session_id: uid("sess"),
    });
    const tf: Thoughtform = {
      id: uid("tf"),
      commit_hash: hash,
      parent_hashes: parents,
      branch: seed.branch,
      created_at,
      raw_text: seed.raw,
      words: seed.raw.split(/\s+/).map((t) => ({ text: t, confidence: 0.82 + Math.random() * 0.17 })),
      confidence: 0.9,
      compiled: seed.compiled as CompiledThoughtform,
      trace: {
        region: "global",
        endpoint: "https://sync.assemblyai.com",
        model: "universal-3-5-pro",
        session_id: uid("sess"),
        request_time_ms: seed.request_time_ms,
        client_roundtrip_ms: seed.request_time_ms + 240,
        proxy_roundtrip_ms: seed.request_time_ms + 40,
        audio_duration_ms: 6000 + Math.round(Math.random() * 8000),
        audio_bytes: 192000,
        audio_format: "audio/wav",
        prompt: "Founder VOXEMBLY sprint week. Active people: Priya, Kenji, Leo.",
        keyterms_prompt: seed.compiled.keyterms_learned,
        language_code: null,
        conversation_context: [],
        timestamps: false,
        warmed: true,
        route: "sync",
        retries: 0,
      },
      agent_runs: seed.agents ?? [],
      compile_ms: 90 + Math.round(Math.random() * 60),
      total_ms: seed.request_time_ms + 380,
    };
    thoughtforms.push(tf);
    return tf;
  }

  // main line
  for (const seed of SEEDS) {
    const parents = Array.isArray(seed.parents) ? seed.parents : lastHashOnBranch.main ? [lastHashOnBranch.main] : [];
    const tf = await commit(seed, parents);
    lastHashOnBranch.main = tf.commit_hash;
    branches.main.head = tf.commit_hash;
    if (seed.compiled.intent === "decision") decisionHash = tf.commit_hash;
  }

  // forks
  for (const seed of FORK_SEEDS) {
    if (!branches[seed.branch]) {
      branches[seed.branch] = {
        name: seed.branch,
        head: null,
        created_at: now - seed.minsAgo * MIN,
        parent_branch: "main",
        forked_from: decisionHash,
        color: BRANCH_COLORS[colorIdx++ % BRANCH_COLORS.length],
      };
    }
    const tf = await commit(seed, [decisionHash]);
    branches[seed.branch].head = tf.commit_hash;
  }

  // persist
  for (const tf of thoughtforms) await store.putThoughtform(tf);
  for (const b of Object.values(branches)) await store.putBranch(b);
  await store.saveProfile(DEMO_PROFILE);
  await store.setMeta("currentBranch", "main");

  return { selected: branches.main.head!, count: thoughtforms.length };
}
