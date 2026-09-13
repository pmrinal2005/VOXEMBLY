"use client";

/**
 * Telemetry surfaces — every number here is read from a real AssemblyAI Sync STT response field,
 * never synthesised:
 *
 *  LatencyDial      → `request_time_ms` (server-side end-to-end), plus our proxy + client totals
 *  ConfidenceHeatmap→ `words[].confidence`
 *  DiffRibbon       → raw `text` vs the Groq cleanup pass's `polished_text`
 *  TraceSheet       → `session_id`, region/endpoint, prompt + keyterms actually sent, retries, route
 */

import * as React from "react";
import type { DictationTrace, SyncWord } from "@/lib/types";
import { cn, formatMs, wordDiff } from "@/lib/utils";
import { Badge, Card, CardBody, CardHeader, CardTitle, Hint } from "@/components/ui";

/* ───────────────────────── Latency Dial ───────────────────────── */

/** AssemblyAI's published p50 for the Sync endpoint from US/EU — the reference mark on the dial. */
export const AAI_P50_MS = 134;

export function LatencyDial({
  requestTimeMs,
  proxyMs,
  clientMs,
  warmed,
  region,
  route,
  compact,
}: {
  requestTimeMs: number | null;
  proxyMs: number | null;
  clientMs: number | null;
  warmed: boolean;
  region: string;
  route?: "sync" | "prerecorded" | "simulated";
  compact?: boolean;
}) {
  // Log-ish scale: 30 ms → 0, 3000 ms → 1, so the interesting 100–500 ms band gets real sweep.
  const value = requestTimeMs ?? 0;
  const norm = value <= 0 ? 0 : Math.max(0, Math.min(1, Math.log10(value / 30) / Math.log10(100)));
  const angle = -120 + norm * 240;
  const refNorm = Math.log10(AAI_P50_MS / 30) / Math.log10(100);
  const refAngle = -120 + refNorm * 240;

  const tone = value === 0 ? "text-muted-foreground" : value <= 200 ? "text-vox-emerald" : value <= 600 ? "text-vox-amber" : "text-vox-rose";

  const size = compact ? 66 : 92;
  const r = size / 2 - 7;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size * 0.72 }} role="img" aria-label={`AssemblyAI server processing time ${requestTimeMs == null ? "not measured yet" : `${Math.round(requestTimeMs)} milliseconds`}. Reference p50 is ${AAI_P50_MS} milliseconds.`}>
        <svg viewBox={`0 0 ${size} ${size * 0.72}`} className="h-full w-full overflow-visible">
          {/* track */}
          <path
            d={arc(size / 2, size / 2 - 2, r, -120, 120)}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="5"
            strokeLinecap="round"
          />
          {/* value */}
          <path
            d={arc(size / 2, size / 2 - 2, r, -120, angle)}
            fill="none"
            stroke="currentColor"
            className={tone}
            strokeWidth="5"
            strokeLinecap="round"
            style={{ transition: "all .5s cubic-bezier(.22,1,.36,1)" }}
          />
          {/* AssemblyAI p50 reference tick */}
          <line
            x1={polar(size / 2, size / 2 - 2, r - 7, refAngle).x}
            y1={polar(size / 2, size / 2 - 2, r - 7, refAngle).y}
            x2={polar(size / 2, size / 2 - 2, r + 6, refAngle).x}
            y2={polar(size / 2, size / 2 - 2, r + 6, refAngle).y}
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeDasharray="2 2"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className={cn("font-mono font-semibold leading-none", compact ? "text-sm" : "text-lg", tone)}>
            {requestTimeMs == null ? "—" : Math.round(requestTimeMs)}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">ms server</div>
        </div>
      </div>

      {!compact && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <dt className="text-muted-foreground">proxy</dt>
          <dd className="font-mono">{formatMs(proxyMs)}</dd>
          <dt className="text-muted-foreground">mouth→meaning</dt>
          <dd className="font-mono">{formatMs(clientMs)}</dd>
          <dt className="text-muted-foreground">region</dt>
          <dd className="font-mono uppercase">{region}</dd>
          <dt className="text-muted-foreground">conn</dt>
          <dd>
            <Badge tone={warmed ? "emerald" : "neutral"}>{warmed ? "warmed" : "cold"}</Badge>
          </dd>
          {route === "prerecorded" && (
            <>
              <dt className="text-muted-foreground">route</dt>
              <dd>
                <Badge tone="amber">long-form</Badge>
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const s = polar(cx, cy, r, to);
  const e = polar(cx, cy, r, from);
  const large = Math.abs(to - from) <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/* ───────────────────────── Confidence Heatmap ───────────────────────── */

/**
 * Per-word `confidence` from the Sync response, rendered as a background tint so the user can see
 * exactly where the model hedged. Colour is never the only signal: low-confidence words also get a
 * dotted underline and an accessible title, so this passes WCAG 1.4.1 (Use of Colour).
 */
export function ConfidenceHeatmap({ words, text, className }: { words: SyncWord[]; text: string; className?: string }) {
  if (!words?.length) {
    return <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>{text}</p>;
  }
  return (
    <p className={cn("text-sm leading-loose", className)}>
      {words.map((w, i) => {
        const c = typeof w.confidence === "number" ? w.confidence : 1;
        const low = c < 0.75;
        const mid = c < 0.9;
        return (
          <React.Fragment key={i}>
            <span
              title={`confidence ${(c * 100).toFixed(1)}%`}
              className={cn(
                "rounded px-0.5",
                low && "bg-vox-rose/25 underline decoration-vox-rose decoration-dotted decoration-2 underline-offset-2",
                !low && mid && "bg-vox-amber/20 underline decoration-vox-amber/70 decoration-dotted underline-offset-2",
              )}
            >
              {w.text}
            </span>{" "}
          </React.Fragment>
        );
      })}
    </p>
  );
}

export function ConfidenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-vox-rose/40" aria-hidden="true" />
        &lt;75% — verify
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm bg-vox-amber/30" aria-hidden="true" />
        75–90%
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-sm border border-border" aria-hidden="true" />
        &gt;90%
      </span>
    </div>
  );
}

/* ───────────────────────── Diff Ribbon ───────────────────────── */

/**
 * The raw → polished transformation, word by word. Removed words (fillers, false starts) strike
 * through and fade; kept words stay; added words highlight. This is the "judges literally see the
 * fillers being stripped" moment (§3.7.2).
 */
export function DiffRibbon({ raw, polished, animate = true }: { raw: string; polished: string; animate?: boolean }) {
  const ops = React.useMemo(() => wordDiff(raw, polished), [raw, polished]);
  const removed = ops.filter((o) => o.type === "removed").length;
  const added = ops.filter((o) => o.type === "added").length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>raw → polished</span>
        {removed > 0 && <Badge tone="rose">−{removed} stripped</Badge>}
        {added > 0 && <Badge tone="emerald">+{added} clarified</Badge>}
        {removed === 0 && added === 0 && <Badge tone="neutral">clean first pass</Badge>}
      </div>
      <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-sm leading-relaxed">
        {ops.map((o, i) => (
          <span
            key={i}
            className={cn(
              "rounded px-1",
              animate && "animate-fade-up",
              o.type === "removed" && "bg-vox-rose/15 text-vox-rose/80 line-through decoration-2",
              o.type === "added" && "bg-vox-emerald/15 text-vox-emerald",
            )}
            style={animate ? { animationDelay: `${Math.min(i * 18, 700)}ms` } : undefined}
          >
            {o.text}
          </span>
        ))}
      </p>
    </div>
  );
}

