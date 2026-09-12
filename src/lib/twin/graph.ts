/**
 * Cognitive Twin — temporal knowledge graph (pure functions, isomorphic).
 *
 * Edges carry `valid_from` / `valid_to` (Zep/Graphiti semantics). Every mutation is tagged with the
 * commit hash + branch that produced it, so we can reconstruct "the graph as of commit X on branch Y"
 * (Time Travel) or slice by branch (Fork/Merge) without a graph database — Postgres/IndexedDB first,
 * Neo4j Aura is an optional mirror.
 */
import type { GraphEdge, GraphMutation, GraphNode, NodeType, Thoughtform, TwinSnapshot } from "@/lib/types";

export interface TwinGraph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
}

export const emptyGraph = (): TwinGraph => ({ nodes: {}, edges: {} });

export const NODE_COLORS: Record<NodeType, string> = {
  Person: "#a78bfa",
  Project: "#22d3ee",
  Concept: "#fbbf24",
  Task: "#34d399",
  Decision: "#fb7185",
  Emotion: "#f472b6",
  Location: "#60a5fa",
  Domain: "#c084fc",
  Memory: "#f59e0b",
  Entity: "#94a3b8",
};

/** Apply a Thoughtform's mutations. Idempotent per (commit, mutation-id). Returns the list of node/edge ids touched. */
export function applyMutations(
  g: TwinGraph,
  mutations: GraphMutation[],
  meta: { commit: string; branch: string; at: number },
): { nodesAdded: string[]; edgesAdded: string[]; nodesTouched: string[]; edgesInvalidated: string[] } {
  const nodesAdded: string[] = [];
  const edgesAdded: string[] = [];
  const nodesTouched: string[] = [];
  const edgesInvalidated: string[] = [];

  for (const m of mutations) {
    if (m.op === "add_node") {
      const existing = g.nodes[m.id];
      if (existing) {
        existing.mentions += 1;
        existing.last_seen = meta.at;
        if (m.description && (!existing.description || existing.description.length < m.description.length)) existing.description = m.description;
        if (existing.type === "Entity" && m.type !== "Entity") existing.type = m.type;
        nodesTouched.push(m.id);
      } else {
        g.nodes[m.id] = {
          id: m.id,
          type: m.type,
          label: m.label,
          description: m.description,
          created_at: meta.at,
          branch: meta.branch,
          commit: meta.commit,
          mentions: 1,
          last_seen: meta.at,
        };
        nodesAdded.push(m.id);
      }
    } else if (m.op === "update_node") {
      const n = g.nodes[m.id];
      if (n) {
        if (m.label) n.label = m.label;
        if (m.description) n.description = m.description;
        n.last_seen = meta.at;
        nodesTouched.push(m.id);
      }
    } else if (m.op === "add_edge") {
      // ensure endpoints exist (defensive — compiler already guarantees this)
      for (const end of [m.from, m.to]) {
        if (!g.nodes[end]) {
          g.nodes[end] = {
            id: end,
            type: end === "me" ? "Person" : "Entity",
            label: end === "me" ? "Me" : end.replace(/-/g, " "),
            created_at: meta.at,
            branch: meta.branch,
            commit: meta.commit,
            mentions: 1,
            last_seen: meta.at,
          };
          nodesAdded.push(end);
        }
      }
      const id = `${m.id}@${meta.commit.slice(0, 7)}`;
      // supersede an identical live edge (same from/to/label) rather than duplicating
      for (const e of Object.values(g.edges)) {
        if (e.valid_to === null && e.from === m.from && e.to === m.to && e.label === m.label && e.branch === meta.branch) {
          e.weight = Math.max(e.weight, m.weight ?? 0.6);
          nodesTouched.push(m.from, m.to);
        }
      }
      if (!Object.values(g.edges).some((e) => e.valid_to === null && e.from === m.from && e.to === m.to && e.label === m.label && e.branch === meta.branch)) {
        g.edges[id] = { id, from: m.from, to: m.to, label: m.label, weight: m.weight ?? 0.6, valid_from: meta.at, valid_to: null, branch: meta.branch, commit: meta.commit };
        edgesAdded.push(id);
      }
    } else if (m.op === "invalidate_edge") {
      for (const e of Object.values(g.edges)) {
        if ((e.id === m.id || e.id.startsWith(m.id + "@")) && e.valid_to === null) {
          e.valid_to = meta.at;
          edgesInvalidated.push(e.id);
        }
      }
    }
  }
  return { nodesAdded, edgesAdded, nodesTouched, edgesInvalidated };
}

