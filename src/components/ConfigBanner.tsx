"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

// Surfaces the "ASSEMBLYAI_API_KEY is not configured" warning from /api/health.
export default function ConfigBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        const m: string[] = [];
        if (!d.config?.assemblyai) m.push("ASSEMBLYAI_API_KEY");
        if (!d.config?.groq) m.push("GROQ_API_KEY");
        setMissing(m);
      })
      .catch(() => setMissing([]));
  }, []);

  if (dismissed || missing.length === 0) return null;

  const primary = missing.includes("ASSEMBLYAI_API_KEY");

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-vox-amber/25 bg-vox-amber/10 px-4 py-1.5 text-[11.5px] text-vox-amber"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-mono font-semibold">{missing.join(", ")}</span>{" "}
        {missing.length > 1 ? "are" : "is"} not configured.{" "}
        {primary
          ? "Add it to .env.local and restart — dictation is the core loop. VOXEMBLY runs in demo mode until then."
          : "Add it to enable the Agent Council. Running with offline fallbacks."}
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 hover:bg-vox-amber/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
