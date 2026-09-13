"use client";

import type { WordConfidence } from "@/lib/types";

// Per-word confidence rendered as subtle background tint (red = uncertain).
export default function ConfidenceHeatmap({
  words,
  className,
}: {
  words: { text: string; confidence: number }[] | WordConfidence[];
  className?: string;
}) {
  return (
    <p className={className} aria-live="polite">
      {words.map((w, i) => {
        const conf = w.confidence;
        // High conf → transparent; low conf → amber/red tint.
        let bg = "transparent";
        if (conf < 0.7) bg = "rgba(236,72,153,0.22)";
        else if (conf < 0.85) bg = "rgba(245,158,11,0.18)";
        else if (conf < 0.93) bg = "rgba(245,158,11,0.08)";
        return (
          <span
            key={i}
            className="conf-word"
            style={{ backgroundColor: bg }}
            title={`${Math.round(conf * 100)}% confidence`}
          >
            {w.text}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </p>
  );
}
