// ============================================================================
// Seed data — a pre-populated Cognitive Twin so the dashboard is alive on load
// (matches the reference: 11 nodes, 6 commits, 3 branches on main).
// Fork seeds use a marker string so the main-line loop never mis-reads parents.
// ============================================================================

import type {
  Branch,
  CognitiveState,
  GraphEdge,
  GraphNode,
  Thoughtform,
  IntentType,
  AgentName,
} from "./types";
import { shortHash } from "./utils";

const HOUR = 3600_000;
const now = Date.now();

// Parent markers: main-line seeds chain to previous; fork seeds are handled
// separately and pass their decision parent explicitly.
type ParentSpec = "prev-on-branch" | "fork-from-decision" | string[];

interface Seed {
  key: string;
  branch: string;
  intent: IntentType;
  title: string;
  polished: string;
  raw: string;
  entities: string[];
  actions: string[];
  sentiment: Thoughtform["sentiment"];
  agents: AgentName[];
  ageHours: number;
  parents: ParentSpec;
  nodeLabels?: { kind: GraphNode["kind"]; label: string }[];
}

// ---- Nodes (positioned to loosely mirror the reference graph layout) -------
const NODE_DEFS: { id: string; kind: GraphNode["kind"]; label: string; x: number; y: number }[] = [
  { id: "n_vox", kind: "Project", label: "VOXEMBLY", x: 0, y: 0 },
  { id: "n_twin", kind: "Concept", label: "Cognitive Twin", x: 180, y: -120 },
  { id: "n_thoughtform", kind: "Concept", label: "Thoughtform", x: -60, y: -150 },
  { id: "n_priya", kind: "Person", label: "Priya Shah", x: 60, y: 150 },
  { id: "n_kenji", kind: "Person", label: "Kenji Tanaka", x: -170, y: 90 },
  { id: "n_leo", kind: "Person", label: "Leo Alvarez", x: 130, y: 60 },
  { id: "n_neo4j", kind: "Concept", label: "Neo4j Aura", x: 120, y: -60 },
  { id: "n_falkor", kind: "Concept", label: "FalkorDB", x: 210, y: -160 },
  { id: "n_graphstore", kind: "Decision", label: "Graph store choice", x: 250, y: -40 },
  { id: "n_latency", kind: "Task", label: "Council latency", x: -20, y: 130 },
  { id: "n_assembly", kind: "Concept", label: "AssemblyAI", x: -190, y: -60 },
];

const NODES: GraphNode[] = NODE_DEFS.map((n) => ({
  ...n,
  valid_from: now - 140 * HOUR,
  valid_to: null,
}));

const EDGE_PAIRS: [string, string, string?][] = [
  ["n_vox", "n_twin", "has"],
  ["n_vox", "n_thoughtform", "defines"],
  ["n_vox", "n_priya", "team"],
  ["n_vox", "n_kenji", "team"],
  ["n_vox", "n_leo", "team"],
  ["n_twin", "n_neo4j", "stored in"],
  ["n_twin", "n_falkor", "standby"],
  ["n_graphstore", "n_neo4j", "option A"],
  ["n_graphstore", "n_falkor", "option B"],
  ["n_latency", "n_priya", "owner"],
  ["n_vox", "n_assembly", "uses"],
];

const EDGES: GraphEdge[] = EDGE_PAIRS.map(([s, t, label], i) => ({
  id: `e_${i}`,
  source: s,
  target: t,
  label,
  valid_from: now - 140 * HOUR,
  valid_to: null,
}));

// ---- Main-line commit seeds (chronological on `main`) ----------------------
const MAIN_SEEDS: Seed[] = [
  {
    key: "memory-founding",
    branch: "main",
    intent: "memory",
    title: "Founding the VOXEMBLY team",
    polished: "I'm Priya, founder of VOXEMBLY — a voice-native cognition OS. Kenji leads infra, Leo leads ML.",
    raw: "so um I'm Priya, founder of VOXEMBLY, you know a voice native cognition OS and Kenji leads infra, Leo leads ML",
    entities: ["Priya Shah", "Kenji Tanaka", "Leo Alvarez", "VOXEMBLY"],
    actions: ["Onboard team to Cognitive Twin"],
    sentiment: "positive",
    agents: ["Historian"],
    ageHours: 128,
    parents: "prev-on-branch",
  },
  {
    key: "idea-thoughtform",
    branch: "main",
    intent: "idea",
    title: "Thoughtform as a cognitive commit",
    polished: "Every dictation becomes a typed Thoughtform — a versioned commit against the knowledge graph.",
    raw: "every dictation becomes a typed thoughtform, like a versioned commit against the knowledge graph",
    entities: ["Thoughtform", "Cognitive Twin"],
    actions: ["Design commit hashing"],
    sentiment: "positive",
    agents: ["Researcher", "Devil's Advocate"],
    ageHours: 131,
    parents: "prev-on-branch",
  },
  {
    key: "task-latency",
    branch: "main",
    intent: "task",
    title: "Assign Agent Council latency task",
    polished: "Move the Agent Council latency task to Priya. Target sub-2s mouth-to-action.",
    raw: "move the agent council latency task to priya, target sub two second mouth to action",
    entities: ["Priya Shah", "Council latency"],
    actions: ["Assign to Priya", "Set target < 2s"],
    sentiment: "neutral",
    agents: ["Executor", "Scheduler"],
    ageHours: 119,
    parents: "prev-on-branch",
  },
  {
    key: "decision-graphstore",
    branch: "main",
    intent: "decision",
    title: "Graph store: Aura vs FalkorDB",
    polished: "Decide whether to stay on Neo4j Aura or migrate to FalkorDB for hot standby.",
    raw: "decide whether to stay on neo4j aura or migrate to falkordb for hot standby",
    entities: ["Neo4j Aura", "FalkorDB", "Graph store choice"],
    actions: ["Benchmark both", "Pick primary"],
    sentiment: "neutral",
    agents: ["Devil's Advocate", "Historian", "Researcher"],
    ageHours: 134,
    parents: "prev-on-branch",
  },
];

