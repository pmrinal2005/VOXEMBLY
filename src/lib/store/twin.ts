"use client";

// ============================================================================
// VOXEMBLY — Cognitive Twin store (Zustand). NEW contract consumed by Studio.
// ============================================================================

import { create } from "zustand";
import type {
  AgentKind,
  AgentRun,
  Branch,
  DraftRecord,
  Graph,
  Profile,
  Thoughtform,
} from "@/lib/types";
import { applyMutations, emptyGraph, graphAt, mergeGraphs } from "@/lib/twin/graph";
import {
  MAIN_BRANCH,
  advanceHead,
  ancestry,
  BRANCH_COLORS,
  createBranch,
  initialBranches,
  mergeBase,
} from "@/lib/twin/vcs";
import * as store from "@/lib/store/db";
import { uid } from "@/lib/utils";

export type ToastKind = "info" | "success" | "warn" | "error";
export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
  detail?: string;
}

export const DEFAULT_PROFILE: Profile = {
  id: "local",
  display_name: "You",
  primary_language: "en",
  secondary_languages: [],
  domains: ["founder"],
  region: "global",
  latency_mode: "balanced",
  normalize_to: null,
  locale_pack: "none",
  private_acronyms: [],
  onboarded_at: null,
  high_contrast: false,
  reduce_motion: false,
};

export function newAgentRun(agent: AgentKind, model: string): AgentRun {
  return {
    id: uid("ar"),
    agent,
    model,
    provider: "groq",
    status: "queued",
    started_at: Date.now(),
  };
}

export type CmdResult = { ok: boolean; message: string };

interface TwinState {
  hydrated: boolean;
  profile: Profile;
  thoughtforms: Thoughtform[];
  branches: Record<string, Branch>;
  currentBranch: string;
  graph: Graph;
  selected: string | null;
  checkout: string | null;
  timeCursor: number | null;
  drafts: DraftRecord[];
  online: boolean;
  ambient: boolean;
  councilOpen: boolean;
  toasts: Toast[];

