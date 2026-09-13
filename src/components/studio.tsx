"use client";

/**
 * The VOXEMBLY Studio — the three-panel canvas that runs the whole loop.
 *
 * Push-to-Think (Flow B), measured end to end:
 *   key-down  → GET /api/warm (TLS off the critical path) + Prompt Composer reads the Twin
 *   recording → WebAudio Float32 → 16 kHz mono S16LE (WAV / raw PCM), client-side VAD trim
 *   key-up    → POST /api/transcribe (Sync STT, universal-3-5-pro)
 *             → POST /api/compile   (Groq strict-JSON Thoughtform)
 *             → commit hash → graph mutations → embedding → agent dispatch
 *
 * Also hosts Ambient Mode (Flow C), Time Travel (Flow D), Fork/Merge (Flow E), the Council (Flow F),
 * multilingual translate (Flow G), Publish (Flow H), and the full hands-free voice command grammar.
 */

import * as React from "react";
import Link from "next/link";
import type { AgentKind, AgentRun, PublishedThoughtform, Thoughtform } from "@/lib/types";
import { useTwin, newAgentRun, DEFAULT_PROFILE } from "@/lib/store/twin";
import { PushToTalkRecorder, waveformPeaks, type CaptureResult } from "@/lib/client/recorder";
import { buildThoughtform, compile, composeNow, embed, PipelineError, resolveCommand, transcribe, warmUp, type TranscribeResponse } from "@/lib/client/pipeline";
import { convene, type CouncilEvent } from "@/lib/client/council";
import { LIMITS } from "@/lib/dictation/client";
import { rankedLabels } from "@/lib/twin/graph";
import { domainById } from "@/lib/twin/composer";
import * as store from "@/lib/store/db";
import { cn, formatMs, shortHash, uid } from "@/lib/utils";
import { Badge, Button, Empty, Hint, Kbd, Modal, Spinner } from "@/components/ui";
import { Bento, BentoCard, Dock, Drawer, Icon, MobileTabBar, Sidebar, type NavItem } from "@/components/shell";
import { Orb, Waveform, type OrbPhase } from "@/components/orb";
import { LatencyDial } from "@/components/telemetry";
import { TwinCanvas } from "@/components/twin-canvas";
import { Timeline } from "@/components/timeline";
import { CouncilModal, AGENT_UI, type CouncilSynthesis } from "@/components/council";
import { ThoughtformPanel } from "@/components/thoughtform-panel";
import { Toasts } from "@/components/toasts";
import { Onboarding } from "@/components/onboarding";
import { SettingsModal } from "@/components/settings";

/**
 * The four Studio surfaces. On xl they are all mounted simultaneously; below xl they time-share the
 * viewport and `surface` decides which one is showing.
 */
type SurfaceId = "commits" | "twin" | "thoughtform" | "timeline";

/** xl — the breakpoint at which the full sidebar + bento + docked timeline all fit at once. */
const DESKTOP_QUERY = "(min-width: 1280px)";

