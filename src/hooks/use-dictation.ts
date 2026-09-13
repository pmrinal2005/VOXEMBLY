"use client";

// ============================================================================
// use-dictation — orchestrates the full Push-to-Think loop:
//  keydown → /warm → record → keyup → /api/transcribe → /api/cleanup →
//  commit Thoughtform → optionally /api/agents (council)
// Falls back to a demo transcript when mic/API is unavailable.
// ============================================================================

import { useCallback, useRef, useState } from "react";
import { encodeWav, downsampleTo16k } from "@/lib/wav";
import { pickDemoTranscript } from "@/lib/demo-transcripts";
import { useCognitive } from "@/store/cognitive-store";
import type {
  AgentRun,
  DictationResponse,
  GraphMutation,
  Thoughtform,
  NodeKind,
} from "@/lib/types";
import { randomHash } from "@/lib/utils";

export type DictationPhase =
  | "idle"
  | "warming"
  | "recording"
  | "transcribing"
  | "cleaning"
  | "committing"
  | "council"
  | "done"
  | "error";

export interface LiveResult {
  raw: string;
  polished: string;
  words: { text: string; confidence: number }[];
  request_time_ms: number;
  confidence: number;
  intent: string;
  hash?: string;
}

export function useDictation() {
  const { ingestDictation, composed, state } = useCognitive();
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [live, setLive] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [councilRuns, setCouncilRuns] = useState<AgentRun[]>([]);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(48000);
  const recordingRef = useRef(false);

  const warm = useCallback(async () => {
    try {
      await fetch("/api/warm");
    } catch {
      /* non-blocking */
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setLive(null);
    setCouncilRuns([]);
    setPhase("warming");
    void warm();

    // Try real mic capture; if it fails we'll use a demo transcript on stop.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];
      processor.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      mediaRef.current = { stop: () => processor.disconnect() } as unknown as MediaRecorder;
      recordingRef.current = true;
    } catch {
      // No mic — demo mode; we still show "recording".
      recordingRef.current = true;
    }
    setPhase("recording");
  }, [warm]);

  const runPipeline = useCallback(
    async (resp: DictationResponse, rawWords: { text: string; confidence: number }[]) => {
      // 2) Cleanup pass → strict-JSON Thoughtform fields
      setPhase("cleaning");
      let cleanup: {
        intent: string;
        polished_text: string;
        title: string;
        entities: string[];
        actions: string[];
        sentiment: Thoughtform["sentiment"];
        graph_mutations: { op: string; kind: string; label: string }[];
        spawned_agents: Thoughtform["spawned_agents"];
      };
      try {
        const res = await fetch("/api/cleanup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: resp.text }),
        });
        cleanup = await res.json();
      } catch {
        cleanup = {
          intent: "note",
          polished_text: resp.text,
          title: resp.text.slice(0, 48),
          entities: [],
          actions: [],
          sentiment: "neutral",
          graph_mutations: [],
          spawned_agents: [],
        };
      }

      setLive({
        raw: resp.text,
        polished: cleanup.polished_text,
        words: rawWords,
        request_time_ms: resp.request_time_ms ?? 0,
        confidence: resp.confidence,
        intent: cleanup.intent,
      });

      // 3) Map graph_mutations → add_node ops linked to VOXEMBLY project.
      const voxNode = state.nodes.find((n) => n.label === "VOXEMBLY");
      const mutations: GraphMutation[] = [];
      for (const m of cleanup.graph_mutations.slice(0, 4)) {
        const nodeId = `n_${randomHash()}`;
        mutations.push({
          op: "add_node",
          node: {
            id: nodeId,
            kind: (m.kind as NodeKind) ?? "Concept",
            label: m.label,
          },
        });
        if (voxNode) {
          mutations.push({
            op: "add_edge",
            edge: { source: voxNode.id, target: nodeId, label: "mentions" },
          });
        }
      }

      // 4) Commit Thoughtform
      setPhase("committing");
      const hash = ingestDictation(resp, {
        intent: cleanup.intent as Thoughtform["intent"],
        polished_text: cleanup.polished_text,
        final_text: cleanup.polished_text,
        title: cleanup.title,
        entities: cleanup.entities,
        actions: cleanup.actions,
        sentiment: cleanup.sentiment,
        graph_mutations: mutations,
        spawned_agents: cleanup.spawned_agents,
      });

      setLive((prev) => (prev ? { ...prev, hash } : prev));
      setPhase("done");
      return { hash, cleanup };
    },
    [ingestDictation, state.nodes]
  );

  const stop = useCallback(async () => {
    recordingRef.current = false;

    // Tear down mic graph.
    try {
      mediaRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      await audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }

    setPhase("transcribing");

    // Build audio if we captured any.
    const flat = flattenChunks(chunksRef.current);
    let resp: DictationResponse;
    let rawWords: { text: string; confidence: number }[];

    if (flat.length > 1600) {
      // ~>100ms of audio: attempt real transcription.
      const mono16k = downsampleTo16k(flat, sampleRateRef.current);
      const wav = encodeWav(mono16k, 16000);
      const form = new FormData();
      form.append("audio", wav, "dictation.wav");
      form.append("prompt", composed.prompt);
      form.append("keyterms_prompt", JSON.stringify(composed.keyterms_prompt));
      try {
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        if (res.ok) {
          resp = await res.json();
          rawWords = resp.words?.length
            ? resp.words.map((w) => ({ text: w.text, confidence: w.confidence }))
            : resp.text.split(/\s+/).map((t) => ({ text: t, confidence: resp.confidence }));
        } else {
          const demo = pickDemoTranscript();
          resp = synthResponse(demo.raw, demo.words);
          rawWords = demo.words;
        }
      } catch {
        const demo = pickDemoTranscript();
        resp = synthResponse(demo.raw, demo.words);
        rawWords = demo.words;
      }
    } else {
      // No/very short audio → demo transcript (keeps the loop demoable).
      const demo = pickDemoTranscript();
      resp = synthResponse(demo.raw, demo.words);
      rawWords = demo.words;
    }

    chunksRef.current = [];
    return runPipeline(resp, rawWords);
  }, [composed, runPipeline]);

  const cancel = useCallback(async () => {
    recordingRef.current = false;
    try {
      mediaRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      await audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    chunksRef.current = [];
    setPhase("idle");
  }, []);

  const convene = useCallback(
    async (agents: Thoughtform["spawned_agents"], context: string) => {
      setPhase("council");
      setCouncilRuns(agents.map((a) => ({ agent: a, model: "…", status: "running" })));
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agents, context }),
        });
        const data = (await res.json()) as { runs: AgentRun[] };
        setCouncilRuns(data.runs);
        setPhase("done");
        return data.runs;
      } catch {
        setPhase("done");
        return [];
      }
    },
    []
  );

  return { phase, live, error, councilRuns, start, stop, cancel, convene, warm };
}

function flattenChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function synthResponse(
  raw: string,
  words: { text: string; confidence: number }[]
): DictationResponse {
  const conf = words.reduce((a, w) => a + w.confidence, 0) / (words.length || 1);
  return {
    text: raw,
    words,
    confidence: conf,
    audio_duration_ms: Math.round(words.length * 380),
    session_id: `sess_demo_${randomHash()}`,
    request_time_ms: 118 + Math.floor(Math.random() * 40), // ~134ms p50 flavor
    language_code: "en",
  };
}
