"use client";

/**
 * The published Thoughtform artifact renderer (Flow H, §3.7.8).
 *
 * Renders the full cognitive commit as a public, typeset document: intent, polished text, the
 * raw→polished Diff Ribbon, the Confidence Heatmap (per-word `confidence` from the Sync response),
 * entities, proposed actions, the agent debate, the graph snapshot as it existed at commit time, and
 * the auditable AssemblyAI trace — including the exact `prompt` and `keyterms_prompt` that were sent.
 *
 * `LocalArtifactFallback` covers the $0 path: when Supabase is not configured the artifact lives only
 * in the author's IndexedDB, so we read it client-side and say honestly that the link is local-only.
 */

import * as React from "react";
import Link from "next/link";
import type { PublishedThoughtform } from "@/lib/types";
import { NODE_COLORS } from "@/lib/twin/graph";
import * as store from "@/lib/store/db";
import { cn, formatDateTime, formatMs, shortHash, timeAgo } from "@/lib/utils";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, Spinner, Stat } from "@/components/ui";
import { ConfidenceHeatmap, ConfidenceLegend, DiffRibbon, LatencyDial, TraceSheet } from "@/components/telemetry";
import { AGENT_UI } from "@/components/council";

const INTENT_TONE: Record<string, "neutral" | "cyan" | "violet" | "amber" | "rose" | "emerald"> = {
  note: "neutral",
  task: "emerald",
  decision: "rose",
  question: "cyan",
  idea: "amber",
  meeting: "cyan",
  emotion: "rose",
  command: "violet",
  memory: "amber",
};