export function Studio() {
  /* ───────── store ───────── */
  const hydrated = useTwin((s) => s.hydrated);
  const hydrate = useTwin((s) => s.hydrate);
  const profile = useTwin((s) => s.profile);
  const thoughtforms = useTwin((s) => s.thoughtforms);
  const branches = useTwin((s) => s.branches);
  const currentBranch = useTwin((s) => s.currentBranch);
  const checkout = useTwin((s) => s.checkout);
  const selected = useTwin((s) => s.selected);
  const graph = useTwin((s) => s.graph);
  const drafts = useTwin((s) => s.drafts);
  const online = useTwin((s) => s.online);
  const ambient = useTwin((s) => s.ambient);
  const councilOpen = useTwin((s) => s.councilOpen);
  const toast = useTwin((s) => s.toast);

  /* ───────── local ui state ───────── */
  const [phase, setPhase] = React.useState<OrbPhase>("idle");
  const [level, setLevel] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [peaks, setPeaks] = React.useState<number[]>([]);
  const [lastTrace, setLastTrace] = React.useState<{ request_time_ms: number | null; proxy: number | null; client: number | null; warmed: boolean; region: string } | null>(null);
  const [selectedNode, setSelectedNode] = React.useState<string | null>(null);
  const [highlight, setHighlight] = React.useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [forkOpen, setForkOpen] = React.useState(false);
  const [forkNames, setForkNames] = React.useState("Plan A, Plan B");
  const [mergeFrom, setMergeFrom] = React.useState("");
  const [publishing, setPublishing] = React.useState(false);
  const [publishedUrl, setPublishedUrl] = React.useState<{ url: string; shared: boolean } | null>(null);
  const [translating, setTranslating] = React.useState(false);
  const [translation, setTranslation] = React.useState<{ target: string; text: string } | null>(null);
  const [councilRunning, setCouncilRunning] = React.useState(false);
  const [synthesis, setSynthesis] = React.useState<CouncilSynthesis | null>(null);
  const [synthesizing, setSynthesizing] = React.useState(false);
  const [composedPreview, setComposedPreview] = React.useState<ReturnType<typeof composeNow> | null>(null);
  const [micReady, setMicReady] = React.useState(false);
  const [micError, setMicError] = React.useState<string | null>(null);
  const [usePCM, setUsePCM] = React.useState(false);
  const [health, setHealth] = React.useState<{ degraded: string[]; dictation?: { configured: boolean } } | null>(null);

  /* ───────── responsive shell state ───────── */
  // `isDesktop` starts false so the first server/client paint agrees (no hydration mismatch); the
  // matchMedia effect below promotes it on xl viewports.
  const [isDesktop, setIsDesktop] = React.useState(false);
  const [surface, setSurface] = React.useState<SurfaceId>("twin");
  const [navOpen, setNavOpen] = React.useState(false);
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [timelineOpen, setTimelineOpen] = React.useState(true);

  const recorderRef = React.useRef<PushToTalkRecorder | null>(null);
  const keyupAtRef = React.useRef(0);
  const spaceHeld = React.useRef(false);
  const levelTimer = React.useRef<number>(0);

  const selectedTf = React.useMemo(() => thoughtforms.find((t) => t.commit_hash === selected) ?? null, [thoughtforms, selected]);
  const visible = useTwin((s) => s.visibleThoughtforms)();

  /**
   * Switch surface. Below xl this is the only way to change what's on screen, so it also closes the
   * drawer — otherwise tapping a nav item would leave the overlay covering the surface it selected.
   */
  const goto = React.useCallback((id: SurfaceId) => {
    setSurface(id);
    setNavOpen(false);
  }, []);

  /* ───────── boot ───────── */

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /**
   * Track the xl breakpoint. Above it the sidebar is persistent, every bento card is mounted and the
   * timeline is a dock; below it the sidebar becomes a modal drawer and the cards time-share via the
   * tab bar. Collapsing to an icon rail is the sensible default on the narrower desktop sizes.
   */
  React.useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const apply = (matches: boolean) => {
      setIsDesktop(matches);
      // Leaving desktop closes the drawer; entering it retires the drawer entirely.
      if (matches) setNavOpen(false);
      else setRailCollapsed(false);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);

    // A short viewport (landscape phone / small laptop) starts with the timeline dock collapsed so
    // the Twin canvas keeps usable height.
    if (window.innerHeight < 760) setTimelineOpen(false);

    return () => mq.removeEventListener("change", onChange);
  }, []);

  React.useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  // Reflect accessibility preferences on <html> so globals.css can act on them.
  React.useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("hc", profile.high_contrast);
    el.classList.toggle("reduce-motion", profile.reduce_motion);
  }, [profile.high_contrast, profile.reduce_motion]);

  // Online/offline → offline draft queue.
  React.useEffect(() => {
    const on = () => {
      useTwin.getState().setOnline(true);
      void flushDrafts();
    };
    const off = () => useTwin.getState().setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── recorder ───────── */

  const recorder = React.useCallback(() => {
    if (!recorderRef.current) {
      const r = new PushToTalkRecorder();
      r.onLevel = (l) => setLevel(l);
      r.onMaxDuration = () => {
        toast("warn", "120-second ceiling reached", "Committing what we have — longer clips route to the Long-form pathway.");
        void finishCapture(r.stop());
      };
      r.onUtterance = (res) => {
        void runPipeline(res, "ambient");
      };
      recorderRef.current = r;
    }
    return recorderRef.current;
  }, [toast]);

  const prepareMic = React.useCallback(async () => {
    try {
      await recorder().prepare();
      setMicReady(true);
      setMicError(null);
      return true;
    } catch (e) {
      const msg = (e as Error).message || "Microphone permission denied";
      setMicError(msg);
      setMicReady(false);
      toast("error", "Microphone unavailable", msg);
      return false;
    }
  }, [recorder, toast]);

  React.useEffect(() => () => recorderRef.current?.dispose(), []);

  /* ───────── push-to-think ───────── */

  const onStart = React.useCallback(async () => {
    if (phase === "transcribing" || phase === "compiling") return;
    setPhase("arming");
    setTranslation(null);

    const ok = micReady || (await prepareMic());
    if (!ok) {
      setPhase("error");
      return;
    }

    // 1. warm the connection (fire-and-forget: a failed warm costs latency, never the utterance)
    void warmUp(profile.region).then((w) => {
      if (!w.ok && w.reason) console.warn("[voxembly] warm failed:", w.reason);
    });
    // 2. compose the next request's prompt/keyterms from the Twin, in parallel with recording
    try {
      setComposedPreview(composeNow());
    } catch {
      /* composer is defensive; never block capture */
    }

    recorder().start();
    setPhase("recording");
    setElapsed(0);
    setPeaks([]);

    window.clearInterval(levelTimer.current);
    levelTimer.current = window.setInterval(() => {
      const r = recorderRef.current;
      if (!r?.isRecording) return;
      setElapsed(r.elapsedMs);
      const l = r.level();
      setLevel(l);
      setPeaks((p) => [...p.slice(-79), l]);
    }, 60);
  }, [phase, micReady, prepareMic, profile.region, recorder]);

  const onStop = React.useCallback(() => {
    window.clearInterval(levelTimer.current);
    const r = recorderRef.current;
    if (!r?.isRecording) {
      if (phase === "recording" || phase === "arming") setPhase("idle");
      return;
    }
    keyupAtRef.current = performance.now();
    void finishCapture(r.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onCancel = React.useCallback(() => {
    window.clearInterval(levelTimer.current);
    recorderRef.current?.stop();
    setPhase("idle");
    setLevel(0);
    toast("info", "Dictation cancelled");
  }, [toast]);

  async function finishCapture(capture: CaptureResult | null) {
    if (!capture) {
      setPhase("idle");
      return;
    }
    setPeaks(waveformPeaks(capture.samples, 80));
    await runPipeline(capture, "ptt");
  }

  /** The full pipeline: transcribe → compile → commit → mutate → embed → dispatch. */
  async function runPipeline(capture: CaptureResult, source: "ptt" | "ambient" | "draft") {
    // Swallow sub-80 ms taps before they cost a request (documented `audio_too_short`).
    if (capture.durationMs < LIMITS.minDurationMs) {
      setPhase("idle");
      toast("info", "That was a tap, not a thought", "Hold the Orb a little longer (minimum 80 ms).");
      return;
    }
    if (capture.silent) {
      setPhase("idle");
      toast("info", "Nothing but silence captured", "Check your microphone input level.");
      return;
    }

    const composed = composedPreview ?? composeNow();
    const t0 = keyupAtRef.current || performance.now();

    // Offline → queue the audio with the context it was recorded in, replay on reconnect.
    if (!navigator.onLine) {
      const draft: store.DraftRecord = {
        id: uid("draft"),
        created_at: Date.now(),
        audio: usePCM ? capture.pcm : capture.wav,
        contentType: usePCM ? "audio/pcm" : "audio/wav",
        durationMs: capture.durationMs,
        sampleRate: capture.sampleRate,
        channels: 1,
        branch: currentBranch,
        config: composed.config,
        attempts: 0,
      };
      await useTwin.getState().enqueueDraft(draft);
      setPhase("idle");
      toast("warn", "Offline — dictation queued", "It will transcribe and commit automatically when you reconnect.");
      return;
    }

    setPhase("transcribing");
    let response: TranscribeResponse;
    try {
      response = await transcribe(capture, composed.config, profile.region, usePCM);
    } catch (e) {
      setPhase("error");
      const err = e as PipelineError;
      if (err.swallowed) {
        setPhase("idle");
        return;
      }
      toast("error", "Dictation failed", err.message);
      window.setTimeout(() => setPhase("idle"), 1600);
      return;
    }

    const t = response.transcript;
    setLastTrace({
      request_time_ms: typeof t.request_time_ms === "number" ? t.request_time_ms : null,
      proxy: response.meta.proxy_ms,
      client: Math.round(performance.now() - t0),
      warmed: response.meta.warmed,
      region: response.meta.region,
    });

    if (!t.text?.trim()) {
      setPhase("idle");
      toast("info", "No speech recognised in that clip");
      return;
    }

    setPhase("compiling");
    let compiled;
    let compileMs = 0;
    try {
      const res = await compile(t.text);
      compiled = res.compiled;
      compileMs = res.compile_ms;
      if (res.degraded) {
        toast("warn", "Compiled locally", "No LLM reachable — used the built-in heuristic compiler. Intent and entities are approximate.");
      }
    } catch (e) {
      setPhase("error");
      toast("error", "Compile failed", (e as Error).message);
      window.setTimeout(() => setPhase("idle"), 1600);
      return;
    }

    const tf = await buildThoughtform({
      capture,
      response,
      compiled,
      compile_ms: compileMs,
      composed,
      clientRoundtripMs: Math.round(performance.now() - t0),
      totalMs: Math.round(performance.now() - t0),
    });

    // A pure app command ("checkout my Tuesday brain") executes instead of committing noise.
    const command = resolveCommand(compiled, t.text);
    const isPureCommand = compiled.intent === "command" && command && !compiled.entities.length;

    if (!isPureCommand) {
      const before = new Set(Object.keys(useTwin.getState().graph.nodes));
      await useTwin.getState().addThoughtform(tf);
      const after = Object.keys(useTwin.getState().graph.nodes);
      setHighlight(after.filter((id) => !before.has(id)));
      setPhase("done");
      window.setTimeout(() => setPhase("idle"), 1400);

      // Embedding is best-effort and off the critical path.
      void embed(compiled.polished_text).then(({ vector, model }) => {
        if (vector?.length) void useTwin.getState().updateThoughtform(tf.commit_hash, { embedding: vector, embedding_model: model });
      });

      // Auto-dispatch the suggested fleet for high-value intents.
      if (source !== "draft" && ["decision", "question", "idea"].includes(compiled.intent) && compiled.suggested_agents.length) {
        void runCouncil(tf, compiled.suggested_agents.slice(0, 3), false);
      }
    } else {
      setPhase("idle");
    }

    if (command) await executeCommand(command, tf);
  }

  /* ───────── voice command grammar ───────── */

  async function executeCommand(cmd: NonNullable<ReturnType<typeof resolveCommand>>, tf: Thoughtform) {
    const s = useTwin.getState();
    switch (cmd.verb) {
      case "checkout": {
        const r = s.checkoutRef(cmd.args[0] ?? "");
        toast(r.ok ? "success" : "warn", r.ok ? "Time travelled" : "Could not time travel", r.message);
        break;
      }
      case "return":
        s.returnToHead();
        toast("success", "Returned to HEAD", "Live view restored.");
        break;
      case "branch": {
        const r = await s.fork(cmd.args.length ? cmd.args : ["branch"], tf.commit_hash);
        toast(r.ok ? "success" : "warn", r.ok ? "Branched" : "Could not branch", r.message);
        break;
      }
      case "switch": {
        const r = s.switchBranch(cmd.args[0] ?? "");
        toast(r.ok ? "success" : "warn", r.message);
        break;
      }
      case "merge": {
        const r = await s.merge(cmd.args[0] ?? "", cmd.args[1] || undefined);
        toast(r.ok ? "success" : "warn", r.ok ? "Merged" : "Could not merge", r.message);
        break;
      }
      case "council":
        s.setCouncilOpen(true);
        void runCouncil(selectedTf ?? tf);
        break;
      case "publish":
        await doPublish(selectedTf ?? tf);
        break;
      case "ambient":
        setAmbientMode(cmd.args[0] !== "off");
        break;
      case "search":
        s.setCouncilOpen(true);
        void runCouncil(tf, ["researcher"]);
        break;
      case "undo": {
        toast("info", "Undo is manual by design", "Thoughtforms are commits — check out the previous commit instead of deleting history.");
        break;
      }
    }
  }

  /* ───────── ambient mode ───────── */

  const setAmbientMode = React.useCallback(
    async (on: boolean) => {
      if (on) {
        const ok = micReady || (await prepareMic());
        if (!ok) return;
      }
      recorder().setAmbient(on);
      useTwin.getState().setAmbient(on);
      setPhase("idle");
      toast(on ? "success" : "info", on ? "Ambient Mode on" : "Ambient Mode off", on ? "Speak naturally — utterances are segmented at natural pauses and capped at 90 s, inside the 120 s API ceiling." : undefined);
    },
    [micReady, prepareMic, recorder, toast],
  );

  /* ───────── council ───────── */

  const runCouncil = React.useCallback(
    async (tf: Thoughtform, agents?: AgentKind[], open = true) => {
      if (open) useTwin.getState().setCouncilOpen(true);
      setCouncilRunning(true);
      setSynthesis(null);
      setSynthesizing(false);

      const fleet = agents ?? tf.compiled.suggested_agents;
      const seeded: AgentRun[] = fleet.map((a) => ({ ...newAgentRun(a, AGENT_UI[a]?.model ?? ""), status: "running" as const }));
      await useTwin.getState().setAgentRuns(tf.commit_hash, seeded);

      try {
        await convene(tf, agents, (e: CouncilEvent) => {
          if (e.type === "result") {
            void useTwin.getState().upsertAgentRun(tf.commit_hash, {
              id: `${e.agent}-result`,
              agent: e.agent,
              model: e.model,
              provider: e.provider,
              status: e.status,
              started_at: Date.now() - e.latency_ms,
              finished_at: Date.now(),
              output: e.output,
              error: e.error,
              latency_ms: e.latency_ms,
            });
          } else if (e.type === "synthesizing") {
            setSynthesizing(true);
          } else if (e.type === "synthesis") {
            setSynthesis(e.synthesis);
            setSynthesizing(false);
          } else if (e.type === "done" && e.paused) {
            toast("warn", "Council paused", "Every free model in the round-robin is rate-limited. Retry in a moment.");
          }
        });
      } catch (e) {
        toast("error", "Council failed", (e as Error).message);
      } finally {
        setCouncilRunning(false);
      }
    },
    [toast],
  );

  /* ───────── publish ───────── */

  async function doPublish(tf: Thoughtform) {
    setPublishing(true);
    try {
      const snapshot = useTwin.getState().graphAt(tf.created_at);
      const artifact: PublishedThoughtform = {
        hash: tf.commit_hash,
        thoughtform: tf,
        snapshot,
        author: profile.display_name || "Anonymous",
        published_at: Date.now(),
      };
      await store.putPublished(artifact);
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact }),
      });
      const j = (await res.json()) as { ok?: boolean; shared?: boolean; reason?: string };
      await useTwin.getState().updateThoughtform(tf.commit_hash, { published: true });
      const url = `${window.location.origin}/t/${tf.commit_hash}`;
      setPublishedUrl({ url, shared: Boolean(j.shared) });
      toast(
        "success",
        j.shared ? "Thoughtform published" : "Published locally",
        j.shared ? "The link works from any browser." : j.reason ?? "Configure SUPABASE_SERVICE_ROLE_KEY to share beyond this browser.",
      );
    } catch (e) {
      toast("error", "Publish failed", (e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  /* ───────── translate ───────── */

  async function doTranslate(target: string) {
    if (!selectedTf) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selectedTf.compiled.polished_text, target, locale_pack: profile.locale_pack }),
      });
      const j = (await res.json()) as { text?: string; error?: string };
      if (j.text) setTranslation({ target, text: j.text });
      else toast("warn", "Translation unavailable", j.error ?? "No LLM reachable.");
    } catch (e) {
      toast("error", "Translation failed", (e as Error).message);
    } finally {
      setTranslating(false);
    }
  }

  /* ───────── offline draft flush ───────── */

  async function flushDrafts() {
    const pending = await store.loadDrafts();
    if (!pending.length) return;
    toast("info", `Replaying ${pending.length} queued dictation${pending.length > 1 ? "s" : ""}…`);
    for (const d of pending) {
      try {
        const buf = await d.audio.arrayBuffer();
        const samples = new Float32Array(0);
        const capture: CaptureResult = {
          wav: d.contentType === "audio/wav" ? d.audio : new Blob([buf], { type: "audio/wav" }),
          pcm: d.contentType === "audio/pcm" ? d.audio : new Blob([buf], { type: "audio/pcm" }),
          samples,
          durationMs: d.durationMs,
          sampleRate: d.sampleRate,
          peak: 1,
          rms: 0.1,
          silent: false,
        };
        keyupAtRef.current = performance.now();
        await runPipeline(capture, "draft");
        await useTwin.getState().dropDraft(d.id);
      } catch (e) {
        console.warn("[voxembly] draft replay failed", e);
      }
    }
    await useTwin.getState().refreshDrafts();
  }

  /* ───────── global hotkeys ───────── */

  React.useEffect(() => {
    const isTyping = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space" && !e.repeat && !spaceHeld.current && !ambient) {
        e.preventDefault();
        spaceHeld.current = true;
        void onStart();
        return;
      }
      if (e.key === "Escape" && (phase === "recording" || phase === "arming")) {
        spaceHeld.current = false;
        onCancel();
        return;
      }
      if (e.key.toLowerCase() === "a" && (e.metaKey || e.ctrlKey)) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === "a") void setAmbientMode(!ambient);
        else if (e.key.toLowerCase() === "c" && selectedTf) void runCouncil(selectedTf);
        else if (e.key.toLowerCase() === "b" && selectedTf) setForkOpen(true);
        else if (e.key.toLowerCase() === "m") setMergeOpen(true);
        else if (e.key === "?") setSettingsOpen(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && spaceHeld.current) {
        e.preventDefault();
        spaceHeld.current = false;
        onStop();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [ambient, phase, onStart, onStop, onCancel, setAmbientMode, selectedTf, runCouncil]);

  /* ───────── onboarding gate ───────── */

  if (!hydrated) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Booting your Cognitive Twin…
        </div>
      </main>
    );
  }

  if (!profile.onboarded_at) {
    return <Onboarding onMicPrepare={prepareMic} />;
  }

  /* ───────── layout ───────── */

  const liveEdges = Object.values(graph.edges).filter((e) => e.valid_to === null);
  const nodes = Object.values(graph.nodes);
  const dictationOff = health?.dictation?.configured === false;
  const invalidated = Object.values(graph.edges).length - liveEdges.length;

  /**
   * The four Studio surfaces. On xl they are all on screen at once (sidebar + bento + dock).
   * Below xl they time-share: the mobile tab bar and the sidebar nav both drive `surface`.
   */
  const NAV: NavItem[] = [
    { id: "commits", label: "Commits", icon: "commits", badge: visible.length, active: surface === "commits", onSelect: () => goto("commits") },
    { id: "twin", label: "Cognitive Twin", icon: "twin", badge: nodes.length, active: surface === "twin", onSelect: () => goto("twin") },
    { id: "thoughtform", label: "Thoughtform", icon: "sparkle", active: surface === "thoughtform", onSelect: () => goto("thoughtform") },
    { id: "timeline", label: "Timeline", icon: "timeline", badge: Object.keys(branches).length, active: surface === "timeline", onSelect: () => goto("timeline") },
  ];

  /* The commits list is rendered in the sidebar on xl and as a bento card below xl — one source. */
  const commitsList = (
    <>
      {visible.length === 0 ? (
        <Empty title="No Thoughtforms yet" hint="Hold Space (or the Orb) and speak for 5–120 seconds. Your utterance returns in ~134 ms and becomes a typed commit." />
      ) : (
        <ul className="divide-y divide-border/40">
          {visible.map((tf) => (
            <li key={tf.commit_hash}>
              <button
                type="button"
                onClick={() => {
                  useTwin.getState().select(tf.commit_hash);
                  setTranslation(null);
                  if (!isDesktop) goto("thoughtform");
                }}
                aria-current={selected === tf.commit_hash ? "true" : undefined}
                className={cn(
                  "w-full px-3 py-2.5 text-left transition-colors hover:bg-secondary/50",
                  selected === tf.commit_hash && "bg-secondary/70",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Badge tone="neutral">{tf.compiled.intent}</Badge>
                  <code className="font-mono text-[10px] text-muted-foreground">{shortHash(tf.commit_hash)}</code>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {tf.trace.request_time_ms == null ? "—" : `${Math.round(tf.trace.request_time_ms)}ms`}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm font-medium">{tf.compiled.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">{tf.compiled.polished_text}</p>
                {tf.agent_runs.length > 0 && (
                  <div className="mt-1 flex gap-1" aria-label={`${tf.agent_runs.length} agent runs`}>
                    {tf.agent_runs.map((r) => (
                      <span key={r.id} className="text-[10px]" title={`${AGENT_UI[r.agent]?.name}: ${r.status}`} aria-hidden="true">
                        {AGENT_UI[r.agent]?.emoji}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const commitActions = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setForkOpen(true)} title="Fork a branch from the selected commit">
        Branch <Kbd>B</Kbd>
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMergeOpen(true)} title="Merge a branch into the current one">
        Merge <Kbd>M</Kbd>
      </Button>
    </>
  );

  /* The Prompt Composer preview — the bi-directional memory↔dictation loop, made visible. */
  const composerPreview = (
    <>
      <Hint text="Composed live from your Twin before each dictation: a ≤50-word description of the audio plus exact-spelling keyterms ranked by recency × mentions × degree. This is what makes accuracy compound.">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">next dictation context ⓘ</h3>
      </Hint>
      {composedPreview ? (
        <div className="mt-1 space-y-1">
          <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{composedPreview.config.prompt}</p>
          <div className="flex flex-wrap gap-1">
            {(composedPreview.config.keyterms_prompt ?? []).slice(0, 8).map((k) => (
              <Badge key={k} tone="violet">
                {k}
              </Badge>
            ))}
            {(composedPreview.config.keyterms_prompt?.length ?? 0) > 8 && (
              <Badge tone="neutral">+{(composedPreview.config.keyterms_prompt?.length ?? 0) - 8}</Badge>
            )}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {composedPreview.stats.prompt_words}w prompt · {composedPreview.stats.keyterms} terms / {composedPreview.stats.keyterms_chars}ch ·{" "}
            {composedPreview.stats.context_turns} ctx turns
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">Composed on key-down from your graph + recent Thoughtforms.</p>
      )}
    </>
  );

  const twinStats = (
    <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
      <span>{nodes.length} nodes</span>
      <span aria-hidden="true">·</span>
      <span>{liveEdges.length} live</span>
      <span aria-hidden="true" className="hidden sm:inline">
        ·
      </span>
      <span className="hidden sm:inline">{invalidated} invalidated</span>
    </div>
  );

  const timelinePanel = (
    <Timeline
      thoughtforms={thoughtforms}
      branches={branches}
      currentBranch={currentBranch}
      checkout={checkout}
      selected={selected}
      onCheckout={(h) => {
        const r = useTwin.getState().checkoutRef(h);
        if (r.ok) toast("success", "Time travelled", r.message);
      }}
      onSelect={(h) => {
        useTwin.getState().select(h);
        setTranslation(null);
      }}
      onReturnToHead={() => {
        useTwin.getState().returnToHead();
        toast("info", "Returned to HEAD");
      }}
      onSwitchBranch={(n) => {
        const r = useTwin.getState().switchBranch(n);
        toast(r.ok ? "success" : "warn", r.message);
      }}
    />
  );

  const thoughtformPanel = (
    <ThoughtformPanel
      tf={selectedTf}
      publishing={publishing}
      translating={translating}
      translation={translation}
      onConvene={() => selectedTf && void runCouncil(selectedTf)}
      onPublish={() => selectedTf && void doPublish(selectedTf)}
      onFork={() => setForkOpen(true)}
      onTranslate={(t) => void doTranslate(t)}
    />
  );

  /**
   * The Orb dock. Docked in the content column on xl; on smaller screens it floats just above the
   * mobile tab bar so Push-to-Think stays one thumb away regardless of which surface is showing.
   */
  const orbDock = (
    <div className="flex items-end justify-center gap-4 sm:gap-6">
      <div className="hidden w-28 lg:block xl:w-32">{peaks.length > 0 && <Waveform peaks={peaks} tone={phase === "recording" ? "cyan" : "violet"} />}</div>
      <Orb
        phase={phase}
        level={level}
        elapsedMs={elapsed}
        confidence={selectedTf?.confidence ?? null}
        ambient={ambient}
        disabled={dictationOff}
        onStart={() => void onStart()}
        onStop={onStop}
        onCancel={onCancel}
      />
      <div className="hidden w-28 text-right text-[10px] leading-relaxed text-muted-foreground lg:block xl:w-32">
        <p>
          hold <Kbd>Space</Kbd> or the Orb
        </p>
        <p>
          <Kbd>Esc</Kbd> cancels
        </p>
        <p>
          <Kbd>A</Kbd> ambient · <Kbd>C</Kbd> council
        </p>
      </div>
    </div>
  );

  const sidebarBody = (
    <Sidebar
      collapsed={railCollapsed}
      onToggleCollapsed={() => setRailCollapsed((v) => !v)}
      nav={NAV}
      inDrawer={!isDesktop}
      onClose={() => setNavOpen(false)}
      header={
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Commits <span className="font-mono normal-case">({visible.length})</span>
          </h2>
          <div className="flex gap-1">{commitActions}</div>
        </div>
      }
      footer={composerPreview}
    >
      {commitsList}
    </Sidebar>
  );

  /** Which bento cards a given surface shows below xl. On xl everything is visible at once. */
  const show = (id: SurfaceId) => isDesktop || surface === id;

  return (
    <>
      <div className="grid-bg flex h-dvh flex-col overflow-hidden">
        {/* ───── topbar ───── */}
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-2 sm:gap-3 sm:px-4">
          {!isDesktop && (
            <Button variant="ghost" size="icon" onClick={() => setNavOpen(true)} aria-label="Open navigation" aria-expanded={navOpen}>
              <Icon name="menu" />
            </Button>
          )}

          <div className="flex min-w-0 items-center gap-2">
            <span
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-vox-cyan to-vox-violet text-xs font-black text-background"
              aria-hidden="true"
            >
              V
            </span>
            <div className="min-w-0 leading-none">
              <h1 className="truncate text-sm font-bold tracking-tight">VOXEMBLY</h1>
              <p className="hidden truncate text-[10px] text-muted-foreground sm:block">Voice is the new compiler.</p>
            </div>
          </div>

          <div className="ml-1 hidden items-center gap-1.5 lg:flex">
            <Badge tone="cyan">universal-3-5-pro</Badge>
            <Badge tone={online ? "emerald" : "rose"}>{online ? "online" : "offline"}</Badge>
            {drafts.length > 0 && <Badge tone="amber">{drafts.length} queued</Badge>}
            {ambient && <Badge tone="violet">ambient</Badge>}
            {checkout && <Badge tone="amber">detached</Badge>}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
            {/* The Latency Dial is the stealth flex — keep it on screen from md up. */}
            <div className="hidden md:block">
              <LatencyDial
                requestTimeMs={lastTrace?.request_time_ms ?? null}
                proxyMs={lastTrace?.proxy ?? null}
                clientMs={lastTrace?.client ?? null}
                warmed={lastTrace?.warmed ?? false}
                region={lastTrace?.region ?? profile.region}
              />
            </div>
            {/* Below md the dial collapses to just the number so it never crowds the controls. */}
            <span className="font-mono text-[11px] text-vox-cyan md:hidden" title="AssemblyAI request_time_ms">
              {lastTrace?.request_time_ms == null ? "—" : `${Math.round(lastTrace.request_time_ms)}ms`}
            </span>

            <Button
              size="sm"
              variant={ambient ? "primary" : "outline"}
              onClick={() => void setAmbientMode(!ambient)}
              aria-pressed={ambient}
              className="hidden sm:inline-flex"
            >
              Ambient <Kbd>A</Kbd>
            </Button>
            <Button
              size="icon"
              variant={ambient ? "primary" : "ghost"}
              onClick={() => void setAmbientMode(!ambient)}
              aria-pressed={ambient}
              aria-label="Toggle ambient mode"
              className="sm:hidden"
            >
              <Icon name="wave" />
            </Button>

            <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings, keyboard shortcuts and memory benchmark">
              <Icon name="settings" />
            </Button>
          </div>
        </header>

        {/* degraded banner */}
        {(dictationOff || micError) && (
          <div role="alert" className="shrink-0 border-b border-vox-amber/40 bg-vox-amber/10 px-3 py-1.5 text-[11px] text-vox-amber sm:px-4">
            {dictationOff && (
              <>
                <strong>ASSEMBLYAI_API_KEY is not configured.</strong> Add it to <code className="font-mono">.env.local</code> and restart — dictation is the
                core loop and nothing transcribes without it.
              </>
            )}
            {!dictationOff && micError && <>Microphone unavailable: {micError}</>}
          </div>
        )}

        {/* ───── sidebar + content ───── */}
        <div className="flex min-h-0 flex-1">
          {/* xl: persistent rail/sidebar. below xl: the same component inside a modal drawer. */}
          {isDesktop && <div className="hidden shrink-0 xl:block">{sidebarBody}</div>}

          <div className="flex min-w-0 flex-1 flex-col">
            <main id="main" className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
              <Bento className="min-h-full auto-rows-min xl:h-full xl:auto-rows-auto">
                {/* Commits — a bento card only below xl, where the sidebar isn't holding it. */}
                {!isDesktop && surface === "commits" && (
                  <BentoCard
                    span={12}
                    title={
                      <>
                        Commits <span className="font-mono normal-case">({visible.length})</span>
                      </>
                    }
                    actions={commitActions}
                    padded={false}
                    scroll
                    className="min-h-[46vh]"
                    footer={composerPreview}
                  >
                    {commitsList}
                  </BentoCard>
                )}

                {/* Cognitive Twin canvas */}
                {show("twin") && (
                  <BentoCard
                    span={8}
                    title="Cognitive Twin"
                    subtitle="temporal knowledge graph · click a node to focus"
                    actions={twinStats}
                    padded={false}
                    className="min-h-[46vh] xl:min-h-0"
                    bodyClassName="relative"
                  >
                    <TwinCanvas
                      nodes={nodes}
                      edges={Object.values(graph.edges)}
                      highlight={highlight}
                      reduceMotion={profile.reduce_motion}
                      selectedNode={selectedNode}
                      onSelectNode={setSelectedNode}
                    />
                  </BentoCard>
                )}

                {/* Selected Thoughtform */}
                {show("thoughtform") && (
                  <BentoCard
                    span={4}
                    title="Thoughtform"
                    subtitle={selectedTf ? shortHash(selectedTf.commit_hash) : "nothing selected"}
                    padded={false}
                    scroll
                    className="min-h-[46vh] xl:min-h-0"
                  >
                    {thoughtformPanel}
                  </BentoCard>
                )}

                {/* Timeline — a full-width card on its own surface below xl; docked on xl. */}
                {!isDesktop && surface === "timeline" && (
                  <BentoCard span={12} title="Timeline" subtitle="commits · branches · time travel" padded={false} className="min-h-[46vh]">
                    {timelinePanel}
                  </BentoCard>
                )}

                {/* Orb dock — inline on xl so it sits under the canvas. */}
                {isDesktop && (
                  <BentoCard span={12} className="shrink-0" bodyClassName="py-3">
                    {orbDock}
                  </BentoCard>
                )}
              </Bento>
            </main>

            {/* xl: the timeline is a collapsible dock so it never steals canvas height. */}
            {isDesktop && (
              <Dock
                open={timelineOpen}
                onToggle={() => setTimelineOpen((v) => !v)}
                label="Timeline"
                summary={
                  <>
                    {thoughtforms.length} commits · {Object.keys(branches).length} branches · on{" "}
                    <code className="font-mono text-vox-cyan">{currentBranch}</code>
                    {checkout && <> · detached at {shortHash(checkout)}</>}
                  </>
                }
              >
                {timelinePanel}
              </Dock>
            )}
          </div>
        </div>

        {/* ───── mobile: floating orb + tab bar ───── */}
        {!isDesktop && (
          <>
            <div className="pointer-events-none fixed inset-x-0 bottom-[58px] z-30 flex justify-center pb-2" style={{ marginBottom: "env(safe-area-inset-bottom)" }}>
              <div className="pointer-events-auto rounded-full border border-border/60 bg-card/85 px-4 py-2 shadow-2xl backdrop-blur-md">{orbDock}</div>
            </div>
            <MobileTabBar
              value={surface}
              onChange={(id) => goto(id as SurfaceId)}
              items={[
                { id: "commits", label: "Commits", icon: "commits", badge: visible.length },
                { id: "twin", label: "Twin", icon: "twin", badge: nodes.length },
                { id: "thoughtform", label: "Thought", icon: "sparkle" },
                { id: "timeline", label: "Timeline", icon: "timeline" },
              ]}
            />
          </>
        )}
      </div>

      {/* drawer sidebar (below xl) */}
      <Drawer open={navOpen && !isDesktop} onClose={() => setNavOpen(false)} label="Studio navigation">
        {sidebarBody}
      </Drawer>

      {/* ───── modals ───── */}
      <CouncilModal
        open={councilOpen}
        onClose={() => useTwin.getState().setCouncilOpen(false)}
        thoughtform={selectedTf}
        runs={selectedTf?.agent_runs ?? []}
        synthesis={synthesis}
        synthesizing={synthesizing}
        running={councilRunning}
        onConvene={(agents) => selectedTf && void runCouncil(selectedTf, agents)}
        onAcceptSynthesis={(text) => {
          if (!selectedTf) return;
          void useTwin.getState().updateThoughtform(selectedTf.commit_hash, {
            compiled: { ...selectedTf.compiled, polished_text: text },
          });
          toast("success", "Council consensus accepted", "The commit's polished text now reflects the debate.");
        }}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} usePCM={usePCM} onUsePCM={setUsePCM} health={health} />

      {/* Fork */}
      <Modal
        open={forkOpen}
        onClose={() => setForkOpen(false)}
        title="Branch this thought"
        description="Fork the selected commit into parallel lines of thinking. Later dictations mutate only the branch you're on."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForkOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const names = forkNames.split(",").map((s) => s.trim()).filter(Boolean);
                const r = await useTwin.getState().fork(names, selected);
                toast(r.ok ? "success" : "warn", r.message);
                setForkOpen(false);
              }}
            >
              Create branches
            </Button>
          </div>
        }
      >
        <label htmlFor="fork-names" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Branch names (comma-separated)
        </label>
        <input
          id="fork-names"
          value={forkNames}
          onChange={(e) => setForkNames(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm"
          placeholder="Plan A, Plan B"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Forking from{" "}
          <code className="font-mono text-vox-cyan">{selected ? shortHash(selected) : branches[currentBranch]?.head ? shortHash(branches[currentBranch].head!) : "genesis"}</code>. You can
          also just say <em>“branch this into Plan A and Plan B”</em>.
        </p>
      </Modal>

      {/* Merge */}
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge a branch"
        description={`Replay another branch's commits onto ${currentBranch} as a merge commit with two parents.`}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!mergeFrom}
              onClick={async () => {
                const r = await useTwin.getState().merge(mergeFrom, currentBranch);
                toast(r.ok ? "success" : "warn", r.ok ? "Merged" : "Could not merge", r.message);
                setMergeOpen(false);
              }}
            >
              Merge into {currentBranch}
            </Button>
          </div>
        }
      >
        <label htmlFor="merge-from" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source branch
        </label>
        <select
          id="merge-from"
          value={mergeFrom}
          onChange={(e) => setMergeFrom(e.target.value)}
          className="mt-1.5 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm"
        >
          <option value="">Select a branch…</option>
          {Object.keys(branches)
            .filter((b) => b !== currentBranch)
            .map((b) => (
              <option key={b} value={b}>
                {b} ({branches[b].head ? shortHash(branches[b].head!) : "empty"})
              </option>
            ))}
        </select>
      </Modal>

      {/* Published link */}
      <Modal
        open={Boolean(publishedUrl)}
        onClose={() => setPublishedUrl(null)}
        title="Thoughtform published"
        description={publishedUrl?.shared ? "This link renders for anyone." : "Saved locally — this link renders in this browser only until Supabase is configured."}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPublishedUrl(null)}>
              Close
            </Button>
            {publishedUrl && (
              <Link href={`/t/${publishedUrl.url.split("/t/")[1]}`} target="_blank" rel="noopener noreferrer">
                <Button variant="primary">Open artifact</Button>
              </Link>
            )}
          </div>
        }
      >
        <code className="block break-all rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-xs">{publishedUrl?.url}</code>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            if (publishedUrl) void navigator.clipboard?.writeText(publishedUrl.url);
            toast("success", "Link copied");
          }}
        >
          Copy link
        </Button>
      </Modal>

      <Toasts />
    </>
  );
}