/**
 * Rebuild the graph from an ordered commit list (oldest → newest), restricted to the set of commits
 * reachable from `head` (i.e. the branch's ancestry). This is `git checkout <commit>` for your mind.
 */
export function rebuildGraph(thoughtforms: Thoughtform[], reachable: Set<string> | null): TwinGraph {
  const g = emptyGraph();
  const sorted = [...thoughtforms].sort((a, b) => a.created_at - b.created_at);
  for (const tf of sorted) {
    if (reachable && !reachable.has(tf.commit_hash)) continue;
    applyMutations(g, tf.compiled.graph_mutations, { commit: tf.commit_hash, branch: tf.branch, at: tf.created_at });
  }
  return g;
}

/** Cypher-equivalent: valid_from <= t AND (valid_to IS NULL OR valid_to > t). */
export function snapshotAt(g: TwinGraph, t: number, branch: string): TwinSnapshot {
  const edges = Object.values(g.edges).filter((e) => e.valid_from <= t && (e.valid_to === null || e.valid_to > t));
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  }
  const nodes = Object.values(g.nodes).filter((n) => n.created_at <= t && (nodeIds.has(n.id) || true));
  return { nodes, edges, at: t, branch };
}

export function liveEdges(g: TwinGraph): GraphEdge[] {
  return Object.values(g.edges).filter((e) => e.valid_to === null);
}

export function neighbors(g: TwinGraph, id: string, depth = 1): Set<string> {
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const e of liveEdges(g)) {
      for (const f of frontier) {
        if (e.from === f && !seen.has(e.to)) {
          seen.add(e.to);
          next.push(e.to);
        }
        if (e.to === f && !seen.has(e.from)) {
          seen.add(e.from);
          next.push(e.from);
        }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return seen;
}

/** Ranked entity labels for the Prompt Composer: recency × mentions × degree. */
export function rankedLabels(g: TwinGraph, now = Date.now(), limit = 40, types?: NodeType[]): GraphNode[] {
  const degree: Record<string, number> = {};
  for (const e of liveEdges(g)) {
    degree[e.from] = (degree[e.from] ?? 0) + 1;
    degree[e.to] = (degree[e.to] ?? 0) + 1;
  }
  return Object.values(g.nodes)
    .filter((n) => n.id !== "me" && (!types || types.includes(n.type)))
    .map((n) => {
      const ageH = Math.max(0.1, (now - n.last_seen) / 3.6e6);
      const score = (n.mentions + 0.5 * (degree[n.id] ?? 0)) / Math.log2(2 + ageH);
      return { n, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.n);
}

/** Three-way merge of two branch graphs onto a base (Flow E). Conflicts = same node id with different labels. */
export function mergeGraphs(base: TwinGraph, ours: TwinGraph, theirs: TwinGraph) {
  const conflicts: { id: string; ours: string; theirs: string }[] = [];
  const merged: TwinGraph = { nodes: { ...ours.nodes }, edges: { ...ours.edges } };
  for (const [id, n] of Object.entries(theirs.nodes)) {
    if (!merged.nodes[id]) merged.nodes[id] = { ...n };
    else if (merged.nodes[id].label !== n.label && base.nodes[id]?.label !== n.label && base.nodes[id]?.label !== merged.nodes[id].label) {
      conflicts.push({ id, ours: merged.nodes[id].label, theirs: n.label });
    } else merged.nodes[id].mentions = Math.max(merged.nodes[id].mentions, n.mentions);
  }
  for (const [id, e] of Object.entries(theirs.edges)) if (!merged.edges[id]) merged.edges[id] = { ...e };
  return { merged, conflicts, stats: { nodes: Object.keys(merged.nodes).length, edges: Object.keys(merged.edges).length } };
}

export function graphDiff(before: TwinGraph, after: TwinGraph) {
  const addedNodes = Object.keys(after.nodes).filter((id) => !before.nodes[id]);
  const removedNodes = Object.keys(before.nodes).filter((id) => !after.nodes[id]);
  const addedEdges = Object.keys(after.edges).filter((id) => !before.edges[id]);
  const removedEdges = Object.keys(before.edges).filter((id) => !after.edges[id]);
  return { addedNodes, removedNodes, addedEdges, removedEdges };
}
