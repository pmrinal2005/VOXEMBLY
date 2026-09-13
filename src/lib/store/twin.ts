"use client";

// ============================================================================
// VOXEMBLY — the Cognitive Twin store (Zustand). Central client state: profile,
// thoughtforms, branches, graph, selection, and the current time-travel cursor.
// Hydrates from IndexedDB and persists on every mutation.
// ============================================================================

import { create } from "zustand";
import type {
  AgentRun,
  Branch,
  Graph,
  Profile,
  Thoughtform,
} from "@/lib/types";
import { applyMutations, emptyGraph, graphAt } from "@/lib/twin/graph";
import { MAIN_BRANCH, advanceHead, createBranch, initialBranches } from "@/lib/twin/vcs";
import * as store from "@/lib/store/db";
import { uid } from "@/lib/utils";

export const DEFAULT_PROFILE: Profile = {
  id: "local",
  displayName: "You",
  primaryLanguage: "en",
  secondaryLanguages: [],
  domains: ["founder"],
  region: "global",
  latencyMode: "balanced",
  ambientDefault: false,
  onboarded: false,
};

export function newAgentRun(agent: AgentRun["agent"], model: string, thoughtformId: string): AgentRun {
  return {
    id: uid("ar"),
    agent,
    model,
    status: "pending",
    startedAt: Date.now(),
    thoughtformId,
  };
}

interface TwinState {
  hydrated: boolean;
  profile: Profile;
  thoughtforms: Thoughtform[];
  branches: Branch[];
  currentBranch: string;
  graph: Graph;
  selected: string | null; // selected thoughtform id
  timeCursor: number | null; // time-travel epoch ms (null = now)
  agentRuns: Record<string, AgentRun[]>; // thoughtformId → runs

  hydrate: () => Promise<void>;
  setProfile: (p: Profile) => void;
  addThoughtform: (tf: Thoughtform) => void;
  select: (id: string | null) => void;
  setTimeCursor: (t: number | null) => void;
  checkout: (branch: string) => void;
  fork: (name: string, fromCommit: string | null) => void;
  setAgentRuns: (thoughtformId: string, runs: AgentRun[]) => void;
  updateThoughtform: (id: string, patch: Partial<Thoughtform>) => void;
  reset: () => Promise<void>;

  // derived
  visibleGraph: () => Graph;
  headCommit: () => string | null;
}

export const useTwin = create<TwinState>((set, get) => ({
  hydrated: false,
  profile: DEFAULT_PROFILE,
  thoughtforms: [],
  branches: initialBranches(),
  currentBranch: MAIN_BRANCH,
  graph: emptyGraph(),
  selected: null,
  timeCursor: null,
  agentRuns: {},

  hydrate: async () => {
    if (get().hydrated) return;
    const [profile, tfs, branches, graph, current] = await Promise.all([
      store.getProfile(),
      store.allThoughtforms(),
      store.getBranches(),
      store.getGraph(),
      store.getCurrentBranch(),
    ]);
    set({
      hydrated: true,
      profile: profile || DEFAULT_PROFILE,
      thoughtforms: tfs || [],
      branches: branches && branches.length ? branches : initialBranches(),
      graph: graph || emptyGraph(),
      currentBranch: current || MAIN_BRANCH,
      selected: tfs && tfs.length ? tfs[tfs.length - 1].id : null,
    });
  },

  setProfile: (p) => {
    set({ profile: p });
    void store.setProfile(p);
  },

  addThoughtform: (tf) => {
    const s = get();
    const nextGraph = applyMutations(s.graph, tf.graph_mutations, tf.commit_hash, tf.createdAt);
    const branches = advanceHead(s.branches, tf.branch, tf.commit_hash);
    const thoughtforms = [...s.thoughtforms, tf];
    set({ thoughtforms, graph: nextGraph, branches, selected: tf.id, timeCursor: null });
    void store.saveThoughtform(tf);
    void store.setGraph(nextGraph);
    void store.setBranches(branches);
  },

  select: (id) => set({ selected: id }),

  setTimeCursor: (t) => set({ timeCursor: t }),

  checkout: (branch) => {
    set({ currentBranch: branch });
    void store.setCurrentBranch(branch);
  },

  fork: (name, fromCommit) => {
    const s = get();
    const branches = createBranch(s.branches, name, fromCommit);
    set({ branches, currentBranch: name });
    void store.setBranches(branches);
    void store.setCurrentBranch(name);
  },

  setAgentRuns: (thoughtformId, runs) =>
    set((s) => ({ agentRuns: { ...s.agentRuns, [thoughtformId]: runs } })),

  updateThoughtform: (id, patch) => {
    set((s) => {
      const thoughtforms = s.thoughtforms.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const updated = thoughtforms.find((t) => t.id === id);
      if (updated) void store.saveThoughtform(updated);
      return { thoughtforms };
    });
  },

  reset: async () => {
    await store.wipeAll();
    set({
      profile: DEFAULT_PROFILE,
      thoughtforms: [],
      branches: initialBranches(),
      currentBranch: MAIN_BRANCH,
      graph: emptyGraph(),
      selected: null,
      timeCursor: null,
      agentRuns: {},
    });
  },

  visibleGraph: () => {
    const s = get();
    return s.timeCursor == null ? s.graph : graphAt(s.graph, s.timeCursor);
  },

  headCommit: () => {
    const s = get();
    const b = s.branches.find((x) => x.name === s.currentBranch);
    return b?.head ?? null;
  },
}));
