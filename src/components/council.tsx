"use client";

/**
 * The Agent Choir + Council modal (§3.7.5, Flow F).
 *
 * Consumes the NDJSON stream from POST /api/agents so each specialist card fills in the instant its
 * own model returns — four different free Groq models running in parallel, visibly. A final
 * `synthesis` event carries the consensus verdict and an improved polished_text the user can accept.
 */

import * as React from "react";
import type { AgentKind, AgentOutput, AgentRun, Thoughtform } from "@/lib/types";
import { cn, buildICS, download, formatMs, shortHash } from "@/lib/utils";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Empty, Modal, Spinner } from "@/components/ui";

/** Mirrors AGENT_META in lib/kernel/agents.ts (which is server-only — models must match). */
export const AGENT_UI: Record<AgentKind, { name: string; model: string; role: string; color: string; emoji: string }> = {
  researcher: { name: "Researcher", model: "llama-3.3-70b-versatile", role: "Web + graph RAG, cited findings", color: "#22d3ee", emoji: "🔎" },
  executor: { name: "Executor", model: "openai/gpt-oss-120b", role: "Turns intent into concrete actions", color: "#34d399", emoji: "⚡" },
  devils_advocate: { name: "Devil's Advocate", model: "moonshotai/kimi-k2-instruct", role: "Contrarian critique + risk register", color: "#fb7185", emoji: "😈" },
  historian: { name: "Historian", model: "llama-3.3-70b-versatile", role: "\"You already said this on…\"", color: "#a78bfa", emoji: "📜" },
  scheduler: { name: "Scheduler", model: "qwen/qwen3-32b", role: "Time expressions → ISO-8601", color: "#fbbf24", emoji: "🗓️" },
  emotion_curator: { name: "Emotion Curator", model: "llama-3.1-8b-instant", role: "Valence / arousal + reframe", color: "#f472b6", emoji: "💗" },
};

export interface CouncilSynthesis {
  consensus: string;
  verdict: "proceed" | "proceed_with_caution" | "reconsider";
  next_steps: string[];
  polished_text: string;
  model: string;
  provider: string;
  latency_ms: number;
}

/* ───────────────────────── Agent Choir (inline badges) ───────────────────────── */

