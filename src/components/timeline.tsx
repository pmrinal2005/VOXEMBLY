"use client";

import type { Branch, Thoughtform } from "@/lib/types";
import { cn, relativeTime, shortHash } from "@/lib/utils";
import { Badge } from "@/components/ui";

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
  const ordered = [...thoughtforms].sort((a, b) => a.created_at - b.created_at);
  const times = ordered.map((c) => c.created_at);
  const minT = Math.min(...times, Date.now() - 3600_000);
  const maxT = Math.max(...times, Date.now());
  const span = Math.max(1, maxT - minT);
  const names = Object.keys(branches);

  return (
    <div className="flex h-full min-h-[180px] flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onSwitchBranch(n)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-mono text-[10px]",
              n === currentBranch
                ? "border-vox-cyan bg-vox-cyan/15 text-vox-cyan"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
            style={{ borderColor: branches[n]?.color }}
          >
            {n}
            {branches[n]?.head ? ` @${shortHash(branches[n].head!)}` : ""}
          </button>
        ))}
        {checkout && (
          <button type="button" onClick={onReturnToHead} className="text-[11px] text-vox-amber underline">
            return to HEAD
          </button>
        )}
      </div>

      <div className="relative min-h-[72px] flex-1 overflow-x-auto">
        <div className="relative h-16 min-w-full" style={{ minWidth: Math.max(640, ordered.length * 56) }}>
          <div className="absolute left-2 right-2 top-7 h-px bg-border" />
          {ordered.map((tf) => {
            const x = ((tf.created_at - minT) / span) * 100;
            const active = selected === tf.commit_hash || checkout === tf.commit_hash;
            const color = branches[tf.branch]?.color || "#22d3ee";
            return (
              <button
                key={tf.commit_hash}
                type="button"
                title={`${shortHash(tf.commit_hash)} · ${tf.compiled.title}`}
                onClick={() => {
                  onSelect(tf.commit_hash);
                  onCheckout(tf.commit_hash);
                }}
                className="absolute top-3 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${x}%` }}
              >
                <span
                  className={cn(
                    "h-3 w-3 rounded-full border-2",
                    active ? "scale-125" : "",
                  )}
                  style={{ background: color, borderColor: active ? "#fff" : color }}
                />
                <span className="mt-2 max-w-[72px] truncate font-mono text-[9px] text-muted-foreground">
                  {shortHash(tf.commit_hash)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {ordered.slice(-8).reverse().map((tf) => (
          <button
            key={tf.commit_hash}
            type="button"
            onClick={() => onSelect(tf.commit_hash)}
            className={cn(
              "rounded-lg border px-2 py-1 text-left",
              selected === tf.commit_hash ? "border-vox-cyan bg-vox-cyan/10" : "border-border",
            )}
          >
            <div className="flex items-center gap-1.5">
              <Badge tone="neutral">{tf.compiled.intent}</Badge>
              <code className="font-mono text-[10px] text-muted-foreground">{shortHash(tf.commit_hash)}</code>
              <span className="text-[10px] text-muted-foreground">{relativeTime(tf.created_at)}</span>
            </div>
            <p className="mt-0.5 max-w-[220px] truncate text-[11px]">{tf.compiled.title}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
