// ============================================================================
// VOXEMBLY — Version-Control System for cognition.
//
// Every Thoughtform is a commit with a content-addressed hash and parent
// pointer(s). This module provides Git-style primitives: commit hashing,
// branch/fork/merge helpers, ancestry walks, and the merge base used by the
// three-way merge. Branches are keyed by name in a Record for O(1) lookup.
// ============================================================================

import type { Branch, Thoughtform } from "@/lib/types";
import { sha256Hex } from "@/lib/utils";

export const MAIN_BRANCH = "main";

/** Distinct, high-contrast branch colors used by the Timeline. */
export const BRANCH_COLORS = [
  "#22d3ee", // cyan — main
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber
  "#fb7185", // rose
  "#60a5fa", // blue
  "#f472b6", // pink
  "#f59e0b", // orange
];

/** The genesis `main` branch. */
export function mainBranch(now = Date.now()): Branch {
  return {
    name: MAIN_BRANCH,
    head: null,
    created_at: now,
    parent_branch: null,
    forked_from: null,
    color: BRANCH_COLORS[0],
  };
}

/** The fields that content-address a commit. */
export interface CommitInput {
  parent_hashes: string[];
  branch: string;
  created_at: number;
  raw_text: string;
  polished_text: string;
  intent: string;
  session_id: string;
}

/**
 * Compute a content-addressed commit hash. Deterministic in its inputs so the
 * same content on the same parents yields the same hash — the `session_id`
 * makes distinct live dictations distinct even when text collides.
 */
export async function computeCommitHash(input: CommitInput): Promise<string> {
  const payload = JSON.stringify({
    pp: [...input.parent_hashes].sort(),
    b: input.branch,
    t: input.created_at,
    r: input.raw_text,
    p: input.polished_text,
    i: input.intent,
    s: input.session_id,
  });
  const hex = await sha256Hex(payload);
  return hex.slice(0, 12);
}

/** Create a new branch record forked off a given commit. */
export function createBranch(
  name: string,
  fromCommit: string | null,
  colorIdx: number,
  now = Date.now(),
): Branch {
  return {
    name,
    head: fromCommit,
    created_at: now,
    parent_branch: MAIN_BRANCH,
    forked_from: fromCommit,
    color: BRANCH_COLORS[colorIdx % BRANCH_COLORS.length],
  };
}

/** Walk the parent chain of a commit within a set of thoughtforms (first parent). */
export function ancestry(thoughtforms: Thoughtform[], headHash: string | null): Thoughtform[] {
  const byHash = new Map(thoughtforms.map((t) => [t.commit_hash, t]));
  const chain: Thoughtform[] = [];
  let cur = headHash;
  const guard = new Set<string>();
  while (cur && byHash.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    const tf = byHash.get(cur)!;
    chain.push(tf);
    cur = tf.parent_hashes[0] ?? null;
  }
  return chain;
}

/** Find the lowest common ancestor of two commits (three-way merge base). */
export function mergeBase(thoughtforms: Thoughtform[], a: string | null, b: string | null): string | null {
  const aChain = new Set(ancestry(thoughtforms, a).map((t) => t.commit_hash));
  const byHash = new Map(thoughtforms.map((t) => [t.commit_hash, t]));
  let cur = b;
  const guard = new Set<string>();
  while (cur && byHash.has(cur) && !guard.has(cur)) {
    if (aChain.has(cur)) return cur;
    guard.add(cur);
    cur = byHash.get(cur)!.parent_hashes[0] ?? null;
  }
  return null;
}