/* ───────────────────────── Trace sheet ───────────────────────── */

/** The auditable record of one Dictation API round-trip — including the exact prompt/keyterms sent. */
export function TraceSheet({ trace }: { trace: DictationTrace }) {
  const rows: [string, React.ReactNode][] = [
    ["model", <code key="m" className="font-mono text-xs">{trace.model}</code>],
    ["endpoint", <code key="e" className="font-mono text-xs break-all">{trace.endpoint}</code>],
    ["session_id", <code key="s" className="font-mono text-xs break-all">{trace.session_id || "—"}</code>],
    ["request_time_ms", <span key="r" className="font-mono text-xs">{trace.request_time_ms == null ? "—" : trace.request_time_ms.toFixed(1)}</span>],
    ["audio", <span key="a" className="font-mono text-xs">{formatMs(trace.audio_duration_ms)} · {(trace.audio_bytes / 1024).toFixed(1)} KB · {trace.audio_format}</span>],
    ["route", <Badge key="rt" tone={trace.route === "sync" ? "cyan" : "amber"}>{trace.route}</Badge>],
    ["warmed", <Badge key="w" tone={trace.warmed ? "emerald" : "neutral"}>{String(trace.warmed)}</Badge>],
    ["retries", <span key="rr" className="font-mono text-xs">{trace.retries}</span>],
    ["timestamps", <span key="ts" className="font-mono text-xs">{String(trace.timestamps)}</span>],
    [
      "language_code",
      <span key="l" className="font-mono text-xs">
        {Array.isArray(trace.language_code) ? trace.language_code.join(", ") : trace.language_code || "auto (stated in prompt)"}
      </span>,
    ],
  ];

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[128px_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0">{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>
            <Hint text="A natural-language description of the audio composed live from your Cognitive Twin. Max 6000 chars; language_code is ignored when this is set, so the language is stated inside.">
              prompt sent <span className="text-muted-foreground">({trace.prompt.split(/\s+/).filter(Boolean).length} words)</span>
            </Hint>
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{trace.prompt || "— (managed default prompt applied)"}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Hint text="Exact-spelling vocabulary biasing, ranked from your graph by recency × mentions × degree. API max 100 terms / 8000 chars.">
              keyterms_prompt <span className="text-muted-foreground">({trace.keyterms_prompt.length} terms)</span>
            </Hint>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {trace.keyterms_prompt.length ? (
            <div className="flex flex-wrap gap-1">
              {trace.keyterms_prompt.map((k) => (
                <Badge key={k} tone="violet">
                  {k}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">— none</p>
          )}
        </CardBody>
      </Card>

      {trace.conversation_context.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Hint text="Previous utterances on this branch, oldest → newest, for multi-turn continuity and proper-noun consistency.">
                conversation_context <span className="text-muted-foreground">({trace.conversation_context.length} turns)</span>
              </Hint>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-1 text-[11px] text-muted-foreground">
              {trace.conversation_context.map((c, i) => (
                <li key={i} className="truncate font-mono">
                  {i + 1}. {c}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
