/**
 * The Cognitive Twin store — single source of truth for the client.
 *
 * Holds the Thoughtform commit DAG, branches, the derived temporal graph, the checkout
 * (time-travel) pointer, agent runs, and the offline draft queue. Pure graph/VCS logic lives in
 * lib/twin/*; this store only orchestrates and persists.
 */

"use client";

import { create } from "zustand";
import type { AgentKind, AgentRun, Branch, GraphMutation, Profile, SyncRegion, Thoughtform } from "@/lib/types";
import { applyMutations, emptyGraph, rebuildGraph, snapshotAt, type TwinGraph } from "@/lib/twin/graph";
import { ancestry, BRANCH_COLORS, mainBranch, resolveRef, slugBranch } from "@/lib/twin/vcs";
import { cosine } from "@/lib/utils";
import * as store from "@/lib/store/db";

export const DEFAULT_PROFILE: Profile = {
  id: "me",
  display_name: "",
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

export interface ToastMsg {
  id: string;
  kind: "info" | "success" | "warn" | "error";
  text: string;
  detail?: string;
}

export interface TwinState {
  hydrated: boolean;
  profile: Profile;
  thoughtforms: Thoughtform[];
  branches: Record<string, Branch>;
  currentBranch: string;
  /** null = live HEAD; otherwise the commit we've time-travelled to */
  checkout: string | null;
  selected: string | null;
  graph: TwinGraph;
  drafts: store.DraftRecord[];
  online: boolean;
  toasts: ToastMsg[];
  councilOpen: boolean;
  ambient: boolean;
  lastError: string | null;

  hydrate: () => Promise<void>;
  setProfile: (p: Partial<Profile>) => Promise<void>;
  addThoughtform: (tf: Thoughtform) => Promise<void>;
  updateThoughtform: (hash: string, patch: Partial<Thoughtform>) => Promise<void>;
  setAgentRuns: (hash: string, runs: AgentRun[]) => Promise<void>;
  upsertAgentRun: (hash: string, run: AgentRun) => Promise<void>;

  head: () => string | null;
  byHash: () => Record<string, Thoughtform>;
  visibleThoughtforms: () => Thoughtform[];
  recentOnBranch: (branch?: string) => Thoughtform[];
  learnedKeyterms: () => string[];
  similarTo: (embedding: number[] | undefined, model: string | undefined, k?: number) => Thoughtform[];
  graphAt: (t?: number) => ReturnType<typeof snapshotAt>;

  select: (hash: string | null) => void;
  checkoutRef: (ref: string) => { ok: boolean; message: string };
  returnToHead: () => void;
  switchBranch: (name: string) => { ok: boolean; message: string };
  fork: (names: string[], fromHash?: string | null) => Promise<{ ok: boolean; created: string[]; message: string }>;
  merge: (from: string, into?: string) => Promise<{ ok: boolean; message: string; conflicts: number }>;
  rebuild: () => void;

  enqueueDraft: (d: store.DraftRecord) => Promise<void>;
  dropDraft: (id: string) => Promise<void>;
  refreshDrafts: () => Promise<void>;
  setOnline: (v: boolean) => void;

  toast: (kind: ToastMsg["kind"], text: string, detail?: string) => void;
  dismissToast: (id: string) => void;
  setCouncilOpen: (v: boolean) => void;
  setAmbient: (v: boolean) => void;
  setRegion: (r: SyncRegion) => Promise<void>;
  reset: () => Promise<void>;
}

export const useTwin = create<TwinState>((set, get) => ({
  hydrated: false,
  profile: DEFAULT_PROFILE,
  thoughtforms: [],
  branches: { main: mainBranch() },
  currentBranch: "main",
  checkout: null,
  selected: null,
  graph: emptyGraph(),
  drafts: [],
  online: true,
  toasts: [],
  councilOpen: false,
  ambient: false,
  lastError: null,

  /* ─────────────── hydration ─────────────── */

  hydrate: async () => {
    const [tfs, brs, prof, drafts] = await Promise.all([
      store.loadThoughtforms(),
      store.loadBranches(),
      store.loadProfile(),
      store.loadDrafts(),
    ]);
    const branches: Record<string, Branch> = {};
    for (const b of brs) branches[b.name] = b;
    if (!branches.main) branches.main = mainBranch();

    // Repair heads in case a write was interrupted.
    for (const name of Object.keys(branches)) {
      const onBranch = tfs.filter((t) => t.branch === name).sort((a, b) => a.created_at - b.created_at);
      if (onBranch.length) branches[name].head = onBranch[onBranch.length - 1].commit_hash;
    }

    const current = (await store.getMeta<string>("currentBranch")) ?? "main";
    const currentBranch = branches[current] ? current : "main";
    const graph = rebuildGraph(tfs, ancestry(branches[currentBranch]?.head ?? null, Object.fromEntries(tfs.map((t) => [t.commit_hash, t]))));

    set({
      hydrated: true,
      thoughtforms: tfs,
      branches,
      currentBranch,
      profile: prof ?? DEFAULT_PROFILE,
      drafts,
      graph,
      selected: tfs.length ? tfs[tfs.length - 1].commit_hash : null,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    });
  },

  setProfile: async (p) => {
    const next = { ...get().profile, ...p };
    set({ profile: next });
    await store.saveProfile(next);
  },

  /* ─────────────── commits ─────────────── */

  addThoughtform: async (tf) => {
    const { branches } = get();
    const branch = branches[tf.branch] ?? { ...mainBranch(), name: tf.branch };
    const nextBranches = { ...branches, [tf.branch]: { ...branch, head: tf.commit_hash } };
    const thoughtforms = [...get().thoughtforms, tf];

    // Apply mutations incrementally to the live graph (so nodes visibly fly in), unless we're detached.
    const graph: TwinGraph = { nodes: { ...get().graph.nodes }, edges: { ...get().graph.edges } };
    applyMutations(graph, tf.compiled.graph_mutations, { commit: tf.commit_hash, branch: tf.branch, at: tf.created_at });

    set({ thoughtforms, branches: nextBranches, graph, selected: tf.commit_hash, checkout: null });
    await Promise.all([store.putThoughtform(tf), store.putBranch(nextBranches[tf.branch])]);
  },

  updateThoughtform: async (hash, patch) => {
    const thoughtforms = get().thoughtforms.map((t) => (t.commit_hash === hash ? { ...t, ...patch } : t));
    set({ thoughtforms });
    const tf = thoughtforms.find((t) => t.commit_hash === hash);
    if (tf) await store.putThoughtform(tf);
  },

  setAgentRuns: async (hash, runs) => {
    await get().updateThoughtform(hash, { agent_runs: runs });
  },

  upsertAgentRun: async (hash, run) => {
    const tf = get().thoughtforms.find((t) => t.commit_hash === hash);
    if (!tf) return;
    const runs = [...tf.agent_runs];
    const i = runs.findIndex((r) => r.id === run.id || r.agent === run.agent);
    if (i >= 0) runs[i] = run;
    else runs.push(run);
    await get().updateThoughtform(hash, { agent_runs: runs });
  },

  /* ─────────────── derived ─────────────── */

  head: () => get().branches[get().currentBranch]?.head ?? null,

  byHash: () => Object.fromEntries(get().thoughtforms.map((t) => [t.commit_hash, t])),

  visibleThoughtforms: () => {
    const { thoughtforms, checkout, currentBranch, branches } = get();
    const byHash = Object.fromEntries(thoughtforms.map((t) => [t.commit_hash, t]));
    const reach = ancestry(checkout ?? branches[currentBranch]?.head ?? null, byHash);
    return thoughtforms.filter((t) => reach.has(t.commit_hash)).sort((a, b) => b.created_at - a.created_at);
  },

  recentOnBranch: (branch) => {
    const b = branch ?? get().currentBranch;
    return get()
      .thoughtforms.filter((t) => t.branch === b)
      .sort((a, b2) => b2.created_at - a.created_at);
  },

  learnedKeyterms: () => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const tf of [...get().thoughtforms].sort((a, b) => b.created_at - a.created_at)) {
      for (const k of tf.compiled.keyterms_learned ?? []) {
        const key = k.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(k);
        }
      }
      if (out.length > 200) break;
    }
    return out;
  },

  /** k-NN over stored embeddings — only vectors from the SAME model are comparable. */
  similarTo: (embedding, model, k = 8) => {
    if (!embedding?.length) return [];
    return get()
      .thoughtforms.filter((t) => t.embedding?.length && t.embedding_model === model)
      .map((t) => ({ t, score: cosine(embedding, t.embedding!) }))
      .filter((x) => x.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => x.t);
  },

  graphAt: (t) => {
    const { graph, currentBranch } = get();
    return snapshotAt(graph, t ?? Date.now(), currentBranch);
  },

  /* ─────────────── navigation / VCS ─────────────── */

  select: (hash) => set({ selected: hash }),

  rebuild: () => {
    const { thoughtforms, checkout, currentBranch, branches } = get();
    const byHash = Object.fromEntries(thoughtforms.map((t) => [t.commit_hash, t]));
    const graph = rebuildGraph(thoughtforms, ancestry(checkout ?? branches[currentBranch]?.head ?? null, byHash));
    set({ graph });
  },

  checkoutRef: (ref) => {
    const { thoughtforms, branches, currentBranch } = get();
    const { hash, explanation } = resolveRef(ref, { thoughtforms, branches, currentBranch });
    if (!hash) return { ok: false, message: explanation };
    set({ checkout: hash, selected: hash });
    get().rebuild();
    const tf = thoughtforms.find((t) => t.commit_hash === hash);
    return { ok: true, message: `Checked out ${hash.slice(0, 7)} — ${explanation}${tf ? ` (${tf.compiled.title})` : ""}` };
  },

  returnToHead: () => {
    set({ checkout: null });
    get().rebuild();
  },

  switchBranch: (name) => {
    const slug = slugBranch(name);
    const b = get().branches[name] ?? get().branches[slug];
    if (!b) return { ok: false, message: `No branch named "${name}"` };
    set({ currentBranch: b.name, checkout: null, selected: b.head });
    void store.setMeta("currentBranch", b.name);
    get().rebuild();
    return { ok: true, message: `Switched to branch ${b.name}` };
  },

  fork: async (names, fromHash) => {
    const { branches, currentBranch } = get();
    const base = fromHash ?? get().checkout ?? branches[currentBranch]?.head ?? null;
    const created: string[] = [];
    const next = { ...branches };
    for (const raw of names) {
      let name = slugBranch(raw);
      if (!name) continue;
      let n = 2;
      while (next[name]) name = `${slugBranch(raw)}-${n++}`;
      next[name] = {
        name,
        head: base,
        created_at: Date.now(),
        parent_branch: currentBranch,
        forked_from: base,
        color: BRANCH_COLORS[Object.keys(next).length % BRANCH_COLORS.length],
      };
      created.push(name);
    }
    if (!created.length) return { ok: false, created: [], message: "Nothing to fork" };
    set({ branches: next });
    await store.putBranches(created.map((c) => next[c]));
    return { ok: true, created, message: `Forked ${created.length} branch${created.length > 1 ? "es" : ""}: ${created.join(", ")}` };
  },

  merge: async (from, into) => {
    const { branches, thoughtforms } = get();
    const target = into ?? get().currentBranch;
    const src = branches[from] ?? branches[slugBranch(from)];
    const dst = branches[target];
    if (!src) return { ok: false, message: `No branch named "${from}"`, conflicts: 0 };
    if (!dst) return { ok: false, message: `No branch named "${target}"`, conflicts: 0 };
    if (src.name === dst.name) return { ok: false, message: "Cannot merge a branch into itself", conflicts: 0 };
    if (!src.head) return { ok: false, message: `Branch "${src.name}" has no commits`, conflicts: 0 };

    const byHash = Object.fromEntries(thoughtforms.map((t) => [t.commit_hash, t]));
    const srcReach = ancestry(src.head, byHash);
    const dstReach = ancestry(dst.head, byHash);

    // Commits unique to the source branch — their mutations replay onto the target.
    const incoming = [...srcReach].filter((h) => !dstReach.has(h)).map((h) => byHash[h]).filter(Boolean).sort((a, b) => a.created_at - b.created_at);

    if (!incoming.length) return { ok: false, message: `Already up to date with ${src.name}`, conflicts: 0 };

    const mutations: GraphMutation[] = incoming.flatMap((t) => t.compiled.graph_mutations);
    const now = Date.now();
    const { computeCommitHash } = await import("@/lib/twin/vcs");
    const summary = `Merged ${src.name} into ${dst.name}: ${incoming.length} thoughtform${incoming.length > 1 ? "s" : ""}.`;
    const commit_hash = await computeCommitHash({
      parent_hashes: [dst.head, src.head].filter(Boolean) as string[],
      branch: dst.name,
      created_at: now,
      raw_text: summary,
      polished_text: summary,
      intent: "command",
      session_id: `merge:${src.name}->${dst.name}`,
    });

    const mergeCommit: Thoughtform = {
      id: commit_hash,
      commit_hash,
      parent_hashes: [dst.head, src.head].filter(Boolean) as string[],
      branch: dst.name,
      created_at: now,
      raw_text: summary,
      words: [],
      confidence: 1,
      compiled: {
        intent: "command",
        polished_text: summary,
        title: `Merge ${src.name} → ${dst.name}`,
        entities: [],
        actions: [],
        graph_mutations: mutations,
        suggested_agents: [],
        sentiment: { valence: 0, label: "neutral" },
        language_detected: "en",
        command: { verb: "merge", args: [src.name, dst.name] },
        keyterms_learned: [],
      },
      trace: {
        region: get().profile.region,
        endpoint: "local",
        model: "universal-3-5-pro",
        session_id: `merge:${src.name}->${dst.name}`,
        request_time_ms: null,
        client_roundtrip_ms: 0,
        proxy_roundtrip_ms: 0,
        audio_duration_ms: 0,
        audio_bytes: 0,
        audio_format: "audio/wav",
        prompt: "",
        keyterms_prompt: [],
        language_code: null,
        conversation_context: [],
        timestamps: false,
        warmed: false,
        route: "sync",
        retries: 0,
      },
      agent_runs: [],
      compile_ms: 0,
      total_ms: 0,
      merged_from: [src.name],
    };

    await get().addThoughtform(mergeCommit);
    set({ currentBranch: dst.name });
    get().rebuild();
    return { ok: true, message: summary, conflicts: 0 };
  },

  /* ─────────────── drafts / connectivity ─────────────── */

  enqueueDraft: async (d) => {
    await store.putDraft(d);
    set({ drafts: [...get().drafts, d] });
  },

  dropDraft: async (id) => {
    await store.deleteDraft(id);
    set({ drafts: get().drafts.filter((d) => d.id !== id) });
  },

  refreshDrafts: async () => set({ drafts: await store.loadDrafts() }),

  setOnline: (v) => set({ online: v }),

  /* ─────────────── ui ─────────────── */

  toast: (kind, text, detail) => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts.slice(-3), { id, kind, text, detail }] });
    if (typeof window !== "undefined") {
      window.setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4500);
    }
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setCouncilOpen: (v) => set({ councilOpen: v }),
  setAmbient: (v) => set({ ambient: v }),

  setRegion: async (r) => {
    await get().setProfile({ region: r });
  },

  reset: async () => {
    await store.wipeLocalTwin();
    set({
      thoughtforms: [],
      branches: { main: mainBranch() },
      currentBranch: "main",
      checkout: null,
      selected: null,
      graph: emptyGraph(),
      drafts: [],
    });
  },
}));

/** Agent-run factory shared by the Council UI and the dispatcher. */
export function newAgentRun(agent: AgentKind, model: string): AgentRun {
  return {
    id: `${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agent,
    model,
    provider: "groq",
    status: "queued",
    started_at: Date.now(),
  };
}
