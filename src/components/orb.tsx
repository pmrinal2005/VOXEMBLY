"use client";

/**
 * The Orb — the single always-visible Push-to-Think control (§3.7.1).
 *
 * Hold to dictate. The ring radius encodes live mic level while recording, and the returned
 * AssemblyAI `confidence` once the transcript lands. Fully operable by pointer, keyboard
 * (hold Space / Enter) and touch (long-press), with an aria-live status region so screen-reader
 * users get the same feedback sighted users get from the animation.
 */

import * as React from "react";
import { cn, formatMs } from "@/lib/utils";

export type OrbPhase = "idle" | "arming" | "recording" | "transcribing" | "compiling" | "done" | "error";

const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: "Hold to think",
  arming: "Warming…",
  recording: "Listening…",
  transcribing: "Transcribing…",
  compiling: "Compiling…",
  done: "Committed",
  error: "Retry",
};

const PHASE_TONE: Record<OrbPhase, string> = {
  idle: "from-vox-cyan/70 to-vox-violet/60",
  arming: "from-vox-amber/70 to-vox-cyan/60",
  recording: "from-vox-cyan to-vox-violet",
  transcribing: "from-vox-violet to-vox-cyan/70",
  compiling: "from-vox-amber to-vox-violet/70",
  done: "from-vox-emerald to-vox-cyan/70",
  error: "from-vox-rose to-vox-amber/70",
};

export function Orb({
  phase,
  level,
  elapsedMs,
  confidence,
  ambient,
  disabled,
  onStart,
  onStop,
  onCancel,
}: {
  phase: OrbPhase;
  level: number;
  elapsedMs: number;
  confidence: number | null;
  ambient: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel?: () => void;
}) {
  const held = React.useRef(false);
  const busy = phase === "transcribing" || phase === "compiling";
  const recording = phase === "recording" || phase === "arming";

  // Ring radius: mic level while speaking, API confidence after the round-trip.
  const ring = recording ? 8 + level * 26 : phase === "done" && confidence != null ? 6 + confidence * 18 : 0;

  const down = React.useCallback(() => {
    if (disabled || busy || ambient || held.current) return;
    held.current = true;
    onStart();
  }, [disabled, busy, ambient, onStart]);

  const up = React.useCallback(() => {
    if (!held.current) return;
    held.current = false;
    onStop();
  }, [onStop]);

  // Keyboard parity: Space/Enter behave exactly like holding the orb.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      down();
    } else if (e.key === "Escape" && recording) {
      e.preventDefault();
      held.current = false;
      onCancel?.();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      up();
    }
  };

  // A pointer released outside the orb must still end the utterance.
  React.useEffect(() => {
    const onWindowUp = () => up();
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowUp);
    return () => {
      window.removeEventListener("pointerup", onWindowUp);
      window.removeEventListener("pointercancel", onWindowUp);
    };
  }, [up]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex h-[104px] w-[104px] items-center justify-center">
        {/* Confidence / level ring */}
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute rounded-full border-2 transition-all duration-100",
            recording ? "border-vox-cyan/60" : phase === "done" ? "border-vox-emerald/60" : "border-transparent",
          )}
          style={{ height: 72 + ring * 2, width: 72 + ring * 2 }}
        />
        {ambient && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-[92px] w-[92px] animate-orb-pulse rounded-full border border-vox-violet/50"
          />
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label={
            ambient
              ? "Ambient Mode is listening continuously. Turn off Ambient Mode to use push-to-think."
              : "Push to Think — hold to dictate a Thoughtform. Press and hold Space or Enter, release to commit, Escape to cancel."
          }
          aria-pressed={recording}
          onPointerDown={(e) => {
            e.preventDefault();
            down();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          className={cn(
            "relative grid h-[72px] w-[72px] place-items-center rounded-full bg-gradient-to-br text-primary-foreground transition-transform",
            "shadow-[0_8px_40px_-8px_rgba(34,211,238,0.6)] disabled:opacity-40",
            PHASE_TONE[phase],
            recording ? "scale-95" : "hover:scale-105",
            !recording && !busy && !ambient && "animate-orb-pulse",
          )}
        >
          {busy ? (
            <svg viewBox="0 0 24 24" className="h-7 w-7 animate-spin" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
              <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 1 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z" />
              <path d="M18.5 11.5a.9.9 0 0 0-1.8 0 4.7 4.7 0 0 1-9.4 0 .9.9 0 0 0-1.8 0 6.5 6.5 0 0 0 5.6 6.4V20H9.7a.9.9 0 0 0 0 1.8h4.6a.9.9 0 0 0 0-1.8h-1.4v-2.1a6.5 6.5 0 0 0 5.6-6.4Z" />
            </svg>
          )}
        </button>
      </div>

      <div className="text-center">
        <div className="font-mono text-xs font-semibold text-foreground">{PHASE_LABEL[phase]}</div>
        <div className="h-4 font-mono text-[11px] text-muted-foreground">
          {recording ? formatMs(elapsedMs) : phase === "idle" && !ambient ? "hold space" : ambient ? "ambient on" : ""}
        </div>
      </div>

      {/* Screen readers get the same state changes the animation conveys. */}
      <span aria-live="assertive" aria-atomic="true" className="sr-only-focusable absolute">
        {PHASE_LABEL[phase]}
      </span>
    </div>
  );
}

/** Waveform strip rendered under the Orb while recording (and on published artifacts). */
export function Waveform({ peaks, className, tone = "cyan" }: { peaks: number[]; className?: string; tone?: "cyan" | "violet" }) {
  const color = tone === "cyan" ? "bg-vox-cyan/70" : "bg-vox-violet/70";
  return (
    <div className={cn("flex h-8 items-center gap-[2px]", className)} aria-hidden="true">
      {peaks.map((p, i) => (
        <span key={i} className={cn("w-[3px] shrink-0 rounded-full transition-all", color)} style={{ height: `${Math.max(6, p * 100)}%` }} />
      ))}
    </div>
  );
}
