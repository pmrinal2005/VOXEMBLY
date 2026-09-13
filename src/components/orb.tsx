"use client";

import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import type { DictationPhase } from "@/hooks/use-dictation";

const PHASE_LABEL: Record<DictationPhase, string> = {
  idle: "Hold to think",
  warming: "Warming…",
  recording: "Listening…",
  transcribing: "Transcribing…",
  cleaning: "Polishing…",
  committing: "Committing…",
  council: "Council convening…",
  done: "Hold to think",
  error: "Try again",
};

export default function Orb({
  phase,
  confidence,
  onPointerDown,
  onPointerUp,
}: {
  phase: DictationPhase;
  confidence: number;
  onPointerDown: () => void;
  onPointerUp: () => void;
}) {
  const active = phase === "recording" || phase === "warming";
  const busy =
    phase === "transcribing" ||
    phase === "cleaning" ||
    phase === "committing" ||
    phase === "council";
  // Confidence ring radius encodes returned confidence.
  const ringScale = 1 + (confidence ? confidence * 0.35 : 0);

  return (
    <div className="flex flex-col items-center justify-center gap-4 select-none">
      <button
        type="button"
        aria-label="Hold to dictate a Thoughtform"
        aria-pressed={active}
        onPointerDown={(e) => {
          e.preventDefault();
          onPointerDown();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          onPointerUp();
        }}
        onPointerLeave={() => {
          if (active) onPointerUp();
        }}
        className="relative grid h-28 w-28 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-vox-teal/60 md:h-32 md:w-32"
      >
        {/* Outer glow */}
        <div className="orb-glow absolute inset-0 rounded-full blur-md" />
        {/* Pulse rings when active */}
        {active && (
          <>
            <span className="absolute inset-2 rounded-full border border-vox-teal/40 animate-pulse-ring" />
            <span className="absolute inset-2 rounded-full border border-vox-purple/40 animate-pulse-ring [animation-delay:0.5s]" />
          </>
        )}
        {/* Confidence ring */}
        <motion.span
          className="absolute rounded-full border border-vox-teal/50"
          style={{ inset: 8 }}
          animate={{ scale: busy ? [1, 1.08, 1] : ringScale, opacity: confidence ? 0.9 : 0.3 }}
          transition={busy ? { repeat: Infinity, duration: 1.1 } : { type: "spring" }}
        />
        <motion.span
          className="relative grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-vox-purple/90 to-vox-teal/80 shadow-glow md:h-24 md:w-24"
          animate={{ scale: active ? [1, 1.05, 1] : 1 }}
          transition={active ? { repeat: Infinity, duration: 1 } : {}}
        >
          <Mic className="h-7 w-7 text-base-950 md:h-8 md:w-8" strokeWidth={2.2} />
        </motion.span>
      </button>

      <div className="text-center">
        <p className="text-sm font-medium text-ink">{PHASE_LABEL[phase]}</p>
        <p className="text-[11px] text-ink-muted">hold space</p>
      </div>
    </div>
  );
}
