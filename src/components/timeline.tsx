"use client";

// Git-style ref graph across the bottom + a time-travel slider.

import { useMemo } from "react";
import { useCognitive } from "@/store/cognitive-store";
import { cn, relativeTime } from "@/lib/utils";
import { GitBranch } from "lucide-react";

export default function Timeline() {
  const { state, focusHash, setFocus, checkout, timeTravel, setTimeTravel } =
    useCognitive();

  const commits = useMemo(
    () => state.order.map((h) => state.thoughtforms[h]).filter(Boolean),
    [state.order, state.thoughtforms]
  );

  const times = commits.map((c) => c.created_at);
  const minT = Math.min(...times, Date.now() - 3600_000);
  const maxT = Math.max(...times, Date.now());
  const span = Math.max(1, maxT - minT);

  const sliderVal = timeTravel ?? maxT;
  const branchNames = state.branches.map((b) => b.name);

  return (
    <section className="panel px-3 py-2.5 sm:px-4" aria-label="Timeline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-ink-muted" />
          <span className="label-caps">Timeline</span>
          <span className="text-[11px] text-ink-muted">
            {commits.length} commits · {state.branches.length} branches · on{" "}
            <span className="text-vox-teal">{state.currentBranch}</span>
          </span>
        </div>
        <span
          className={cn(
            "pill text-[10px]",
            timeTravel ? "border-vox-amber/50 text-vox-amber" : "border-vox-green/40 text-vox-green"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              timeTravel ? "bg-vox-amber" : "bg-vox-green"
            )}
          />
          {timeTravel ? "time-travelling" : "live @ HEAD"}
        </span>
      </div>

      {/* Branch pill selectors */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="label-caps mr-1">Refs</span>
        {state.branches.map((b) => (
          <button
            key={b.name}
            onClick={() => checkout(b.name)}
            className={cn(
              "pill transition",
              state.currentBranch === b.name
                ? "border-transparent text-base-950"
                : "text-ink-muted hover:text-ink"
            )}
            style={
              state.currentBranch === b.name
                ? { backgroundColor: b.color }
                : { borderColor: `${b.color}66` }
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
            {b.name}
          </button>
        ))}
      </div>

      {/* Commit track */}
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="relative flex min-w-[420px] items-center gap-0">
          <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-line" />
          {commits.map((c) => {
            const branch = state.branches.find((b) => b.name === c.branch);
            const isHead = state.branches.some((b) => b.head === c.commit_hash);
            const isFocus = focusHash === c.commit_hash;
            return (
              <button
                key={c.commit_hash}
                onClick={() => setFocus(c.commit_hash)}
                className="group relative z-10 flex flex-1 flex-col items-center gap-1 px-1"
                title={c.title}
              >
                {isHead && (
                  <span className="mono text-[9px] text-ink-faint">HEAD</span>
                )}
                <span
                  className={cn(
                    "grid h-3.5 w-3.5 place-items-center rounded-full border-2 transition",
                    isFocus ? "scale-125" : "group-hover:scale-110"
                  )}
                  style={{
                    borderColor: branch?.color ?? "#00CBD6",
                    backgroundColor: isFocus ? branch?.color ?? "#00CBD6" : "#0B0F19",
                  }}
                />
                <span className="mono text-[9px] text-ink-muted">
                  {c.commit_hash.slice(0, 4)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time-travel slider */}
      <div className="mt-2 flex items-center gap-3">
        <span className="label-caps whitespace-nowrap">Time travel</span>
        <input
          type="range"
          min={minT}
          max={maxT}
          value={sliderVal}
          step={span / 200}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTimeTravel(v >= maxT ? null : v);
          }}
          aria-label="Time travel through commit history"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-line accent-vox-teal
            [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-vox-teal
            [&::-webkit-slider-thumb]:shadow-glow"
        />
        <span className="mono whitespace-nowrap text-[10px] text-ink-muted">
          {timeTravel ? relativeTime(sliderVal) : "now"}
        </span>
      </div>
      <span className="sr-only">{branchNames.join(", ")}</span>
    </section>
  );
}
