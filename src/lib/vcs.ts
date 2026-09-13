// ============================================================================
// VCS — Git-style version control for cognition.
// commit hashing, branch, fork, merge, and time-travel over the temporal graph.
// ============================================================================

import type {
  Branch,
  CognitiveState,
  GraphEdge,
  GraphNode,
  Thoughtform,
} from "./types";
import { randomHash } from "./utils";

// Reconstruct the graph as it existed at time t (temporal query).
// valid_from <= t AND (valid_to IS NULL OR valid_to > t)
export function graphAt(
  state: CognitiveState,
  t: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const alive = <T extends { valid_from: number; valid_to: number | null }>(x: T) =>
    x.valid_from <= t && (x.valid_to === null || x.valid_to > t);
  return {
    nodes: state.nodes.filter(alive),
    edges: state.edges.filter(alive),
  };
}

// Filter to only the live (current) graph.
export function liveGraph(state: CognitiveState) {
  return graphAt(state, Date.now() + 1);
}

// Commits belonging to a branch, chronological.
export function commitsOnBranch(state: CognitiveState, branch: string): Thoughtform[] {
  return state.order
    .map((h) => state.thoughtforms[h])
    .filter((t) => t && t.branch === branch);
}

export function headOf(state: CognitiveState, branch: string): string | undefined {
  const commits = commitsOnBranch(state, branch);
  return commits.length ? commits[commits.length - 1].commit_hash : undefined;
}

// Create a new Thoughtform commit on a branch.
export function commit(
  state: CognitiveState,
  tf: Omit<Thoughtform, "commit_hash" | "parent_hashes" | "created_at"> & {
    created_at?: number;
    commit_hash?: string;
    parent_hashes?: string[];
  }
): { state: CognitiveState; commit_hash: string } {
  const hash = tf.commit_hash ?? randomHash();
  const parent = headOf(state, tf.branch);
  const created_at = tf.created_at ?? Date.now();

  const full: Thoughtform = {
    ...tf,
    commit_hash: hash,
    parent_hashes: tf.parent_hashes ?? (parent ? [parent] : []),
    created_at,
  };

  // Apply graph mutations with temporal stamps.
  const nodes = [...state.nodes];
  const edges = [...state.edges];
  for (const m of full.graph_mutations) {
    if (m.op === "add_node" && m.node) {
      nodes.push({
        id: m.node.id ?? randomHash(),
        kind: m.node.kind ?? "Concept",
        label: m.node.label ?? "node",
        valid_from: created_at,
        valid_to: null,
        createdByCommit: hash,
        x: m.node.x,
        y: m.node.y,
      });
    } else if (m.op === "add_edge" && m.edge && m.edge.source && m.edge.target) {
      edges.push({
        id: m.edge.id ?? randomHash(),
        source: m.edge.source,
        target: m.edge.target,
        label: m.edge.label,
        valid_from: created_at,
        valid_to: null,
      });
    }
  }

  const branches = state.branches.map((b) =>
    b.name === full.branch ? { ...b, head: hash } : b
  );

  return {
    state: {
      ...state,
      thoughtforms: { ...state.thoughtforms, [hash]: full },
      order: [...state.order, hash],
      branches,
      nodes,
      edges,
    },
    commit_hash: hash,
  };
}

const BRANCH_COLORS = ["#00CBD6", "#A78BFA", "#F59E0B", "#EC4899", "#34D399", "#60A5FA"];

// Fork a Thoughtform into a named branch.
export function fork(
  state: CognitiveState,
  fromCommit: string,
  branchName: string
): CognitiveState {
  if (state.branches.some((b) => b.name === branchName)) return state;
  const color = BRANCH_COLORS[state.branches.length % BRANCH_COLORS.length];
  const branch: Branch = {
    name: branchName,
    head: fromCommit,
    color,
    parentBranch: state.thoughtforms[fromCommit]?.branch,
    forkedFrom: fromCommit,
  };
  return { ...state, branches: [...state.branches, branch] };
}

// Merge sourceBranch into targetBranch (creates a merge commit with 2 parents).
export function merge(
  state: CognitiveState,
  sourceBranch: string,
  targetBranch: string
): { state: CognitiveState; commit_hash: string } {
  const srcHead = headOf(state, sourceBranch);
  const tgtHead = headOf(state, targetBranch);
  const parents = [tgtHead, srcHead].filter(Boolean) as string[];
  const now = Date.now();
  const mergeTf: Thoughtform = {
    commit_hash: randomHash(),
    parent_hashes: parents,
    branch: targetBranch,
    intent: "decision",
    raw_text: `Merge ${sourceBranch} into ${targetBranch}`,
    polished_text: `Merged branch ${sourceBranch} into ${targetBranch}.`,
    final_text: `Merged branch ${sourceBranch} into ${targetBranch}.`,
    entities: [],
    actions: [],
    sentiment: "neutral",
    language: "en",
    confidence: 1,
    request_time_ms: 0,
    words: [],
    graph_mutations: [],
    spawned_agents: [],
    title: `Merge ${sourceBranch} → ${targetBranch}`,
    created_at: now,
  };
  const branches = state.branches.map((b) =>
    b.name === targetBranch ? { ...b, head: mergeTf.commit_hash } : b
  );
  return {
    state: {
      ...state,
      thoughtforms: { ...state.thoughtforms, [mergeTf.commit_hash]: mergeTf },
      order: [...state.order, mergeTf.commit_hash],
      branches,
    },
    commit_hash: mergeTf.commit_hash,
  };
}

export function checkout(state: CognitiveState, branch: string): CognitiveState {
  if (!state.branches.some((b) => b.name === branch)) return state;
  return { ...state, currentBranch: branch };
}