export function AgentChoir({ runs, onOpen }: { runs: AgentRun[]; onOpen: () => void }) {
  if (!runs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {runs.map((r) => {
        const meta = AGENT_UI[r.agent];
        const tone =
          r.status === "done" ? "emerald" : r.status === "error" ? "rose" : r.status === "paused" ? "amber" : "cyan";
        return (
          <button key={r.id} type="button" onClick={onOpen} title={`${meta.name} — ${meta.model} (${r.status})`}>
            <Badge tone={tone as "emerald"}>
              <span aria-hidden="true">{meta.emoji}</span>
              {meta.name}
              {(r.status === "running" || r.status === "queued") && <Spinner className="h-2.5 w-2.5" />}
              {r.status === "done" && r.latency_ms != null && <span className="font-mono opacity-70">{formatMs(r.latency_ms)}</span>}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Agent card ───────────────────────── */

function AgentCard({ run }: { run: AgentRun }) {
  const meta = AGENT_UI[run.agent];
  const out = run.output;
  const pending = run.status === "queued" || run.status === "running";

  return (
    <Card className="overflow-hidden" style={{ borderColor: `${meta.color}55` }}>
      <CardHeader className="items-start" style={{ background: `${meta.color}0f` }}>
        <div className="flex min-w-0 items-start gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base" style={{ background: `${meta.color}22` }} aria-hidden="true">
            {meta.emoji}
          </span>
          <div className="min-w-0">
            <CardTitle style={{ color: meta.color }}>{meta.name}</CardTitle>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{run.model || meta.model}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={run.status === "done" ? "emerald" : run.status === "error" ? "rose" : run.status === "paused" ? "amber" : "cyan"}>
            {run.status}
          </Badge>
          {run.latency_ms != null && run.status === "done" && (
            <span className="font-mono text-[10px] text-muted-foreground">{formatMs(run.latency_ms)}</span>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-2.5">
        {pending && (
          <div className="space-y-1.5" aria-live="polite" aria-label={`${meta.name} is thinking`}>
            <p className="text-xs text-muted-foreground">{meta.role}</p>
            {[90, 78, 62].map((w) => (
              <div key={w} className="h-2.5 overflow-hidden rounded bg-secondary/70" style={{ width: `${w}%` }}>
                <div className="h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
              </div>
            ))}
          </div>
        )}

        {run.status === "paused" && (
          <p className="text-xs text-vox-amber">
            Council paused — every free model in the round-robin is rate-limited right now. Retry in a moment; nothing was lost.
          </p>
        )}

        {run.status === "error" && <p className="text-xs text-vox-rose">{run.error}</p>}

        {out && <AgentOutputView agent={run.agent} out={out} />}
      </CardBody>
    </Card>
  );
}

function AgentOutputView({ agent, out }: { agent: AgentKind; out: AgentOutput }) {
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium leading-snug">{out.headline}</p>

      {out.bullets?.length > 0 && (
        <ul className="space-y-1">
          {out.bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {out.risk_register?.length ? (
        <div className="space-y-1 rounded-lg border border-vox-rose/30 bg-vox-rose/5 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-rose">risk register</p>
          {out.risk_register.map((r, i) => (
            <div key={i} className="text-xs">
              <span
                className={cn(
                  "mr-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase",
                  r.severity === "high" ? "bg-vox-rose/25 text-vox-rose" : r.severity === "med" ? "bg-vox-amber/25 text-vox-amber" : "bg-secondary text-muted-foreground",
                )}
              >
                {r.severity}
              </span>
              <span className="font-medium">{r.risk}</span>
              {r.mitigation && <span className="text-muted-foreground"> → {r.mitigation}</span>}
            </div>
          ))}
        </div>
      ) : null}

      {out.schedule?.length ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-amber">schedule</p>
          {out.schedule.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{s.human || s.iso}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 px-1.5 text-[10px]"
                onClick={() => download(`${s.title.slice(0, 40).replace(/\W+/g, "-")}.ics`, buildICS(s.title, s.iso), "text/calendar")}
              >
                .ics
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {out.actions?.length ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-emerald">proposed actions</p>
          {out.actions.map((a, i) => (
            <details key={i} className="rounded border border-border/60 px-2 py-1 text-xs">
              <summary className="cursor-pointer">
                <Badge tone="emerald">{a.kind}</Badge> <span className="ml-1 font-medium">{a.title}</span>
              </summary>
              {a.payload && <p className="mt-1.5 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{a.payload}</p>}
              {a.when && <p className="mt-1 font-mono text-[10px] text-muted-foreground">when: {a.when}</p>}
              {a.target && <p className="font-mono text-[10px] text-muted-foreground">target: {a.target}</p>}
            </details>
          ))}
        </div>
      ) : null}

      {out.related?.length ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-violet">related commits</p>
          {out.related.map((r, i) => (
            <div key={i} className="text-xs text-muted-foreground">
              <code className="font-mono text-vox-violet">{r.commit}</code> <span className="opacity-70">{r.when}</span> — {r.why}
            </div>
          ))}
        </div>
      ) : null}

      {out.citations?.length ? (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-vox-cyan">sources</p>
          <ol className="space-y-0.5">
            {out.citations.map((c, i) => (
              <li key={i} className="truncate text-xs">
                <span className="mr-1 font-mono text-[10px] text-muted-foreground">[{i + 1}]</span>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-vox-cyan underline decoration-dotted hover:decoration-solid">
                  {c.title || c.url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {agent === "emotion_curator" && (out.valence != null || out.arousal != null) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">valence</p>
            <p className="font-mono">{out.valence?.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">arousal</p>
            <p className="font-mono">{out.arousal?.toFixed(2)}</p>
          </div>
        </div>
      )}

      {out.raw && <pre className="scrollbar-thin max-h-32 overflow-auto rounded bg-secondary/50 p-2 text-[10px]">{out.raw}</pre>}
    </div>
  );
}

/* ───────────────────────── Council modal ───────────────────────── */

export function CouncilModal({
  open,
  onClose,
  thoughtform,
  runs,
  synthesis,
  synthesizing,
  onConvene,
  onAcceptSynthesis,
  running,
}: {
  open: boolean;
  onClose: () => void;
  thoughtform: Thoughtform | null;
  runs: AgentRun[];
  synthesis: CouncilSynthesis | null;
  synthesizing: boolean;
  onConvene: (agents?: AgentKind[]) => void;
  onAcceptSynthesis: (text: string) => void;
  running: boolean;
}) {
  const allAgents = Object.keys(AGENT_UI) as AgentKind[];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Agent Council"
      description={
        thoughtform
          ? `${shortHash(thoughtform.commit_hash)} · ${thoughtform.compiled.title} — each specialist runs on a different free GroqCloud model, in parallel.`
          : "Select a Thoughtform first."
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {allAgents.map((a) => (
              <Button
                key={a}
                size="sm"
                variant="outline"
                disabled={running || !thoughtform}
                onClick={() => onConvene([a])}
                title={`${AGENT_UI[a].name} — ${AGENT_UI[a].model}`}
              >
                <span aria-hidden="true">{AGENT_UI[a].emoji}</span> {AGENT_UI[a].name}
              </Button>
            ))}
          </div>
          <Button variant="primary" size="sm" loading={running} disabled={!thoughtform} onClick={() => onConvene()}>
            Convene full council
          </Button>
        </div>
      }
    >
      {!thoughtform ? (
        <Empty title="No Thoughtform selected" hint="Pick a commit on the timeline, then convene the council." />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">under consideration</p>
              <p className="mt-1 text-sm">{thoughtform.compiled.polished_text}</p>
            </CardBody>
          </Card>

          {!runs.length && !running && (
            <Empty
              title="The council has not convened"
              hint="Convene the full fleet, or summon one specialist. You can also say “VOXEMBLY, convene the council”."
            />
          )}

          {runs.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {runs.map((r) => (
                <AgentCard key={r.id} run={r} />
              ))}
            </div>
          )}

          {(synthesizing || synthesis) && (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-primary">Consensus</CardTitle>
                {synthesis && (
                  <Badge tone={synthesis.verdict === "proceed" ? "emerald" : synthesis.verdict === "reconsider" ? "rose" : "amber"}>
                    {synthesis.verdict.replace(/_/g, " ")}
                  </Badge>
                )}
              </CardHeader>
              <CardBody className="space-y-3">
                {synthesizing && !synthesis ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="h-3 w-3" /> Folding the council's critiques into a consensus…
                  </p>
                ) : synthesis ? (
                  <>
                    <p className="text-sm leading-relaxed">{synthesis.consensus}</p>
                    {synthesis.next_steps.length > 0 && (
                      <ol className="space-y-1">
                        {synthesis.next_steps.map((s, i) => (
                          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="font-mono text-primary">{i + 1}.</span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    )}
                    {synthesis.polished_text && synthesis.polished_text !== thoughtform.compiled.polished_text && (
                      <div className="space-y-1.5 rounded-lg border border-border/60 bg-background/50 p-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">council-improved text</p>
                        <p className="text-sm">{synthesis.polished_text}</p>
                        <Button size="sm" variant="primary" onClick={() => onAcceptSynthesis(synthesis.polished_text)}>
                          Accept into commit
                        </Button>
                      </div>
                    )}
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {synthesis.model} · {synthesis.provider} · {formatMs(synthesis.latency_ms)}
                    </p>
                  </>
                ) : null}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}
