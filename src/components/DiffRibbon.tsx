"use client";

import { AnimatePresence, motion } from "framer-motion";

// Animates the raw → polished transformation. Words removed in the polished
// pass fade/strike out; the polished chips slide in.
export default function DiffRibbon({
  raw,
  polished,
}: {
  raw: string;
  polished: string;
}) {
  const rawWords = raw.split(/\s+/).filter(Boolean);
  const polishedSet = new Set(
    polished
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\w]/g, ""))
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <AnimatePresence>
          {rawWords.map((w, i) => {
            const norm = w.toLowerCase().replace(/[^\w]/g, "");
            const kept = polishedSet.has(norm);
            return (
              <motion.span
                key={`${w}-${i}`}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: kept ? 1 : 0.35, y: 0 }}
                transition={{ delay: i * 0.015 }}
                className={
                  "rounded px-1 py-0.5 text-[12px] " +
                  (kept
                    ? "bg-vox-teal/10 text-ink"
                    : "text-ink-faint line-through decoration-vox-pink/60")
                }
              >
                {w}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="text-sm leading-relaxed text-ink"
      >
        {polished}
      </motion.p>
    </div>
  );
}