export function Artifact({ artifact, shared }: { artifact: PublishedThoughtform; shared: boolean }) {
  const tf = artifact.thoughtform;
  const c = tf.compiled;
  const snapshot = artifact.snapshot ?? { nodes: [], edges: [], at: tf.created_at, branch: tf.branch };
  const liveEdges = (snapshot.edges ?? []).filter((e) => e.valid_to === null);
  const doneRuns = (tf.agent_runs ?? []).filter((r) => r.status === "done" && r.output);

  return (
    <article className="mt-8">
      {/* ─────────── title block ─────────── */}
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={INTENT_TONE[c.intent] ?? "neutral"}>{c.intent}</Badge>
          <code className="font-mono text-xs text-vox-cyan">{shortHash(tf.commit_hash)}</code>
          <Badge tone="neutral">branch {tf.branch}</Badge>
          {tf.merged_from?.length ? <Badge tone="violet">merge</Badge> : null}
          {!shared && <Badge tone="amber">local only</Badge>}
        </div>

        <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-balance sm:text-4xl">{c.title}</h1>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            by <strong className="font-semibold text-foreground">{artifact.author || "Anonymous"}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(tf.created_at).toISOString()} title={formatDateTime(tf.created_at)}>
            {timeAgo(tf.created_at)}
          </time>
          <span aria-hidden="true">·</span>
          <span>
            compiled from a {formatMs(tf.trace.audio_duration_ms)} dictation in{" "}
            <strong className="font-mono text-vox-cyan">{tf.trace.request_time_ms == null ? "—" : `${Math.round(tf.trace.request_time_ms)} ms`}</strong>
          </span>
        </p>
      </header>

      {/* ─────────── the polished thought ─────────── */}
      <section aria-label="Polished Thoughtform" className="mt-8">
        <blockquote className="rounded-2xl border border-primary/25 bg-primary/[0.06] px-5 py-4 sm:px-6 sm:py-5">
          <p className="text-base leading-relaxed sm:text-lg">{c.polished_text}</p>
        </blockquote>
      </section>

      {/* ─────────── telemetry bento ─────────── */}
      <section aria-label="Dictation telemetry" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="sm:col-span-2">
          <CardBody className="flex items-center gap-4">
            <LatencyDial
              requestTimeMs={tf.trace.request_time_ms}
              proxyMs={tf.trace.proxy_roundtrip_ms}
              clientMs={tf.trace.client_roundtrip_ms}
              warmed={tf.trace.warmed}
              region={tf.trace.region}
              route={tf.trace.route}
              compact
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat
              label="Confidence"
              value={`${(tf.confidence * 100).toFixed(1)}%`}
              tone={tf.confidence >= 0.9 ? "emerald" : tf.confidence >= 0.75 ? "amber" : "rose"}
              sub={`${tf.words?.length ?? 0} words scored`}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Stat label="Graph at commit" value={`${snapshot.nodes?.length ?? 0} nodes`} sub={`${liveEdges.length} live edges`} />
          </CardBody>
        </Card>
      </section>

      {/* ─────────── raw → polished ─────────── */}
      {tf.raw_text && tf.raw_text !== c.polished_text && (
        <section aria-label="Raw to polished transformation" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>What was said → what was meant</CardTitle>
              <Badge tone="cyan">universal-3-5-pro</Badge>
            </CardHeader>
            <CardBody>
              <DiffRibbon raw={tf.raw_text} polished={c.polished_text} animate={false} />
            </CardBody>
          </Card>
        </section>
      )}

      {/* ─────────── verbatim transcript + heatmap ─────────── */}
      {tf.words?.length > 0 && (
        <section aria-label="Verbatim transcript with per-word confidence" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Verbatim transcript</CardTitle>
              <ConfidenceLegend />
            </CardHeader>
            <CardBody>
              <ConfidenceHeatmap words={tf.words} text={tf.raw_text} />
            </CardBody>
          </Card>
        </section>
      )}

      {/* ─────────── entities + actions ─────────── */}
      {(c.entities?.length > 0 || c.actions?.length > 0) && (
        <section aria-label="Extracted entities and actions" className="mt-6 grid gap-3 lg:grid-cols-2">
          {c.entities?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Entities</CardTitle>
                <span className="font-mono text-[10px] text-muted-foreground">{c.entities.length}</span>
              </CardHeader>
              <CardBody>
                <ul className="flex flex-wrap gap-1.5">
                  {c.entities.map((e) => (
                    <li key={`${e.type}:${e.name}`}>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                        style={{ borderColor: `${NODE_COLORS[e.type] ?? "#94a3b8"}55`, color: NODE_COLORS[e.type] ?? "#94a3b8" }}
                        title={e.description}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: NODE_COLORS[e.type] ?? "#94a3b8" }} aria-hidden="true" />
                        {e.name}
                        <span className="text-muted-foreground/70">{e.type}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {c.actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Proposed actions</CardTitle>
                <span className="font-mono text-[10px] text-muted-foreground">{c.actions.length}</span>
              </CardHeader>
              <CardBody>
                <ul className="space-y-2">
                  {c.actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <Badge tone="neutral">{a.kind}</Badge>
                      <span className="min-w-0">
                        <span className="block font-medium">{a.title}</span>
                        {a.when && <time className="block font-mono text-[10px] text-muted-foreground">{a.when}</time>}
                        {a.target && <span className="block text-[10px] text-muted-foreground">→ {a.target}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </section>
      )}

      {/* ─────────── agent council ─────────── */}
      {doneRuns.length > 0 && (
        <section aria-label="Agent Council debate" className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">The Council debated this</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {doneRuns.map((r) => {
              const ui = AGENT_UI[r.agent];
              return (
                <Card key={r.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span aria-hidden="true">{ui?.emoji}</span>
                      {ui?.name ?? r.agent}
                    </CardTitle>
                    <code className="font-mono text-[10px] text-muted-foreground">{r.model}</code>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    {r.output?.headline && <p className="text-sm font-medium">{r.output.headline}</p>}
                    {r.output?.bullets?.length ? (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {r.output.bullets.slice(0, 5).map((b, i) => (
                          <li key={i}>• {b}</li>
                        ))}
                      </ul>
                    ) : null}

                    {r.output?.risk_register?.length ? (
                      <ul className="space-y-1 border-t border-border/40 pt-2 text-xs">
                        {r.output.risk_register.slice(0, 3).map((x, i) => (
                          <li key={i}>
                            <Badge tone={x.severity === "high" ? "rose" : x.severity === "med" ? "amber" : "neutral"}>{x.severity}</Badge>{" "}
                            <span className="text-muted-foreground">{x.risk}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {r.output?.citations?.length ? (
                      <ul className="space-y-1 border-t border-border/40 pt-2 text-xs">
                        {r.output.citations.slice(0, 4).map((cit, i) => (
                          <li key={i} className="truncate">
                            <a href={cit.url} target="_blank" rel="noopener noreferrer nofollow" className="text-vox-cyan underline-offset-2 hover:underline">
                              {cit.title || cit.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {r.output?.schedule?.length ? (
                      <ul className="space-y-1 border-t border-border/40 pt-2 font-mono text-[10px] text-muted-foreground">
                        {r.output.schedule.slice(0, 3).map((s, i) => (
                          <li key={i}>
                            {s.human} — {s.title}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {r.latency_ms != null && <p className="font-mono text-[10px] text-muted-foreground">{formatMs(r.latency_ms)}</p>}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ─────────── graph snapshot ─────────── */}
      {snapshot.nodes?.length > 0 && (
        <section aria-label="Cognitive Twin snapshot at commit time" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Cognitive Twin at this commit</CardTitle>
              <span className="font-mono text-[10px] text-muted-foreground">
                {snapshot.nodes.length} nodes · {liveEdges.length} live edges
              </span>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-wrap gap-1.5">
                {snapshot.nodes
                  .slice()
                  .sort((a, b) => b.mentions - a.mentions)
                  .slice(0, 48)
                  .map((n) => (
                    <li key={n.id}>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{ borderColor: `${NODE_COLORS[n.type] ?? "#94a3b8"}44`, color: NODE_COLORS[n.type] ?? "#94a3b8" }}
                        title={`${n.type}${n.description ? ` — ${n.description}` : ""} · ${n.mentions} mention${n.mentions === 1 ? "" : "s"}`}
                      >
                        {n.label}
                        {n.mentions > 1 && <span className="font-mono text-[9px] text-muted-foreground">×{n.mentions}</span>}
                      </span>
                    </li>
                  ))}
                {snapshot.nodes.length > 48 && <li className="self-center text-[11px] text-muted-foreground">+{snapshot.nodes.length - 48} more</li>}
              </ul>
            </CardBody>
          </Card>
        </section>
      )}

      {/* ─────────── the trace ─────────── */}
      <section aria-label="AssemblyAI request trace" className="mt-6">
        <details className="group rounded-xl border border-border bg-card/60">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:hidden">
            <span className="flex items-center justify-between gap-3">
              How this was transcribed
              <span className="font-mono text-[10px] font-normal text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true">
                ▾
              </span>
            </span>
            <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
              The exact prompt, keyterms and response metadata for this one dictation — auditable by <code className="font-mono">session_id</code>.
            </span>
          </summary>
          <div className="border-t border-border/60 px-4 py-3">
            <TraceSheet trace={tf.trace} />
          </div>
        </details>
      </section>

      {/* ─────────── fork CTA ─────────── */}
      <footer className="mt-10 rounded-2xl border border-border bg-card/60 px-5 py-5 sm:px-6">
        <h2 className="text-base font-semibold tracking-tight">Fork this thought</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
          A Thoughtform is a commit, so it forks like one. Open the Studio, hold <kbd className="rounded border border-border bg-secondary/80 px-1 font-mono text-[10px]">Space</kbd>,
          and continue this thread on your own Cognitive Twin — your dictation becomes the next commit, with this one as its parent.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/studio">
            <Button variant="primary">Open the Studio</Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
            }}
          >
            Copy link
          </Button>
        </div>
        {!shared && (
          <p className="mt-3 text-[11px] leading-relaxed text-vox-amber">
            This artifact is stored in this browser only. To make the link work for anyone, configure{" "}
            <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> and publish again.
          </p>
        )}
      </footer>
    </article>
  );
}

/* ───────────────────────── local (IndexedDB) fallback ───────────────────────── */

export function LocalArtifactFallback({ hash }: { hash: string }) {
  const [state, setState] = React.useState<{ status: "loading" | "found" | "missing"; artifact?: PublishedThoughtform }>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // Exact hash first, then a prefix match so short /t/f3a1c2 links resolve too.
      let art = await store.getPublished(hash);
      if (!art) {
        const all = await store.loadPublished();
        art = all.find((a) => a.hash.startsWith(hash));
      }
      if (cancelled) return;
      setState(art ? { status: "found", artifact: art } : { status: "missing" });
    })();
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (state.status === "loading") {
    return (
      <div className="mt-16 flex items-center justify-center gap-3 text-sm text-muted-foreground" role="status">
        <Spinner className="h-4 w-4" /> Looking for this Thoughtform…
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="mt-16">
        <Empty
          title={`No published Thoughtform at ${shortHash(hash)}`}
          hint="Either this artifact was published from a different browser and shared publishing (SUPABASE_SERVICE_ROLE_KEY) is not configured on this deployment, or the hash is wrong."
        />
        <div className="mt-6 flex justify-center">
          <Link href="/studio">
            <Button variant="primary">Open the Studio</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <Artifact artifact={state.artifact!} shared={false} />;
}