  hydrate: () => Promise<void>;
  setProfile: (p: Partial<Profile>) => Promise<void>;
  addThoughtform: (tf: Thoughtform) => Promise<void>;
  updateThoughtform: (hash: string, patch: Partial<Thoughtform>) => Promise<void>;
  select: (hash: string | null) => void;
  checkoutRef: (query: string) => CmdResult;
  returnToHead: () => void;
  switchBranch: (name: string) => CmdResult;
  fork: (names: string[], fromHash: string | null) => Promise<CmdResult>;
  merge: (from: string, into?: string) => Promise<CmdResult>;
  setAgentRuns: (hash: string, runs: AgentRun[]) => Promise<void>;
  upsertAgentRun: (hash: string, run: AgentRun) => Promise<void>;
  graphAt: (t: number) => Graph;
  visibleThoughtforms: () => Thoughtform[];
  enqueueDraft: (d: DraftRecord) => Promise<void>;
  dropDraft: (id: string) => Promise<void>;
  refreshDrafts: () => Promise<void>;
  setOnline: (v: boolean) => void;
  setAmbient: (v: boolean) => void;
  setCouncilOpen: (v: boolean) => void;
  toast: (kind: ToastKind, text: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  reset: () => Promise<void>;
}

function rebuildGraph(tfs: Thoughtform[]): Graph {
  let g = emptyGraph();
  const ordered = [...tfs].sort((a, b) => a.created_at - b.created_at);
  for (const tf of ordered) {
    g = applyMutations(g, tf.compiled.graph_mutations || [], tf.commit_hash, tf.created_at);
  }
  return g;
}

export const useTwin = create<TwinState>((set, get) => ({
  hydrated: false,
  profile: DEFAULT_PROFILE,
  thoughtforms: [],
  branches: initialBranches(),
  currentBranch: MAIN_BRANCH,
  graph: emptyGraph(),
  selected: null,
  checkout: null,
  timeCursor: null,
  drafts: [],
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  ambient: false,
  councilOpen: false,
  toasts: [],

  hydrate: async () => {
    const [profile, tfs, branches, graph, current, drafts] = await Promise.all([
      store.getProfile(),
      store.allThoughtforms(),
      store.getBranches(),
      store.getGraph(),
      store.getCurrentBranch(),
      store.loadDrafts(),
    ]);
    const thoughtforms = tfs || [];
    const br = branches && Object.keys(branches).length ? branches : initialBranches();
    const g =
      graph && graph.nodes && Object.keys(graph.nodes).length
        ? graph
        : rebuildGraph(thoughtforms);
    set({
      hydrated: true,
      profile: profile || DEFAULT_PROFILE,
      thoughtforms,
      branches: br,
      graph: g,
      currentBranch: current || MAIN_BRANCH,
      selected: thoughtforms.length ? thoughtforms[thoughtforms.length - 1].commit_hash : null,
      drafts,
    });
  },

  setProfile: async (p) => {
    const next = { ...get().profile, ...p };
    set({ profile: next });
    await store.saveProfile(next);
  },

  addThoughtform: async (tf) => {
    const s = get();
    const nextGraph = applyMutations(s.graph, tf.compiled.graph_mutations || [], tf.commit_hash, tf.created_at);
    const branches = advanceHead(s.branches, tf.branch, tf.commit_hash);
    const thoughtforms = [...s.thoughtforms.filter((t) => t.commit_hash !== tf.commit_hash), tf];
    set({ thoughtforms, graph: nextGraph, branches, selected: tf.commit_hash, timeCursor: null });
    await store.putThoughtform(tf);
    await store.setGraph(nextGraph);
    await store.putBranch(branches[tf.branch]);
    await store.setCurrentBranch(tf.branch);
  },

  updateThoughtform: async (hash, patch) => {
    const thoughtforms = get().thoughtforms.map((t) =>
      t.commit_hash === hash ? { ...t, ...patch } : t,
    );
    const updated = thoughtforms.find((t) => t.commit_hash === hash);
    set({ thoughtforms });
    if (updated) await store.putThoughtform(updated);
  },

  select: (hash) => set({ selected: hash }),

  checkoutRef: (query) => {
    const q = (query || "").trim().toLowerCase();
    const tfs = get().thoughtforms;
    if (!q) return { ok: false, message: "No checkout target." };

    const byHash = tfs.find(
      (t) => t.commit_hash.startsWith(q) || t.commit_hash === q,
    );
    if (byHash) {
      set({ selected: byHash.commit_hash, checkout: byHash.commit_hash, timeCursor: byHash.created_at });
      return { ok: true, message: `Checked out ${byHash.commit_hash.slice(0, 7)}.` };
    }

    const rel = q.match(/^head~(\d+)$/);
    if (rel) {
      const n = Number(rel[1]);
      const chain = ancestry(tfs, get().branches[get().currentBranch]?.head ?? null);
      const tf = chain[n];
      if (tf) {
        set({ selected: tf.commit_hash, timeCursor: tf.created_at });
        return { ok: true, message: `Checked out HEAD~${n} (${tf.commit_hash.slice(0, 7)}).` };
      }
    }

    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayIdx = days.findIndex((d) => q.includes(d));
    if (dayIdx >= 0) {
      const now = new Date();
      const target = tfs
        .filter((t) => new Date(t.created_at).getDay() === dayIdx)
        .sort((a, b) => b.created_at - a.created_at)[0];
      if (target) {
        set({ selected: target.commit_hash, timeCursor: target.created_at });
        return { ok: true, message: `Time travelled to ${days[dayIdx]} (${target.commit_hash.slice(0, 7)}).` };
      }
      // fallback: rewind ~1 day
      const cursor = Date.now() - 24 * 3600_000;
      const closest = [...tfs].sort(
        (a, b) => Math.abs(a.created_at - cursor) - Math.abs(b.created_at - cursor),
      )[0];
      if (closest) {
        set({ selected: closest.commit_hash, timeCursor: closest.created_at });
        return { ok: true, message: `Closest commit to ${days[dayIdx]}: ${closest.commit_hash.slice(0, 7)}.` };
      }
      return { ok: false, message: `No commit found for ${days[dayIdx]}.` };
    }

    const titled = tfs.find((t) => t.compiled.title.toLowerCase().includes(q));
    if (titled) {
      set({ selected: titled.commit_hash, timeCursor: titled.created_at });
      return { ok: true, message: `Checked out “${titled.compiled.title}”.` };
    }
    return { ok: false, message: `Could not resolve “${query}”.` };
  },

  returnToHead: () => set({ timeCursor: null, checkout: null }),

  switchBranch: (name) => {
    const b = get().branches[name];
    if (!b) return { ok: false, message: `No branch named ${name}.` };
    set({ currentBranch: name, selected: b.head, timeCursor: null });
    void store.setCurrentBranch(name);
    return { ok: true, message: `Switched to ${name}.` };
  },

  fork: async (names, fromHash) => {
    const s = get();
    const slug = (n: string) =>
      n
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32) || "branch";
    const created: string[] = [];
    let branches = { ...s.branches };
    let colorIdx = Object.keys(branches).length;
    for (const raw of names) {
      const name = slug(raw);
      if (branches[name]) continue;
      const b = createBranch(name, fromHash, colorIdx++);
      b.color = BRANCH_COLORS[colorIdx % BRANCH_COLORS.length];
      branches[name] = b;
      await store.putBranch(b);
      created.push(name);
    }
    if (!created.length) return { ok: false, message: "Those branches already exist." };
    set({ branches, currentBranch: created[0] });
    await store.setCurrentBranch(created[0]);
    return { ok: true, message: `Forked ${created.join(", ")}.` };
  },

  merge: async (from, into) => {
    const s = get();
    const src = s.branches[from];
    const destName = into || s.currentBranch;
    const dest = s.branches[destName];
    if (!src) return { ok: false, message: `Unknown branch ${from}.` };
    if (!dest) return { ok: false, message: `Unknown branch ${destName}.` };
    const base = mergeBase(s.thoughtforms, dest.head, src.head);
    const parents = [dest.head, src.head].filter(Boolean) as string[];
    const now = Date.now();
    const { computeCommitHash } = await import("@/lib/twin/vcs");
    const hash = await computeCommitHash({
      parent_hashes: parents,
      branch: destName,
      created_at: now,
      raw_text: `merge ${from} into ${destName}`,
      polished_text: `Merged ${from} into ${destName}${base ? ` (base ${base.slice(0, 7)})` : ""}.`,
      intent: "decision",
      session_id: uid("merge"),
    });
    const tf: Thoughtform = {
      id: uid("tf"),
      commit_hash: hash,
      parent_hashes: parents,
      branch: destName,
      created_at: now,
      raw_text: `merge ${from} into ${destName}`,
      words: [],
      confidence: 1,
      compiled: {
        intent: "decision",
        title: `Merge ${from} → ${destName}`,
        polished_text: `Merged branch ${from} into ${destName}.`,
        entities: [],
        actions: [],
        suggested_agents: [],
        sentiment: { valence: 0.2, label: "positive" },
        language_detected: "en",
        keyterms_learned: [],
        graph_mutations: [],
      },
      trace: {
        region: s.profile.region,
        endpoint: "local",
        model: "merge",
        session_id: uid("merge"),
        request_time_ms: 0,
        client_roundtrip_ms: 0,
        proxy_roundtrip_ms: 0,
        audio_duration_ms: 0,
        audio_bytes: 0,
        audio_format: "none",
        prompt: "",
        keyterms_prompt: [],
        language_code: "en",
        conversation_context: [],
        timestamps: false,
        warmed: false,
        route: "simulated",
        retries: 0,
        simulated: true,
      },
      agent_runs: [],
      compile_ms: 0,
      total_ms: 0,
      merged_from: [from],
    };
    const nextGraph = mergeGraphs(s.graph, graphAt(s.graph, now));
    const branches = advanceHead(s.branches, destName, hash);
    set({
      thoughtforms: [...s.thoughtforms, tf],
      branches,
      graph: nextGraph,
      currentBranch: destName,
      selected: hash,
      timeCursor: null,
    });
    await store.putThoughtform(tf);
    await store.putBranch(branches[destName]);
    await store.setGraph(nextGraph);
    return { ok: true, message: `Merged ${from} into ${destName} as ${hash.slice(0, 7)}.` };
  },

  setAgentRuns: async (hash, runs) => {
    await get().updateThoughtform(hash, { agent_runs: runs });
  },

  upsertAgentRun: async (hash, run) => {
    const tf = get().thoughtforms.find((t) => t.commit_hash === hash);
    if (!tf) return;
    const existing = tf.agent_runs || [];
    const idx = existing.findIndex((r) => r.agent === run.agent);
    const next = idx >= 0 ? existing.map((r, i) => (i === idx ? { ...r, ...run } : r)) : [...existing, run];
    await get().updateThoughtform(hash, { agent_runs: next });
  },

  graphAt: (t) => graphAt(get().graph, t),

  visibleThoughtforms: () => {
    const s = get();
    const cursor = s.timeCursor;
    return s.thoughtforms
      .filter((t) => (cursor == null ? true : t.created_at <= cursor))
      .sort((a, b) => a.created_at - b.created_at);
  },

  enqueueDraft: async (d) => {
    await store.enqueueDraft(d);
    set({ drafts: [...get().drafts, d] });
  },

  dropDraft: async (id) => {
    await store.dropDraft(id);
    set({ drafts: get().drafts.filter((d) => d.id !== id) });
  },

  refreshDrafts: async () => {
    set({ drafts: await store.loadDrafts() });
  },

  setOnline: (v) => set({ online: v }),
  setAmbient: (v) => set({ ambient: v }),
  setCouncilOpen: (v) => set({ councilOpen: v }),

  toast: (kind, text, detail) => {
    const t: Toast = { id: uid("toast"), kind, text, detail };
    set((s) => ({ toasts: [...s.toasts, t].slice(-6) }));
    if (typeof window !== "undefined") {
      window.setTimeout(() => get().dismissToast(t.id), 5200);
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  reset: async () => {
    await store.wipeLocalTwin();
    set({
      profile: DEFAULT_PROFILE,
      thoughtforms: [],
      branches: initialBranches(),
      currentBranch: MAIN_BRANCH,
      graph: emptyGraph(),
      selected: null,
      timeCursor: null,
      drafts: [],
      ambient: false,
      councilOpen: false,
    });
  },
}));