// ---- Fork seeds (each explicitly references the decision commit) -----------
const FORK_SEEDS: Seed[] = [
  {
    key: "plan-a",
    branch: "plan-a-stay-on-aura",
    intent: "decision",
    title: "Plan A — stay on Neo4j Aura",
    polished: "Keep Neo4j Aura as primary; add a GitHub Action to defeat the 3-day sleep timer.",
    raw: "plan a keep neo4j aura as primary and add a github action to defeat the sleep timer",
    entities: ["Neo4j Aura"],
    actions: ["Add keep-alive cron"],
    sentiment: "neutral",
    agents: ["Devil's Advocate"],
    ageHours: 3,
    parents: "fork-from-decision",
  },
  {
    key: "plan-b",
    branch: "plan-b-migrate-to-falkor",
    intent: "decision",
    title: "Plan B — FalkorDB on HF Space",
    polished: "Stand up FalkorDB on a Hugging Face Space and cut over the client with an identical Cypher subset.",
    raw: "plan b stand up falkordb on a hugging face space and cut over the client with an identical cypher subset",
    entities: ["FalkorDB"],
    actions: ["Deploy FalkorDB Space", "Mirror Cypher subset"],
    sentiment: "positive",
    agents: ["Researcher", "Executor"],
    ageHours: 2,
    parents: "fork-from-decision",
  },
];

function makeThoughtform(seed: Seed, hash: string, parents: string[]): Thoughtform {
  const created = now - seed.ageHours * HOUR;
  return {
    commit_hash: hash,
    parent_hashes: parents,
    branch: seed.branch,
    intent: seed.intent,
    raw_text: seed.raw,
    polished_text: seed.polished,
    final_text: seed.polished,
    entities: seed.entities,
    actions: seed.actions,
    sentiment: seed.sentiment,
    language: "en",
    confidence: 0.93 + Math.random() * 0.05,
    request_time_ms: 118 + Math.floor(Math.random() * 40),
    audio_duration_ms: 6000 + Math.floor(Math.random() * 9000),
    session_id: `sess_${shortHash(seed.key)}`,
    words: seed.polished.split(/\s+/).map((w) => ({
      text: w,
      confidence: 0.8 + Math.random() * 0.2,
    })),
    graph_mutations: [],
    spawned_agents: seed.agents,
    title: seed.title,
    created_at: created,
  };
}

export function buildSeedState(): CognitiveState {
  const thoughtforms: Record<string, Thoughtform> = {};
  const order: string[] = [];

  const branches: Branch[] = [
    { name: "main", head: "", color: "#00CBD6" },
    { name: "plan-a-stay-on-aura", head: "", color: "#A78BFA", parentBranch: "main" },
    { name: "plan-b-migrate-to-falkor", head: "", color: "#F59E0B", parentBranch: "main" },
  ];

  // Main line: chain each commit to the previous on its branch.
  let prevHash = "";
  let decisionHash = "";
  for (const seed of MAIN_SEEDS) {
    const hash = shortHash(seed.key);
    let parents: string[];
    if (seed.parents === "prev-on-branch") {
      parents = prevHash ? [prevHash] : [];
    } else if (seed.parents === "fork-from-decision") {
      // Not expected on the main line, but guard defensively.
      parents = decisionHash ? [decisionHash] : [];
    } else {
      parents = seed.parents;
    }
    const tf = makeThoughtform(seed, hash, parents);
    thoughtforms[hash] = tf;
    order.push(hash);
    prevHash = hash;
    if (seed.key === "decision-graphstore") decisionHash = hash;
  }

  // Fork seeds: each references the decision commit directly (ignores parents marker).
  for (const seed of FORK_SEEDS) {
    const hash = shortHash(seed.key);
    const tf = makeThoughtform(seed, hash, [decisionHash]);
    thoughtforms[hash] = tf;
    order.push(hash);
    // record forkedFrom on the branch
    const b = branches.find((x) => x.name === seed.branch);
    if (b) b.forkedFrom = decisionHash;
  }

  // Set branch heads.
  for (const b of branches) {
    const commits = order.map((h) => thoughtforms[h]).filter((t) => t.branch === b.name);
    if (commits.length) b.head = commits[commits.length - 1].commit_hash;
    else b.head = decisionHash; // forked branches without extra commits point at fork base
  }

  return {
    thoughtforms,
    order,
    branches,
    currentBranch: "main",
    nodes: NODES,
    edges: EDGES,
  };
}

// The commit the reference UI focuses on by default (Plan B).
export const DEFAULT_FOCUS_HASH = shortHash("plan-b");
