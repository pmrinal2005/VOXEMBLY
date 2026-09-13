"use client";

/**
 * The Thoughtform panel — the full typed object for one commit: intent, polished text, the raw→polished
 * Diff Ribbon, the Confidence Heatmap, entities, actions, graph mutations, agent runs, and the complete
 * AssemblyAI trace. This is the "it's not a transcript, it's an object" proof surface.
 */

import * as React from "react";
import type { Thoughtform } from "@/lib/types";
import { cn, formatDateTime, formatMs, shortHash, timeAgo } from "@/lib/utils";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, Stat } from "@/components/ui";
import { ConfidenceHeatmap, ConfidenceLegend, DiffRibbon, LatencyDial, TraceSheet } from "@/components/telemetry";
import { AgentChoir } from "@/components/council";

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

type Tab = "thoughtform" | "trace" | "mutations";

export function ThoughtformPanel({
  tf,
  onConvene,
  onPublish,
  onFork,
  onTranslate,
  publishing,
  translating,
  translation,
}: {
  tf: Thoughtform | null;
  onConvene: () => void;
  onPublish: () => void;
  onFork: () => void;
  onTranslate: (target: string) => void;
  publishing: boolean;
  translating: boolean;
  translation: { target: string; text: string } | null;
}) {
  const [tab, setTab] = React.useState<Tab>("thoughtform");

  if (!tf) {
    return (
      <Empty
        title="No Thoughtform selected"
        hint="Hold the Orb and speak — your utterance becomes a typed, versioned commit. Or pick a commit on the timeline."
      />
    );
  }

  const c = tf.compiled;
  const addedNodes = c.graph_mutations.filter((m) => m.op === "add_node").length;
  const addedEdges = c.graph_mutations.filter((m) => m.op === "add_edge").length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="space-y-2 border-b border-border/60 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={INTENT_TONE[c.intent] ?? "neutral"}>{c.intent}</Badge>
              <code className="font-mono text-[11px] text-muted-foreground">#{shortHash(tf.commit_hash)}</code>
              <span className="text-[11px] text-muted-foreground">on</span>
              <code className="font-mono text-[11px] text-vox-cyan">{tf.branch}</code>
              {tf.parent_hashes.length > 1 && <Badge tone="amber">merge</Badge>}
              {tf.published && <Badge tone="emerald">published</Badge>}
            </div>
            <h2 className="mt-1 truncate text-base font-semibold tracking-tight" title={c.title}>
              {c.title}
            </h2>
            <p className="text-[11px] text-muted-foreground" title={formatDateTime(tf.created_at)}>
              {timeAgo(tf.created_at)} · {c.language_detected} · sentiment {c.sentiment.label}
              {tf.parent_hashes.length > 0 && (
                <>
                  {" "}
                  · parent{tf.parent_hashes.length > 1 ? "s" : ""}{" "}
                  {tf.parent_hashes.map((p) => (
                    <code key={p} className="font-mono">
                      {shortHash(p)}{" "}
                    </code>
                  ))}
                </>
              )}
            </p>
          </div>
          <LatencyDial
            requestTimeMs={tf.trace.request_time_ms}
            proxyMs={tf.trace.proxy_roundtrip_ms}
            clientMs={tf.total_ms}
            warmed={tf.trace.warmed}
            region={tf.trace.region}
            route={tf.trace.route}
            compact
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" onClick={onConvene}>
            Convene council
          </Button>
          <Button size="sm" variant="outline" onClick={onFork}>
            Branch this
          </Button>
          <Button size="sm" variant="outline" loading={publishing} onClick={onPublish}>
            {tf.published ? "Re-publish" : "Publish"}
          </Button>
          <select
            className="h-8 rounded-md border border-input bg-background/60 px-2 text-xs"
            aria-label="Translate this Thoughtform"
            value={translation?.target ?? ""}
            disabled={translating}
            onChange={(e) => e.target.value && onTranslate(e.target.value)}
          >
            <option value="">Translate…</option>
            {[
              ["es", "Español"],
              ["ja", "日本語"],
              ["hi", "हिन्दी"],
              ["fr", "Français"],
              ["de", "Deutsch"],
              ["zh", "中文"],
              ["ar", "العربية"],
              ["pt", "Português"],
            ].map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {tf.agent_runs.length > 0 && <AgentChoir runs={tf.agent_runs} onOpen={onConvene} />}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Thoughtform detail" className="flex gap-1 border-b border-border/60 px-3 pt-2">
        {(
          [
            ["thoughtform", "Thoughtform"],
            ["mutations", `Graph (${addedNodes + addedEdges})`],
            ["trace", "AssemblyAI trace"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {tab === "thoughtform" && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Polished</CardTitle>
                <Badge tone="emerald">final_text</Badge>
              </CardHeader>
              <CardBody>
                <p className="text-sm leading-relaxed">{c.polished_text}</p>
                {translation && (
                  <div className="mt-3 rounded-lg border border-vox-violet/30 bg-vox-violet/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-violet">{translation.target}</p>
                    <p className="mt-1 text-sm leading-relaxed" lang={translation.target}>
                      {translation.text}
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Diff Ribbon</CardTitle>
                <Badge tone="neutral">cleanup pass</Badge>
              </CardHeader>
              <CardBody>
                <DiffRibbon raw={tf.raw_text} polished={c.polished_text} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Verbatim + Confidence Heatmap</CardTitle>
                <span className="font-mono text-[11px] text-muted-foreground">
                  overall {(tf.confidence * 100).toFixed(1)}%
                </span>
              </CardHeader>
              <CardBody className="space-y-2">
                <ConfidenceHeatmap words={tf.words} text={tf.raw_text} />
                <ConfidenceLegend />
              </CardBody>
            </Card>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="audio" value={formatMs(tf.trace.audio_duration_ms)} sub={`${(tf.trace.audio_bytes / 1024).toFixed(0)} KB`} />
              <Stat label="server" value={tf.trace.request_time_ms == null ? "—" : `${Math.round(tf.trace.request_time_ms)}ms`} tone="cyan" sub="request_time_ms" />
              <Stat label="compile" value={formatMs(tf.compile_ms)} tone="amber" sub="Groq cleanup" />
              <Stat label="total" value={formatMs(tf.total_ms)} tone="emerald" sub="mouth→meaning" />
            </div>

            {c.entities.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Entities</CardTitle>
                </CardHeader>
                <CardBody>
                  <div className="flex flex-wrap gap-1.5">
                    {c.entities.map((e) => (
                      <Badge key={e.name} tone="violet" title={e.description}>
                        {e.name}
                        <span className="opacity-60">· {e.type}</span>
                      </Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}

            {c.actions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Actions</CardTitle>
                </CardHeader>
                <CardBody className="space-y-1.5">
                  {c.actions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge tone="emerald">{a.kind}</Badge>
                      <div className="min-w-0">
                        <p className="font-medium">{a.title}</p>
                        {a.when && <p className="font-mono text-[10px] text-muted-foreground">{a.when}</p>}
                        {a.payload && <p className="text-muted-foreground">{a.payload}</p>}
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}

            {c.keyterms_learned.length > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-primary">Keyterms learned</CardTitle>
                  <Badge tone="cyan">feeds next dictation</Badge>
                </CardHeader>
                <CardBody>
                  <div className="flex flex-wrap gap-1">
                    {c.keyterms_learned.map((k) => (
                      <Badge key={k} tone="cyan">
                        {k}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    These are now in the <code className="font-mono">keyterms_prompt</code> for every future dictation — this is the
                    bi-directional memory ↔ dictation loop.
                  </p>
                </CardBody>
              </Card>
            )}
          </>
        )}

        {tab === "mutations" && (
          <Card>
            <CardHeader>
              <CardTitle>Graph mutations</CardTitle>
              <span className="text-[11px] text-muted-foreground">
                {addedNodes} node{addedNodes === 1 ? "" : "s"} · {addedEdges} edge{addedEdges === 1 ? "" : "s"}
              </span>
            </CardHeader>
            <CardBody>
              {c.graph_mutations.length ? (
                <ul className="space-y-1">
                  {c.graph_mutations.map((m, i) => (
                    <li key={i} className="flex items-start gap-2 font-mono text-[11px]">
                      <Badge tone={m.op === "add_node" ? "violet" : m.op === "add_edge" ? "cyan" : "rose"}>{m.op}</Badge>
                      <span className="min-w-0 break-all text-muted-foreground">
                        {m.op === "add_node" && `${m.id} : ${m.type} — "${m.label}"`}
                        {m.op === "add_edge" && `${m.from} —[${m.label}]→ ${m.to}  (w=${m.weight ?? 0.6})`}
                        {m.op === "invalidate_edge" && `${m.id} → valid_to = ${new Date(tf.created_at).toISOString()}`}
                        {m.op === "update_node" && `${m.id} ← ${m.label ?? ""} ${m.description ?? ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">This commit mutated no graph state.</p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Edges carry <code className="font-mono">valid_from</code> / <code className="font-mono">valid_to</code> (Zep/Graphiti
                temporal semantics), which is what makes Time Travel a real query rather than a replay.
              </p>
            </CardBody>
          </Card>
        )}

        {tab === "trace" && <TraceSheet trace={tf.trace} />}
      </div>
    </div>
  );
}
