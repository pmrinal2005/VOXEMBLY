/**
 * Thoughtform VCS — Git-style commit hashing, branches, fork, merge, checkout (Flow D/E).
 * Pure functions; state lives in the Zustand store and is persisted to IndexedDB / Supabase.
 */
import type { Branch, Thoughtform } from "@/lib/types";
import { sha256Hex } from "@/lib/utils";

export const BRANCH_COLORS = ["#22d3ee", "#a78bfa", "#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#f472b6", "#c084fc"];

export async function computeCommitHash(input: { parent_hashes: string[]; branch: string; created_at: number; raw_text: string; polished_text: string; intent: string; session_id: string }): Promise<string> {
  const payload = [
    `parents ${input.parent_hashes.join(",")}`,
    `branch ${input.branch}`,
    `time ${input.created_at}`,
    `session ${input.session_id}`,
    `intent ${input.intent}`,
    "",
    input.raw_text,
    "---",
    input.polished_text,
  ].join("\n");
  return sha256Hex(payload);
}

export function mainBranch(): Branch {
  return { name: "main", head: null, created_at: Date.now(), parent_branch: null, forked_from: null, color: BRANCH_COLORS[0] };
}

export function slugBranch(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "branch"
  );
}

/** All commits reachable from `head` by following parent pointers (ancestry). */
export function ancestry(head: string | null, byHash: Record<string, Thoughtform>): Set<string> {
  const seen = new Set<string>();
  const stack = head ? [head] : [];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    const tf = byHash[h];
    if (!tf) continue;
    seen.add(h);
    for (const p of tf.parent_hashes) stack.push(p);
  }
  return seen;
}

/** Lowest common ancestor (first shared commit walking back from both heads). */
export function mergeBase(a: string | null, b: string | null, byHash: Record<string, Thoughtform>): string | null {
  const A = ancestry(a, byHash);
  const walk = b ? [b] : [];
  const seen = new Set<string>();
  while (walk.length) {
    const h = walk.shift()!;
    if (seen.has(h)) continue;
    seen.add(h);
    if (A.has(h)) return h;
    const tf = byHash[h];
    if (tf) walk.push(...tf.parent_hashes);
  }
  return null;
}

/** Resolve a human ref → commit hash. Supports hash prefix, branch name, "HEAD~n", natural time ("tuesday", "yesterday", "2 hours ago"). */
export function resolveRef(ref: string, ctx: { thoughtforms: Thoughtform[]; branches: Record<string, Branch>; currentBranch: string; now?: number }): { hash: string | null; explanation: string } {
  const now = ctx.now ?? Date.now();
  const r = ref.trim().toLowerCase().replace(/^my\s+/, "").replace(/\s+brain$/, "").replace(/\s+(mind|state|graph)$/, "");
  const sorted = [...ctx.thoughtforms].sort((a, b) => a.created_at - b.created_at);
  if (!sorted.length) return { hash: null, explanation: "No commits yet" };

  // branch name
  const br = ctx.branches[r] ?? ctx.branches[slugBranch(r)];
  if (br) return { hash: br.head, explanation: `branch ${br.name}` };

  // HEAD~n
  const rel = r.match(/^head~(\d+)$/);
  if (rel) {
    const n = Number(rel[1]);
    const head = ctx.branches[ctx.currentBranch]?.head;
    const chain: string[] = [];
    let cur = head;
    const byHash = Object.fromEntries(sorted.map((t) => [t.commit_hash, t]));
    while (cur && chain.length <= n) {
      chain.push(cur);
      cur = byHash[cur]?.parent_hashes[0] ?? null;
    }
    return { hash: chain[n] ?? null, explanation: `HEAD~${n}` };
  }

  // hash prefix
  if (/^[0-9a-f]{4,40}$/.test(r)) {
    const hit = sorted.find((t) => t.commit_hash.startsWith(r));
    if (hit) return { hash: hit.commit_hash, explanation: `commit ${hit.commit_hash.slice(0, 7)}` };
  }

  // natural-language time
  const target = parseTimeRef(r, now);
  if (target) {
    const candidates = sorted.filter((t) => t.created_at <= target.end);
    const last = candidates[candidates.length - 1];
    if (last) return { hash: last.commit_hash, explanation: `last commit before ${new Date(target.end).toLocaleString()} (${target.label})` };
    return { hash: sorted[0].commit_hash, explanation: `earliest commit (nothing before ${target.label})` };
  }

  // fuzzy title match
  const byTitle = sorted.filter((t) => t.compiled.title.toLowerCase().includes(r) || t.compiled.polished_text.toLowerCase().includes(r));
  if (byTitle.length) return { hash: byTitle[byTitle.length - 1].commit_hash, explanation: `matched "${byTitle[byTitle.length - 1].compiled.title}"` };

  return { hash: null, explanation: `Could not resolve "${ref}"` };
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseTimeRef(r: string, now: number): { end: number; label: string } | null {
  const d = new Date(now);
  const endOfDay = (x: Date) => {
    const y = new Date(x);
    y.setHours(23, 59, 59, 999);
    return y.getTime();
  };
  if (/^(today|now)$/.test(r)) return { end: now, label: "now" };
  if (/^yesterday$/.test(r)) {
    d.setDate(d.getDate() - 1);
    return { end: endOfDay(d), label: "yesterday" };
  }
  if (/^(the )?beginning|start|first|genesis$/.test(r)) return { end: 0 + 1, label: "the beginning" };
  const ago = r.match(/^(\d+)\s*(minute|min|hour|hr|day|week|month)s?\s*ago$/);
  if (ago) {
    const n = Number(ago[1]);
    const unit = ago[2];
    const ms = unit.startsWith("min") ? 6e4 : unit.startsWith("h") ? 3.6e6 : unit.startsWith("d") ? 8.64e7 : unit.startsWith("w") ? 6.048e8 : 2.592e9;
    return { end: now - n * ms, label: `${n} ${unit}${n > 1 ? "s" : ""} ago` };
  }
  if (/^last week$/.test(r)) return { end: now - 6.048e8, label: "last week" };
  const day = DAYS.findIndex((x) => r === x || r === `last ${x}` || r === `${x} brain`);
  if (day >= 0) {
    const diff = (d.getDay() - day + 7) % 7 || 7;
    d.setDate(d.getDate() - diff);
    return { end: endOfDay(d), label: DAYS[day] };
  }
  const ts = Date.parse(r);
  if (!Number.isNaN(ts)) return { end: ts, label: new Date(ts).toLocaleDateString() };
  return null;
}
