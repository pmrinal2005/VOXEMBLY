// ============================================================================
// VOXEMBLY — Temporal knowledge graph (the "Cognitive Twin").
//
// Modeled on the Zep/Graphiti temporal-edge pattern: every node/edge carries
// valid_from / valid_to timestamps so we can reconstruct the graph "as it was"
// at any past moment (Time Travel, Flow D). Implemented in-process over the
// existing store — same temporal semantics, zero extra accounts (per plan §9
// recommendation to model temporal edges in Postgres/local first).
// ============================================================================

import type { Graph, GraphEdge, GraphMutation, GraphNode } from "@/lib/types";
import { uid } from "@/lib/utils";

export function emptyGraph(): Graph {
  return { nodes: [], edges: [] };
}

/** Apply a list of mutations to a graph, returning a NEW graph (immutable). */
export function applyMutations(
  graph: Graph,
  mutations: GraphMutation[],
  commitHash: string,
  at: number = Date.now(),
): Graph {
  const nodes = new Map(graph.nodes.map((n) => [n.id, { ...n }]));
  const edges = graph.edges.map((e) => ({ ...e }));
  // fast label→id lookup for edge resolution by label
  const byLabel = new Map<string, string>();
  for (const n of nodes.values()) byLabel.set(n.label.toLowerCase(), n.id);

  const resolveId = (ref?: string): string | undefined => {
    if (!ref) return undefined;
    if (nodes.has(ref)) return ref;
    return byLabel.get(ref.toLowerCase());
  };

  for (const m of mutations) {
    if (m.op === "add_node") {
      const existing = m.nodeId && nodes.has(m.nodeId);
      const dupByLabel = m.label && byLabel.get(m.label.toLowerCase());
      if (existing || dupByLabel) {
        continue; // idempotent — don't duplicate entities
      }
      const id = m.nodeId || uid("n");
      const node: GraphNode = {
        id,
        kind: m.kind || "Concept",
        label: m.label || "Untitled",
        valid_from: m.valid_from ?? at,
        valid_to: m.valid_to ?? null,
        createdBy: commitHash,
      };
      nodes.set(id, node);
      byLabel.set(node.label.toLowerCase(), id);
    } else if (m.op === "update_node") {
      const id = resolveId(m.nodeId || m.label);
      if (id && nodes.has(id)) {
        const n = nodes.get(id)!;
        if (m.label) n.label = m.label;
        if (m.kind) n.kind = m.kind;
        if (m.valid_to !== undefined) n.valid_to = m.valid_to;
      }
    } else if (m.op === "add_edge") {
      // auto-create referenced nodes if missing (by label)
      const ensure = (ref?: string): string | undefined => {
        if (!ref) return undefined;
        const found = resolveId(ref);
        if (found) return found;
        const id = uid("n");
        const node: GraphNode = {
          id,
          kind: "Concept",
          label: ref,
          valid_from: at,
          valid_to: null,
          createdBy: commitHash,
        };
        nodes.set(id, node);
        byLabel.set(ref.toLowerCase(), id);
        return id;
      };
      const from = ensure(m.from);
      const to = ensure(m.to);
      if (from && to) {
        edges.push({
          id: uid("e"),
          from,
          to,
          rel: m.rel || "related_to",
          valid_from: m.valid_from ?? at,
          valid_to: m.valid_to ?? null,
          createdBy: commitHash,
        });
      }
    }
  }

  // recompute degree
  const nodeArr = Array.from(nodes.values());
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }
  for (const n of nodeArr) n.degree = deg.get(n.id) || 0;

  return { nodes: nodeArr, edges };
}

/**
 * Reconstruct the graph as it existed at time `t` (Time Travel).
 * Cypher-equivalent: valid_from <= t AND (valid_to IS NULL OR valid_to > t).
 */
export function graphAt(graph: Graph, t: number): Graph {
  const nodes = graph.nodes.filter(
    (n) => n.valid_from <= t && (n.valid_to == null || n.valid_to > t),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) =>
      e.valid_from <= t &&
      (e.valid_to == null || e.valid_to > t) &&
      nodeIds.has(e.from) &&
      nodeIds.has(e.to),
  );
  return { nodes, edges };
}

/** The most-connected / most-recent node labels (feeds the Prompt Composer). */
export function rankedLabels(graph: Graph, limit = 40): string[] {
  const scored = graph.nodes
    .map((n) => ({
      label: n.label,
      score: (n.degree || 0) * 3 + n.valid_from / 1e12,
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

/** Merge two graphs (used by branch merge). Later graph wins on node conflicts. */
export function mergeGraphs(a: Graph, b: Graph): Graph {
  const nodes = new Map<string, GraphNode>();
  for (const n of a.nodes) nodes.set(n.label.toLowerCase(), n);
  for (const n of b.nodes) nodes.set(n.label.toLowerCase(), n);
  const edgeKey = (e: GraphEdge) => `${e.from}|${e.rel}|${e.to}`;
  const edges = new Map<string, GraphEdge>();
  for (const e of [...a.edges, ...b.edges]) edges.set(edgeKey(e), e);
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}
