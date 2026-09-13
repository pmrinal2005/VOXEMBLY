"use client";

/**
 * The Orb — VOXEMBLY's single, always-visible Push-to-Think control.
 *
 * Press-and-hold (pointer or Space) to dictate; release to commit. The confidence ring radius encodes
 * the last returned `confidence` from the Dictation API, the pulse encodes the live input `level`, and
 * the phase label narrates the pipeline (arming → recording → transcribing → compiling → done).
 *
 * Fully keyboard- and screen-reader-operable: it's a real <button> with aria-pressed / aria-label and
 * an aria-live status line, so the hands-free grammar and switch-access users get parity.
 */

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Mic, Square, X } from "lucide-react";
import { cn, formatMs } from "@/lib/utils";
import { LIMITS } from "@/lib/dictation/client";

/** The seven Studio phases the Orb narrates. */
export type OrbPhase = "idle" | "arming" | "recording" | "transcribing" | "compiling" | "done" | "error";

const PHASE_LABEL: Record<OrbPhase, string> = {
  idle: "Hold to think",
  arming: "Arming…",
  recording: "Listening…",
  transcribing: "Transcribing…",
  compiling: "Compiling…",
  done: "Committed",
  error: "Try again",
};

const BUSY: OrbPhase[] = ["transcribing", "compiling"];

export interface OrbProps {
  phase: OrbPhase;
  /** live input level 0..1 */
  level: number;
  /** elapsed recording time in ms */
  elapsedMs: number;
  /** last returned confidence 0..1 (drives the ring), or null */
  confidence: number | null;
  ambient: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}

export function Orb({ phase, level, elapsedMs, confidence, ambient, disabled, onStart, onStop, onCancel }: OrbProps) {
  const recording = phase === "recording" || phase === "arming";
  const busy = BUSY.includes(phase);
  const near = LIMITS.maxDurationMs - elapsedMs < 15_000 && recording;

  // Confidence ring: base radius grows a little with returned confidence.
  const ringScale = 1 + (confidence ? confidence * 0.32 : 0);
  // Live level nudges the core scale while recording.
  const coreScale = recording ? 1 + Math.min(0.18, level * 0.4) : 1;

  const handleDown = (e: React.PointerEvent) => {
    if (disabled || ambient || busy) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onStart();
  };
  const handleUp = (e: React.PointerEvent) => {
    if (disabled || ambient) return;
    e.preventDefault();
    if (recording) onStop();
  };

  return (
    <div className="flex select-none flex-col items-center justify-center gap-2">
      <div className="relative grid place-items-center">
        {/* pulse rings while recording */}
        {recording && !disabled && (
          <>
            <span className="pointer-events-none absolute h-24 w-24 rounded-full border border-vox-teal/40 animate-pulse-ring" aria-hidden="true" />
            <span
              className="pointer-events-none absolute h-24 w-24 rounded-full border border-vox-purple/40 animate-pulse-ring [animation-delay:0.6s]"
              aria-hidden="true"
            />
          </>
        )}

        {/* confidence ring */}
        <motion.span
          className="pointer-events-none absolute rounded-full border border-vox-teal/50"
          style={{ height: 92, width: 92 }}
          animate={{ scale: busy ? [1, 1.08, 1] : ringScale, opacity: confidence ? 0.85 : 0.25 }}
          transition={busy ? { repeat: Infinity, duration: 1.1 } : { type: "spring", stiffness: 120, damping: 14 }}
          aria-hidden="true"
        />

        <button
          type="button"
          disabled={disabled}
          aria-label={ambient ? "Ambient mode is on — utterances are captured automatically" : "Hold to dictate a Thoughtform"}
          aria-pressed={recording}
          onPointerDown={handleDown}
          onPointerUp={handleUp}
          onPointerLeave={(e) => {
            if (recording) handleUp(e);
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "relative grid h-20 w-20 place-items-center rounded-full outline-none transition-shadow",
            "focus-visible:ring-2 focus-visible:ring-vox-teal/70 focus-visible:ring-offset-2 focus-visible:ring-offset-base-900",
            disabled && "cursor-not-allowed opacity-40",
          )}
        >
          <span className="orb-glow absolute inset-0 rounded-full blur-md" aria-hidden="true" />
          <motion.span
            className={cn(
              "relative grid h-16 w-16 place-items-center rounded-full shadow-glow",
              ambient
                ? "bg-gradient-to-br from-vox-purple to-vox-pink"
                : "bg-gradient-to-br from-vox-purple/90 to-vox-teal/85",
            )}
            animate={{ scale: recording ? coreScale : busy ? [1, 1.05, 1] : 1 }}
            transition={busy ? { repeat: Infinity, duration: 1 } : { type: "spring", stiffness: 260, damping: 18 }}
          >
            {busy ? (
              <Loader2 className="h-6 w-6 animate-spin text-base-950" strokeWidth={2.4} />
            ) : recording ? (
              <Square className="h-5 w-5 text-base-950" strokeWidth={2.6} />
            ) : (
              <Mic className="h-6 w-6 text-base-950" strokeWidth={2.4} />
            )}
          </motion.span>
        </button>

        {/* cancel affordance while recording */}
        {recording && !disabled && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel dictation"
            className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-line bg-base-800 text-ink-muted transition-colors hover:text-vox-pink"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="text-center leading-tight" role="status" aria-live="polite">
        <p className={cn("text-xs font-medium", phase === "error" ? "text-vox-pink" : "text-ink")}>
          {ambient ? "Ambient on" : PHASE_LABEL[phase]}
        </p>
        {recording ? (
          <p className={cn("font-mono text-[10px]", near ? "text-vox-amber" : "text-ink-muted")}>{formatMs(elapsedMs)} / 120s</p>
        ) : (
          <p className="text-[10px] text-ink-muted">
            {confidence != null && phase === "done" ? `${Math.round(confidence * 100)}% confident` : "hold Space"}
          </p>
        )}
      </div>
    </div>
  );
}

export interface WaveformProps {
  peaks: number[];
  tone?: "cyan" | "violet";
  className?: string;
}

/** A lightweight bar waveform of recent input levels / captured samples. */
export function Waveform({ peaks, tone = "cyan", className }: WaveformProps) {
  const color = tone === "violet" ? "bg-vox-purple/70" : "bg-vox-teal/70";
  const bars = peaks.length ? peaks : new Array(24).fill(0);
  return (
    <div className={cn("flex h-10 items-center gap-[2px]", className)} aria-hidden="true">
      {bars.slice(-48).map((p, i) => (
        <span
          key={i}
          className={cn("w-[2px] shrink-0 rounded-full transition-[height] duration-75", color)}
          style={{ height: `${Math.max(6, Math.min(100, p * 100))}%` }}
        />
      ))}
    </div>
  );
}

export default Orb;
