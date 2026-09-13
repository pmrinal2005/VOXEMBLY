"use client";

/**
 * The Timeline (§3.7.6) — a git-style ref graph of the Thoughtform commit DAG.
 *
 * Each commit is a node on its branch's lane; parent pointers draw the edges, merge commits draw two.
 * Clicking a commit time-travels (`checkout`), which rebuilds the Twin graph from that commit's
 * ancestry only. The slider is the same operation over a continuous time axis.
 *
 * Keyboard: the lane is a listbox — ←/→ walk commits, Home/End jump to genesis/HEAD, Enter checks out.
 */

import * as React from "react";
import type { Branch, Thoughtform } from "@/lib/types";
import { cn, formatDateTime, shortHash, timeAgo } from "@/lib/utils";
import { Badge, Button } from "@/components/ui";

const INTENT_TONE: Record<string, string> = {
  note: "#94a3b8",
  task: "#34d399",
  decision: "#fb7185",
  question: "#22d3ee",
  idea: "#fbbf24",
  meeting: "#60a5fa",
  emotion: "#f472b6",
  command: "#c084fc",
  memory: "#f59e0b",
};

export function Timeline({
  thoughtforms,
  branches,
  currentBranch,
  checkout,
  selected,
  onCheckout,
  onSelect,
  onReturnToHead,
  onSwitchBranch,
}: {
  thoughtforms: Thoughtform[];
  branches: Record<string, Branch>;
  currentBranch: string;
  checkout: string | null;
  selected: string | null;
  onCheckout: (hash: string) => void;
  onSelect: (hash: string) => void;
  onReturnToHead: () => void;
  onSwitchBranch: (name: string) => void;
}) {
  const sorted = React.useMemo(() => [...thoughtforms].sort((a, b) => a.created_at - b.created_at), [thoughtforms]);
  const lanes = React.useMemo(() => {
    const names = [...new Set([currentBranch, ...Object.keys(branches)])];
    return names.filter((n) => branches[n]);
  }, [branches, currentBranch]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [sliderIdx, setSliderIdx] = React.useState<number>(sorted.length - 1);

  React.useEffect(() => {
    setSliderIdx(sorted.length - 1);
  }, [sorted.length]);

  // Keep the newest commit in view as they arrive.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el && !checkout) el.scrollLeft = el.scrollWidth;
  }, [sorted.length, checkout]);

  if (!sorted.length) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-xs text-muted-foreground">
          No commits yet — your first dictation becomes commit <code className="font-mono">#0000000</code> on <code className="font-mono">main</code>.
        </p>
      </div>
    );
  }

  const onKeyNav = (e: React.KeyboardEvent) => {
    const idx = sorted.findIndex((t) => t.commit_hash === (selected ?? checkout));
    let next = idx;
    if (e.key === "ArrowRight") next = Math.min(sorted.length - 1, idx + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = sorted.length - 1;
    else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      onCheckout(sorted[idx].commit_hash);
      return;
    } else return;
    e.preventDefault();
    if (sorted[next]) onSelect(sorted[next].commit_hash);
  };

  return (
    <div className="flex h-full flex-col gap-1.5 px-3 py-2">
      {/* Branch refs + time-travel status */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">refs</span>
        {lanes.map((name) => {
          const b = branches[name];
          const active = name === currentBranch;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSwitchBranch(name)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                active ? "border-transparent text-background" : "border-border text-muted-foreground hover:text-foreground",
              )}
              style={active ? { background: b.color } : undefined}
              title={`${name} → ${b.head ? shortHash(b.head) : "empty"}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "hsl(var(--background))" : b.color }} aria-hidden="true" />
              {name}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {checkout ? (
            <>
              <Badge tone="amber">detached @ {shortHash(checkout)}</Badge>
              <Button size="sm" variant="outline" onClick={onReturnToHead}>
                Return to HEAD
              </Button>
            </>
          ) : (
            <Badge tone="emerald">live @ HEAD</Badge>
          )}
        </div>
      </div>

      {/* Commit lane */}
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Thoughtform commit timeline. Arrow keys to browse, Enter to time-travel to a commit."
        tabIndex={0}
        onKeyDown={onKeyNav}
        className="scrollbar-thin flex-1 overflow-x-auto overflow-y-hidden rounded-lg border border-border/60 bg-background/40"
      >
        <div className="relative flex h-full min-w-full items-center gap-0 px-3" style={{ minWidth: sorted.length * 54 + 24 }}>
          {/* lane rail */}
          <div className="pointer-events-none absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-border/70" aria-hidden="true" />

          {sorted.map((tf, i) => {
            const isHead = branches[tf.branch]?.head === tf.commit_hash;
            const isCheckout = checkout === tf.commit_hash;
            const isSelected = selected === tf.commit_hash;
            const isMerge = tf.parent_hashes.length > 1;
            const color = branches[tf.branch]?.color ?? "#22d3ee";
            const intentColor = INTENT_TONE[tf.compiled.intent] ?? "#94a3b8";

            return (
              <div key={tf.commit_hash} className="relative flex h-full w-[54px] shrink-0 flex-col items-center justify-center">
                {/* parent connector */}
                {i > 0 && (
                  <span
                    className="pointer-events-none absolute left-0 top-1/2 h-[2px] w-[54px] -translate-x-1/2 -translate-y-1/2"
                    style={{ background: isMerge ? `linear-gradient(90deg, ${color}, #fbbf24)` : `${color}66` }}
                    aria-hidden="true"
                  />
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(tf.commit_hash)}
                  onDoubleClick={() => onCheckout(tf.commit_hash)}
                  title={`${shortHash(tf.commit_hash)} · ${tf.compiled.intent} · ${tf.compiled.title}\n${formatDateTime(tf.created_at)}\nDouble-click to time-travel here`}
                  className={cn(
                    "relative z-10 grid place-items-center rounded-full border-2 transition-transform hover:scale-125",
                    isSelected ? "scale-125" : "",
                  )}
                  style={{
                    height: isMerge ? 18 : 14,
                    width: isMerge ? 18 : 14,
                    background: intentColor,
                    borderColor: isCheckout ? "#fbbf24" : isHead ? "#e2e8f0" : color,
                    boxShadow: isSelected ? `0 0 0 4px ${color}33` : undefined,
                  }}
                >
                  {isMerge && (
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="hsl(var(--background))" strokeWidth="3.5" aria-hidden="true">
                      <path d="M6 3v12a6 6 0 0 0 6 6h6" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
                <span className="absolute bottom-1 font-mono text-[9px] text-muted-foreground">{shortHash(tf.commit_hash).slice(0, 4)}</span>
                {isHead && !checkout && (
                  <span className="absolute top-1 text-[8px] font-bold uppercase tracking-wide text-foreground/80" aria-hidden="true">
                    head
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Continuous time-travel slider */}
      <div className="flex items-center gap-2">
        <label htmlFor="tl-slider" className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          time travel
        </label>
        <input
          id="tl-slider"
          type="range"
          min={0}
          max={Math.max(0, sorted.length - 1)}
          value={sliderIdx}
          onChange={(e) => {
            const i = Number(e.target.value);
            setSliderIdx(i);
            const tf = sorted[i];
            if (!tf) return;
            if (i === sorted.length - 1) onReturnToHead();
            else onCheckout(tf.commit_hash);
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          aria-valuetext={sorted[sliderIdx] ? `${formatDateTime(sorted[sliderIdx].created_at)} — ${sorted[sliderIdx].compiled.title}` : undefined}
        />
        <span className="w-28 shrink-0 truncate text-right font-mono text-[10px] text-muted-foreground">
          {sorted[sliderIdx] ? timeAgo(sorted[sliderIdx].created_at) : "—"}
        </span>
      </div>
    </div>
  );
}
