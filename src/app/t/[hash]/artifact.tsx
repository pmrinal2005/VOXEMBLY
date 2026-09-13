"use client";

/**
 * The published artifact renderer (client half of /t/{hash}).
 *
 * Receives the Supabase-backed artifact when one exists; otherwise falls back to the author's own
 * IndexedDB copy so an unshared publish still renders for them. "Fork this thought" seeds the
 * visitor's own Twin with the artifact's graph mutations — a real continuation, not a copy button.
 */

import * as React from "react";
import Link from "next/link";
import type { PublishedThoughtform } from "@/lib/types";
import * as store from "@/lib/store/db";
import { useTwin } from "@/lib/store/twin";
import { AGENT_UI } from "@/components/council";
import { ConfidenceHeatmap, ConfidenceLegend, DiffRibbon, TraceSheet } from "@/components/telemetry";
import { TwinCanvas } from "@/components/twin-canvas";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, Spinner } from "@/components/ui";
import { cn, formatDateTime, formatMs, shortHash } from "@/lib/utils";

type State = { status: "loading" } | { status: "found"; art: PublishedThoughtform; local: boolean } | { status: "missing" };

export function Artifact({ hash, shared }: { hash: string; shared: PublishedThoughtform | null }) {
  const [state, setState] = React.useState<State>(shared ? { status: "found", art: shared, local: false } : { status: "loading" });
  const [forking, setForking] = React.useState(false);
  const [forked, setForked] = React.useState(false);

  /* No Supabase row → try the author's local copy. */
  React.useEffect(() => {
    if (shared) return;
    let alive = true;
    void (async () => {
      try {
        const local = await store.getPublished(hash);
        if (!alive) return;
        setState(local ? { status: "found", art: local, local: true } : { status: "missing" });
      } catch {
        if (alive) setState({ status: "missing" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [hash, shared]);

  /** Replay the artifact's mutations onto the visitor's own Twin as a fresh commit. */
  const forkHere = async () => {
    if (state.status !== "found") return;
    setForking(true);
    try {
      const twin = useTwin.getState();
      if (!twin.hydrated) await twin.hydrate();
      const src = state.art.thoughtform;

      const { computeCommitHash } = await import("@/lib/twin/vcs");
      const branch = twin.currentBranch;
      const parent = twin.branches[branch]?.head ?? null;
      const created_at = Date.now();
      const title = `Forked: ${src.compiled.title || shortHash(src.commit_hash)}`;

      const commit_hash = await computeCommitHash({
        parent_hashes: parent ? [parent] : [],
        branch,
        created_at,
        raw_text: src.raw_text,
        polished_text: src.compiled.polished_text,
        intent: src.compiled.intent,
        session_id: `fork:${src.commit_hash}`,
      });

      await twin.addThoughtform({
        ...src,
        id: commit_hash,
        commit_hash,
        // The upstream commit is recorded as a parent, so provenance survives the fork.
        parent_hashes: [parent, src.commit_hash].filter(Boolean) as string[],
        branch,
        created_at,
        published: false,
        agent_runs: [],
        compiled: { ...src.compiled, title },
        trace: { ...src.trace, session_id: `fork:${src.commit_hash}` },
      });
      setForked(true);
    } finally {
      setForking(false);
    }
  };

  if (state.status === "loading") {
    return (
      <main id="main" className="grid min-h-dvh place-items-center">
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Resolving Thoughtform {shortHash(hash)}…
        </p>
      </main>
    );
  }

  if (state.status === "missing") {
    return (
      <main id="main" className="grid-bg grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-md text-center">
          <Empty
            title={`No published Thoughtform at ${shortHash(hash)}`}
            hint="This artifact was never published, was published on another device without shared storage configured, or the link is wrong."
          />
          <Link href="/studio">
            <Button className="mt-4">Open the Studio</Button>
          </Link>
        </div>
      </main>
    );
  }

  const { art, local } = state;
  const tf = art.thoughtform;
  const c = tf.compiled;
  const snapshot = art.snapshot;
  const councilRuns = (tf.agent_runs ?? []).filter((r) => r.status === "done" && r.output);

  return (
    <main id="main" className="grid-bg min-h-dvh">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        {/* ───── header ───── */}
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <Link href="/studio" className="flex items-center gap-2" aria-label="VOXEMBLY home">
              <span
                className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-vox-cyan to-vox-violet text-sm font-black text-background"
                aria-hidden="true"
              >
                V
              </span>
              <span className="text-sm font-bold tracking-tight">VOXEMBLY</span>
            </Link>
            <Badge tone="cyan" className="ml-auto font-mono">
              {shortHash(tf.commit_hash)}
            </Badge>
            {local && <Badge tone="amber">local only</Badge>}
          </div>

          <h1 className="mt-6 text-balance text-3xl font-bold tracking-tight">{c.title || "Untitled Thoughtform"}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="violet">{c.intent}</Badge>
            <span>by {art.author || "Anonymous"}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(art.published_at).toISOString()}>{formatDateTime(art.published_at)}</time>
            <span aria-hidden="true">·</span>
            <span className="font-mono">branch {tf.branch}</span>
            {c.language_detected && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{c.language_detected}</span>
              </>
            )}
          </div>
        </header>

        {/* ───── polished text ───── */}
        <article className="rounded-2xl border border-border glass p-6">
          <p className="text-balance text-lg leading-relaxed">{c.polished_text || tf.raw_text}</p>
        </article>

        {/* ───── telemetry strip: the real numbers from the Dictation API ───── */}
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-border/60 bg-secondary/30 p-4 sm:grid-cols-4">
          {[
            ["Sync STT", formatMs(tf.trace.request_time_ms), "request_time_ms", "text-vox-cyan"],
            ["Mouth → meaning", formatMs(tf.total_ms), "key-up → commit", ""],
            ["Confidence", `${Math.round((tf.confidence ?? 0) * 100)}%`, "utterance mean", "text-vox-emerald"],
            ["Audio", formatMs(tf.trace.audio_duration_ms), tf.trace.audio_format, ""],
          ].map(([label, value, sub, tone]) => (
            <div key={label as string} className="min-w-0">
              <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label as string}</dt>
              <dd className={cn("truncate font-mono text-lg font-semibold leading-tight", tone as string)}>{value as string}</dd>
              <dd className="truncate text-[10px] text-muted-foreground">{sub as string}</dd>
            </div>
          ))}
        </dl>

        {/* ───── raw → polished diff ───── */}
        {tf.raw_text && tf.raw_text !== c.polished_text && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>What was actually said</CardTitle>
            </CardHeader>
            <CardBody>
              <DiffRibbon raw={tf.raw_text} polished={c.polished_text} animate={false} />
            </CardBody>
          </Card>
        )}

        {/* ───── confidence heatmap ───── */}
        {tf.words?.length > 0 && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Confidence heatmap</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <ConfidenceHeatmap words={tf.words} text={tf.raw_text} />
              <ConfidenceLegend />
            </CardBody>
          </Card>
        )}

        {/* ───── entities & actions ───── */}
        {(c.entities?.length > 0 || c.actions?.length > 0) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {c.entities?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Entities</CardTitle>
                </CardHeader>
                <CardBody>
                  <ul className="flex flex-wrap gap-1.5">
                    {c.entities.map((e) => (
                      <li key={`${e.type}:${e.name}`}>
                        <Badge tone="neutral" title={e.description}>
                          <span className="opacity-60">{e.type}</span> {e.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
            {c.actions?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardBody>
                  <ul className="space-y-1.5">
                    {c.actions.map((a, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-medium">{a.title}</span>
                        {a.when && <span className="ml-1.5 font-mono text-muted-foreground">{a.when}</span>}
                        <Badge tone="neutral" className="ml-1.5">
                          {a.kind}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        {/* ───── the agent debate ───── */}
        {councilRuns.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The council debated this</h2>
            <div className="space-y-3">
              {councilRuns.map((run) => {
                const ui = AGENT_UI[run.agent];
                return (
                  <Card key={run.id}>
                    <CardHeader className="flex items-center gap-2">
                      <span aria-hidden="true">{ui.emoji}</span>
                      <CardTitle style={{ color: ui.color }}>{ui.name}</CardTitle>
                      <Badge tone="neutral" className="ml-auto font-mono">
                        {run.model}
                      </Badge>
                      {run.latency_ms != null && <span className="font-mono text-[10px] text-muted-foreground">{formatMs(run.latency_ms)}</span>}
                    </CardHeader>
                    <CardBody className="space-y-2">
                      {run.output?.headline && <p className="text-sm font-medium">{run.output.headline}</p>}
                      {run.output?.bullets?.length ? (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {run.output.bullets.map((b, i) => (
                            <li key={i}>• {b}</li>
                          ))}
                        </ul>
                      ) : null}
                      {run.output?.risk_register?.length ? (
                        <ul className="space-y-1">
                          {run.output.risk_register.map((r, i) => (
                            <li key={i} className="text-xs">
                              <Badge tone={r.severity === "high" ? "rose" : r.severity === "med" ? "amber" : "neutral"}>{r.severity}</Badge>{" "}
                              <span className="text-muted-foreground">
                                {r.risk} — <em>{r.mitigation}</em>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {run.output?.citations?.length ? (
                        <ul className="space-y-0.5">
                          {run.output.citations.map((ct, i) => (
                            <li key={i} className="truncate text-[11px]">
                              <a href={ct.url} target="_blank" rel="noopener noreferrer nofollow" className="text-vox-cyan underline decoration-dotted">
                                {ct.title || ct.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {/* ───── the graph as it was at this commit ───── */}
        {snapshot?.nodes?.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cognitive Twin at this commit <span className="font-mono normal-case">({snapshot.nodes.length} nodes · {snapshot.edges.length} edges)</span>
            </h2>
            <div className="h-72 overflow-hidden rounded-2xl border border-border/60">
              <TwinCanvas nodes={snapshot.nodes} edges={snapshot.edges} highlight={[]} reduceMotion className="h-full w-full" />
            </div>
          </section>
        )}

        {/* ───── the auditable trace ───── */}
        <details className="mt-4 rounded-2xl border border-border/60">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Dictation API trace — model, region, session_id, the exact prompt and keyterms sent
          </summary>
          <div className="px-4 pb-4">
            <TraceSheet trace={tf.trace} />
          </div>
        </details>

        {/* ───── fork / footer ───── */}
        <footer className="mt-8 flex flex-wrap items-center gap-3 border-t border-border/60 pt-6">
          {forked ? (
            <Link href="/studio">
              <Button>Continue in your Studio →</Button>
            </Link>
          ) : (
            <Button onClick={() => void forkHere()} loading={forking}>
              Fork this thought
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            {forked
              ? "Committed onto your own Twin — the upstream commit is recorded as its parent."
              : local
                ? "This artifact lives in this browser only. Configure Supabase to make the link public."
                : "Forking replays this Thoughtform's graph mutations onto your own Cognitive Twin."}
          </p>
          <p className="ml-auto text-[11px] text-muted-foreground">
            Compiled from one dictation by{" "}
            <Link href="/studio" className="text-vox-cyan underline decoration-dotted">
              VOXEMBLY
            </Link>{" "}
            · universal-3-5-pro
          </p>
        </footer>
      </div>
    </main>
  );
}
