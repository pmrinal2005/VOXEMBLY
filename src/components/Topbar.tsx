"use client";

import { Menu, Settings, Radio, Wifi } from "lucide-react";
import LatencyDial from "./LatencyDial";
import { cn } from "@/lib/utils";

export default function Topbar({
  latencyMs,
  ambient,
  onToggleAmbient,
  onOpenMobileNav,
  onOpenSettings,
  region = "GLOBAL",
  conn = "cold",
}: {
  latencyMs: number;
  ambient: boolean;
  onToggleAmbient: () => void;
  onOpenMobileNav: () => void;
  onOpenSettings: () => void;
  region?: string;
  conn?: string;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-base-900/95 px-3 backdrop-blur sm:px-4">
      {/* Mobile nav toggle */}
      <button
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-line/50 hover:text-ink md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Brand + model badges */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold tracking-tight">VOXEMBLY</span>
        <span className="pill hidden border-vox-teal/40 text-vox-teal sm:inline-flex">
          universal-3-5-pro
        </span>
        <span className="pill hidden border-vox-green/40 text-vox-green xs:inline-flex sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-vox-green" />
          online
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        {/* Server metrics (hidden on small) */}
        <div className="hidden items-center gap-4 lg:flex">
          <LatencyDial ms={latencyMs} size={48} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] leading-tight text-ink-muted">
            <dt className="text-ink-faint">region</dt>
            <dd className="text-right font-mono text-ink">{region}</dd>
            <dt className="text-ink-faint">conn</dt>
            <dd className={cn("text-right font-mono", conn === "cold" ? "text-vox-amber" : "text-vox-green")}>
              {conn}
            </dd>
          </dl>
        </div>

        {/* Ambient toggle */}
        <button
          onClick={onToggleAmbient}
          className={cn(
            "btn gap-1.5 border px-2.5 py-1.5 text-xs",
            ambient
              ? "border-vox-teal/50 bg-vox-teal/10 text-vox-teal"
              : "border-line text-ink-muted hover:text-ink"
          )}
          aria-pressed={ambient}
          title="Toggle Ambient Mode (A)"
        >
          {ambient ? <Radio className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
          Ambient
          <kbd className="ml-1 hidden rounded bg-base-800 px-1 text-[9px] sm:inline">A</kbd>
        </button>

        <button
          onClick={onOpenSettings}
          aria-label="Settings"
          className="grid h-8 w-8 place-items-center rounded-md text-ink-muted hover:bg-line/50 hover:text-ink"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
