"use client";

// ============================================================================
// Cognitive Store — client-side state for the Studio. Holds the CognitiveState,
// current focus/time-travel, and exposes VCS + dictation actions.
// Persists to localStorage (stand-in for IndexedDB / Supabase in demo mode).
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CognitiveState,
  Thoughtform,
  DictationResponse,
} from "@/lib/types";
import { buildSeedState, DEFAULT_FOCUS_HASH } from "@/lib/seed";
import * as vcs from "@/lib/vcs";
import { composePrompt } from "@/lib/prompt-composer";
import { randomHash } from "@/lib/utils";

const STORAGE_KEY = "voxembly.state.v1";

interface StoreValue {
  state: CognitiveState;
  focusHash: string | null;
  timeTravel: number | null; // epoch ms or null (= live)
  setFocus: (hash: string | null) => void;
  setTimeTravel: (t: number | null) => void;
  checkout: (branch: string) => void;
  forkFromFocus: (branchName: string) => void;
  mergeInto: (source: string, target: string) => void;
  addThoughtform: (
    tf: Omit<
      Thoughtform,
      "commit_hash" | "parent_hashes" | "created_at"
    > & { created_at?: number }
  ) => string;
  ingestDictation: (
    resp: DictationResponse,
    extra: Partial<Thoughtform>
  ) => string;
  reseed: () => void;
  composed: ReturnType<typeof composePrompt>;
}

const Ctx = createContext<StoreValue | null>(null);

export function CognitiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CognitiveState>(() => buildSeedState());
  const [focusHash, setFocusHash] = useState<string | null>(DEFAULT_FOCUS_HASH);
  const [timeTravel, setTimeTravel] = useState<number | null>(null);
  const hydrated = useRef(false);

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CognitiveState;
        if (parsed?.thoughtforms && parsed?.order?.length) setState(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state]);

  const checkout = useCallback((branch: string) => {
    setState((s) => vcs.checkout(s, branch));
  }, []);

  const forkFromFocus = useCallback(
    (branchName: string) => {
      setState((s) => {
        const from = focusHash ?? vcs.headOf(s, s.currentBranch);
        if (!from) return s;
        return vcs.fork(s, from, branchName);
      });
    },
    [focusHash]
  );

  const mergeInto = useCallback((source: string, target: string) => {
    setState((s) => vcs.merge(s, source, target).state);
  }, []);

  const addThoughtform: StoreValue["addThoughtform"] = useCallback((tf) => {
    let hash = "";
    setState((s) => {
      const res = vcs.commit(s, { ...tf, branch: tf.branch ?? s.currentBranch });
      hash = res.commit_hash;
      return res.state;
    });
    setFocusHash(hash);
    return hash;
  }, []);

  const ingestDictation: StoreValue["ingestDictation"] = useCallback(
    (resp, extra) => {
      let hash = "";
      setState((s) => {
        const tf: Omit<
          Thoughtform,
          "commit_hash" | "parent_hashes" | "created_at"
        > = {
          branch: extra.branch ?? s.currentBranch,
          intent: extra.intent ?? "note",
          raw_text: resp.text,
          polished_text: extra.polished_text ?? resp.text,
          final_text: extra.final_text ?? extra.polished_text ?? resp.text,
          entities: extra.entities ?? [],
          actions: extra.actions ?? [],
          sentiment: extra.sentiment ?? "neutral",
          language: resp.language_code ?? "en",
          confidence: resp.confidence,
          request_time_ms: resp.request_time_ms ?? 0,
          audio_duration_ms: resp.audio_duration_ms,
          session_id: resp.session_id,
          words: resp.words,
          graph_mutations: extra.graph_mutations ?? [],
          spawned_agents: extra.spawned_agents ?? [],
          agent_runs: extra.agent_runs,
          title: extra.title ?? resp.text.slice(0, 48),
        };
        const res = vcs.commit(s, tf);
        hash = res.commit_hash;
        return res.state;
      });
      setFocusHash(hash);
      return hash;
    },
    []
  );

  const reseed = useCallback(() => {
    const fresh = buildSeedState();
    setState(fresh);
    setFocusHash(DEFAULT_FOCUS_HASH);
    setTimeTravel(null);
  }, []);

  const composed = useMemo(() => composePrompt(state), [state]);

  const value: StoreValue = {
    state,
    focusHash,
    timeTravel,
    setFocus: setFocusHash,
    setTimeTravel,
    checkout,
    forkFromFocus,
    mergeInto,
    addThoughtform,
    ingestDictation,
    reseed,
    composed,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCognitive() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCognitive must be used within CognitiveProvider");
  return v;
}

export { randomHash };
