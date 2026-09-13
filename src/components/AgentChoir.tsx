"use client";

import { motion } from "framer-motion";
import {
  Search,
  Wrench,
  ShieldAlert,
  History,
  CalendarClock,
  HeartPulse,
} from "lucide-react";
import type { AgentName, AgentRun } from "@/lib/types";

const AGENT_ICON: Record<AgentName, React.ReactNode> = {
  Researcher: <Search className="h-3.5 w-3.5" />,
  Executor: <Wrench className="h-3.5 w-3.5" />,
  "Devil's Advocate": <ShieldAlert className="h-3.5 w-3.5" />,
  Historian: <History className="h-3.5 w-3.5" />,
  Scheduler: <CalendarClock className="h-3.5 w-3.5" />,
  "Emotion Curator": <HeartPulse className="h-3.5 w-3.5" />,
};

const AGENT_ACCENT: Record<AgentName, string> = {
  Researcher: "#60A5FA",
  Executor: "#34D399",
  "Devil's Advocate": "#EC4899",
  Historian: "#A78BFA",
  Scheduler: "#F59E0B",
  "Emotion Curator": "#FB7185",
};

export default function AgentChoir({ runs }: { runs: AgentRun[] }) {
  if (!runs.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {runs.map((r, i) => {
        const accent = AGENT_ACCENT[r.agent] ?? "#00CBD6";
        return (
          <motion.div
            key={`${r.agent}-${i}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="rounded-xl border border-line bg-base-800/60 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="grid h-6 w-6 place-items-center rounded-md"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {AGENT_ICON[r.agent]}
              </span>
              <span className="text-[12px] font-semibold text-ink">{r.agent}</span>
              <span className="mono ml-auto truncate text-[9px] text-ink-faint" title={r.model}>
                {r.model}
              </span>
            </div>
            {r.status === "running" ? (
              <div className="mt-2 flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:0.3s]" />
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">{r.output}</p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
