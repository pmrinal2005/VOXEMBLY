// ============================================================================
// VOXEMBLY — Version-Control System for cognition.
//
// Every Thoughtform is a commit with a content-addressed hash and parent
// pointer(s). This module provides Git-style primitives: commit, branch, fork,
// merge, checkout, and the ref-graph the Timeline renders.
// ============================================================================

import type { Branch, Thoughtform } from "@/lib/types";
import { sha256Hex, uid } from "@/lib/utils";

export const MAIN_BRANCH = "main";

/**
 * Compute a content-addressed commit hash from the Thoughtform payload +
 * parent(s). Deterministic — same content & parent ⇒ same hash prefix.
 */
export async function computeCommitHash(
  tf: Pick<Thoughtform, "polished_text" | "intent" | "createdAt">,
  parent: string | null,
  mergeParents?: string[],
): Promise<string> {
  const payload = JSON.stringify({
    p: tf.polished_text,
    i: tf.intent,
    t: tf.createdAt,
    parent,
    mp: mergeParents || [],
    salt: uid(),
  });
  return sha256Hex(payload);
}

export function initialBranches(now = Date.now()): Branch[] {
  return [{ name: MAIN_BRANCH, head: null, createdAt: now, createdFrom: null }];
}

/** Find a branch by name. */
export function findBranch(branches: Branch[], name: string): Branch | undefined {
  return branches.find((b) => b.name === name);
}

/** Advance a branch head to a new commit (returns new branches array). */
export function advanceHead(
  branches: Branch[],
  branchName: string,
  head: string,
): Branch[] {
  return branches.map((b) => (b.name === branchName ? { ...b, head } : b));
}

/** Create a new branch off a given commit (fork). */
export function createBranch(
  branches: Branch[],
  name: string,
  fromCommit: string | null,
  now = Date.now(),
): Branch[] {
  if (findBranch(branches, name)) return branches;
  return [
    ...branches,
    { name, head: fromCommit, createdAt: now, createdFrom: fromCommit },
  ];
}

/** Walk the parent chain of a commit within a set of thoughtforms. */
export function ancestry(
  thoughtforms: Thoughtform[],
  headHash: string | null,
): Thoughtform[] {
  const byHash = new Map(thoughtforms.map((t) => [t.commit_hash, t]));
  const chain: Thoughtform[] = [];
  let cur = headHash;
  const guard = new Set<string>();
  while (cur && byHash.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const tf = byHash.get(cur)!;
    chain.push(tf);
    cur = tf.parent_hash;
  }
  return chain;
}

/** Find lowest common ancestor of two commits (three-way merge base). */
export function mergeBase(
  thoughtforms: Thoughtform[],
  a: string | null,
  b: string | null,
): string | null {
  const aChain = new Set(ancestry(thoughtforms, a).map((t) => t.commit_hash));
  let cur = b;
  const byHash = new Map(thoughtforms.map((t) => [t.commit_hash, t]));
  const guard = new Set<string>();
  while (cur && byHash.has(cur) && !guard.has(cur)) {
    if (aChain.has(cur)) return cur;
    guard.add(cur);
    cur = byHash.get(cur)!.parent_hash;
  }
  return null;
}

/** Timeline ref-graph rows for rendering (commit → lane assignment). */
export interface TimelineRow {
  tf: Thoughtform;
  lane: number;
  isMerge: boolean;
  isBranchTip: boolean;
}

export function buildTimeline(
  thoughtforms: Thoughtform[],
  branches: Branch[],
): TimelineRow[] {
  const branchNames = branches.map((b) => b.name);
  const laneOf = new Map<string, number>();
  branchNames.forEach((n, i) => laneOf.set(n, i));
  const tips = new Set(branches.map((b) => b.head).filter(Boolean) as string[]);

  return [...thoughtforms]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((tf) => ({
      tf,
      lane: laneOf.get(tf.branch) ?? 0,
      isMerge: Boolean(tf.merge_parents && tf.merge_parents.length),
      isBranchTip: tips.has(tf.commit_hash),
    }));
}
