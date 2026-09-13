"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitCommit,
  BrainCircuit,
  Sparkles,
  Clock,
  ChevronLeft,
  GitBranch,
  GitMerge,
} from "lucide-react";
import { useCognitive } from "@/store/cognitive-store";
import { cn, relativeTime, INTENT_COLORS } from "@/lib/utils";

type Nav = "commits" | "twin" | "thoughtform" | "timeline";

const INTENT_DOT: Record<string, string> = INTENT_COLORS;

export default function Sidebar({
  collapsed,
  onToggle,
  active,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  active: Nav;
  onNavigate: (n: Nav) => void;
}) {
  const { state, focusHash, setFocus, forkFromFocus, mergeInto } = useCognitive();

  const commits = useMemo(
    () =>
      [...state.order]
        .map((h) => state.thoughtforms[h])
        .filter(Boolean)
        .reverse()
        .slice(0, 12),
    [state.order, state.thoughtforms]
  );

  const nav: { key: Nav; label: string; icon: React.ReactNode; count: number }[] = [
    { key: "commits", label: "Commits", icon: <GitCommit className="h-4 w-4" />, count: state.order.length },
    { key: "twin", label: "Cognitive Twin", icon: <BrainCircuit className="h-4 w-4" />, count: state.nodes.filter((n) => n.valid_to === null).length },
    { key: "thoughtform", label: "Thoughtform", icon: <Sparkles className="h-4 w-4" />, count: 0 },
    { key: "timeline", label: "Timeline", icon: <Clock className="h-4 w-4" />, count: state.branches.length },
  ];

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 288 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="relative z-20 hidden h-full shrink-0 flex-col border-r border-line bg-base-900/90 md:flex"
      aria-label="Primary navigation"
    >
      {/* Brand row */}
      <div className="flex h-14 items-center gap-2 border-b border-line px-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-vox-purple to-vox-teal text-base-950">
          <BrainCircuit className="h-4 w-4" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">VOXEMBLY</p>
            <p className="truncate text-[10px] text-ink-muted">Voice is the new compiler.</p>
          </div>
        )}
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-ink-muted hover:bg-line/50 hover:text-ink"
        >
          <ChevronLeft className={cn("h-4 w-4 transition", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 p-2">
        {nav.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition",
              active === item.key
                ? "bg-vox-teal/12 text-vox-teal"
                : "text-ink-muted hover:bg-line/40 hover:text-ink"
            )}
            title={item.label}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.count > 0 && (
                  <span className="mono rounded bg-base-800 px-1.5 py-0.5 text-[10px] text-ink-muted">
                    {item.count}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {/* Branch / merge quick actions */}
      {!collapsed && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            onClick={() => forkFromFocus(`branch-${Math.random().toString(36).slice(2, 6)}`)}
            className="btn-outline flex-1 gap-1 px-2 py-1 text-xs"
          >
            <GitBranch className="h-3.5 w-3.5" /> Branch
          </button>
          <button
            onClick={() => {
              const others = state.branches.filter((b) => b.name !== state.currentBranch);
              if (others[0]) mergeInto(others[0].name, state.currentBranch);
            }}
            className="btn-outline flex-1 gap-1 px-2 py-1 text-xs"
          >
            <GitMerge className="h-3.5 w-3.5" /> Merge
          </button>
        </div>
      )}

      {/* Commits feed */}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-2 py-2">
          <p className="label-caps px-1 pb-1">Commits ({state.order.length})</p>
          <AnimatePresence initial={false}>
            {commits.map((c) => (
              <motion.button
                key={c.commit_hash}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => {
                  setFocus(c.commit_hash);
                  onNavigate("thoughtform");
                }}
                className={cn(
                  "mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition",
                  focusHash === c.commit_hash
                    ? "border-vox-teal/40 bg-vox-teal/5"
                    : "border-transparent hover:border-line hover:bg-line/30"
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: INTENT_DOT[c.intent] ?? "#94A3B8" }}
                  />
                  <span className="pill border-line px-1.5 py-0 text-[9px] uppercase text-ink-muted">
                    {c.intent}
                  </span>
                  <span className="mono ml-auto text-[9px] text-ink-faint">
                    {c.commit_hash.slice(0, 6)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[12px] font-medium text-ink">{c.title}</p>
                <p className="truncate text-[11px] text-ink-muted">{c.polished_text}</p>
                <p className="mt-0.5 text-[9px] text-ink-faint">{relativeTime(c.created_at)}</p>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.aside>
  );
}
