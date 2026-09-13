// ============================================================================
// VOXEMBLY — Temporal knowledge graph (the "Cognitive Twin").
//
// Modeled on the Zep/Graphiti temporal-edge pattern: every node/edge carries
// valid_from / valid_to timestamps so we can reconstruct the graph "as it was"
// at any past moment (Time Travel, Flow D). The graph is Record-keyed for O(1)
// mutation. Implemented in-process — same temporal semantics, zero extra
// accounts (per plan §9: model temporal edges locally first).
// ============================================================================

import type { Graph, GraphEdge, GraphMutation, GraphNode, NodeType } from "@/lib/types";
import { uid } from "@/lib/utils";

/** Per-node-type accent colors, shared by the Twin canvas and the artifact page. */
export const NODE_COLORS: Record<NodeType, string> = {
  Entity: "#94a3b8",
  Person: "#22d3ee",
  Project: "#a78bfa",
  Domain: "#f59e0b",
  Location: "#38bdf8",
  Concept: "#34d399",
  Task: "#fbbf24",
  Decision: "#fb7185",
  Emotion: "#f472b6",
  Memory: "#c084fc",
};

export function emptyGraph(): Graph {
  return { nodes: {}, edges: {} };
}

/** Deep-ish clone of a graph (nodes/edges are flat records of value objects). */
function cloneGraph(g: Graph): Graph {
  const nodes: Record<string, GraphNode> = {};
  const edges: Record<string, GraphEdge> = {};
  for (const k of Object.keys(g.nodes)) nodes[k] = { ...g.nodes[k] };
  for (const k of Object.keys(g.edges)) edges[k] = { ...g.edges[k] };
  return { nodes, edges };
}

/**
 * Apply a list of mutations to a graph, returning a NEW graph (immutable).
 * Node ops are idempotent by id or (case-insensitive) label so re-mentions
 * bump `mentions`/`lastSeen` rather than duplicating entities.
 */
export function applyMutations(
  graph: Graph,
  mutations: GraphMutation[],
  commitHash: string,
  at: number = Date.now(),
): Graph {
  const g = cloneGraph(graph);
  const byLabel = new Map<string, string>();
  for (const n of Object.values(g.nodes)) byLabel.set(n.label.toLowerCase(), n.id);

  const resolveId = (ref?: string): string | undefined => {
    if (!ref) return undefined;
    if (g.nodes[ref]) return ref;
    return byLabel.get(ref.toLowerCase());
  };

  const ensureNode = (ref: string | undefined, type: NodeType = "Concept"): string | undefined => {
    if (!ref) return undefined;
    const found = resolveId(ref);
    if (found) {
      const n = g.nodes[found];
      n.mentions += 1;
      n.lastSeen = at;
      return found;
    }
    const id = uid("n");
    g.nodes[id] = {
      id,
      type,
      label: ref,
      valid_from: at,
      valid_to: null,
      degree: 0,
      mentions: 1,
      createdBy: commitHash,
      lastSeen: at,
    };
    byLabel.set(ref.toLowerCase(), id);
    return id;
  };

  for (const m of mutations) {
    if (m.op === "add_node") {
      const preferredId = m.id;
      const existing = (preferredId && g.nodes[preferredId]) || (m.label && byLabel.get(m.label.toLowerCase()));
      if (existing) {
        const id = typeof existing === "string" ? existing : preferredId!;
        const n = g.nodes[id];
        if (n) {
          n.mentions += 1;
          n.lastSeen = at;
          if (m.description && !n.description) n.description = m.description;
        }
        continue;
      }
      const id = preferredId || uid("n");
      const node: GraphNode = {
        id,
        type: m.type || "Concept",
        label: m.label || "Untitled",
        description: m.description,
        valid_from: at,
        valid_to: null,
        degree: 0,
        mentions: 1,
        createdBy: commitHash,
        lastSeen: at,
      };
      g.nodes[id] = node;
      byLabel.set(node.label.toLowerCase(), id);
    } else if (m.op === "update_node") {
      const id = resolveId(m.id || m.label);
      if (id && g.nodes[id]) {
        const n = g.nodes[id];
        if (m.label) n.label = m.label;
        if (m.type) n.type = m.type;
        if (m.description) n.description = m.description;
        n.lastSeen = at;
      }
    } else if (m.op === "add_edge") {
      const from = ensureNode(m.from);
      const to = ensureNode(m.to);
      if (from && to) {
        const id = m.id || uid("e");
        g.edges[id] = {
          id,
          from,
          to,
          label: m.label || "related_to",
          weight: m.weight ?? 1,
          valid_from: at,
          valid_to: null,
          createdBy: commitHash,
        };
      }
    }
  }

  // recompute degree over live edges
  const deg = new Map<string, number>();
  for (const e of Object.values(g.edges)) {
    if (e.valid_to !== null) continue;
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }
  for (const n of Object.values(g.nodes)) n.degree = deg.get(n.id) || 0;

  return g;
}

/**
 * Reconstruct the graph as it existed at time `t` (Time Travel).
 * Cypher-equivalent: valid_from <= t AND (valid_to IS NULL OR valid_to > t).
 */
export function graphAt(graph: Graph, t: number): Graph {
  const nodes: Record<string, GraphNode> = {};
  for (const n of Object.values(graph.nodes)) {
    if (n.valid_from <= t && (n.valid_to == null || n.valid_to > t)) nodes[n.id] = { ...n };
  }
  const edges: Record<string, GraphEdge> = {};
  for (const e of Object.values(graph.edges)) {
    if (e.valid_from <= t && (e.valid_to == null || e.valid_to > t) && nodes[e.from] && nodes[e.to]) {
      edges[e.id] = { ...e };
    }
  }
  return { nodes, edges };
}

/** The most-connected / most-recent node labels (feeds the Prompt Composer). */
export function rankedLabels(graph: Graph, limit = 40): string[] {
  const scored = Object.values(graph.nodes)
    .filter((n) => n.valid_to == null)
    .map((n) => ({
      label: n.label,
      score: (n.degree || 0) * 3 + (n.mentions || 0) * 2 + n.lastSeen / 1e12,
    }))
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scored) {
    const k = s.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.label);
    if (out.length >= limit) break;
  }
  return out;
}

/** Merge two graphs (used by branch merge). Later graph wins on id conflicts. */
export function mergeGraphs(a: Graph, b: Graph): Graph {
  const out = cloneGraph(a);
  const byLabel = new Map<string, string>();
  for (const n of Object.values(out.nodes)) byLabel.set(n.label.toLowerCase(), n.id);
  for (const n of Object.values(b.nodes)) {
    const existing = byLabel.get(n.label.toLowerCase());
    if (existing) {
      out.nodes[existing] = { ...out.nodes[existing], mentions: out.nodes[existing].mentions + n.mentions };
    } else {
      out.nodes[n.id] = { ...n };
      byLabel.set(n.label.toLowerCase(), n.id);
    }
  }
  for (const e of Object.values(b.edges)) {
    if (!out.edges[e.id]) out.edges[e.id] = { ...e };
  }
  return out;
}
