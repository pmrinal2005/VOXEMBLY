"use client";

/**
 * Toast rail — every one is an `aria-live` announcement, so command results ("Checked out 3f1a2b —
 * last Tuesday"), degraded-mode notices and errors reach screen-reader users too. This matters
 * because VOXEMBLY is meant to be operable entirely hands-free.
 */

import * as React from "react";
import { useTwin } from "@/lib/store/twin";
import { cn } from "@/lib/utils";

const TONE = {
  info: "border-border bg-card",
  success: "border-vox-emerald/50 bg-vox-emerald/10",
  warn: "border-vox-amber/50 bg-vox-amber/10",
  error: "border-vox-rose/50 bg-vox-rose/10",
};

const ICON = {
  info: "M12 8h.01M12 11v5",
  success: "M20 6 9 17l-5-5",
  warn: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  error: "M18 6 6 18M6 6l12 12",
};

export function Toasts() {
  const toasts = useTwin((s) => s.toasts);
  const dismiss = useTwin((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live={t.kind === "error" ? "assertive" : "polite"}
          className={cn("pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-xl backdrop-blur-md animate-fade-up", TONE[t.kind])}
        >
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d={ICON[t.kind]} />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-snug">{t.text}</p>
            {t.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t.detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
