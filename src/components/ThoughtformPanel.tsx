"use client";

import { useMemo, useState } from "react";
import {
  Users2,
  GitBranch,
  Share2,
  Languages,
  Check,
} from "lucide-react";
import { useCognitive } from "@/store/cognitive-store";
import { cn, relativeTime, INTENT_COLORS } from "@/lib/utils";
import LatencyDial from "./LatencyDial";
import ConfidenceHeatmap from "./ConfidenceHeatmap";
import AgentChoir from "./AgentChoir";
import type { AgentRun } from "@/lib/types";

type Tab = "thoughtform" | "graph" | "trace";

export default function ThoughtformPanel({
  onConvene,
  councilRuns,
}: {
  onConvene: (context: string) => void;
  councilRuns: AgentRun[];
}) {
  const { state, focusHash, forkFromFocus } = useCognitive();
  const [tab, setTab] = useState<Tab>("thoughtform");
  const [published, setPublished] = useState<string | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  const tf = focusHash ? state.thoughtforms[focusHash] : undefined;

  const graphCount = useMemo(() => {
    if (!tf) return 0;
    return tf.graph_mutations.length || tf.entities.length;
  }, [tf]);

  if (!tf) {
    return (
      <div className="panel flex h-full items-center justify-center p-6 text-center text-sm text-ink-muted">
        Select a commit to inspect its Thoughtform.
      </div>
    );
  }

  const intentColor = INTENT_COLORS[tf.intent] ?? "#94A3B8";

  const publish = async () => {
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tf),
      });
      const data = await res.json();
      setPublished(data.url ?? `/t/${tf.commit_hash}`);
    } catch {
      setPublished(`/t/${tf.commit_hash}`);
    }
  };

  const translate = async () => {
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: tf.polished_text, target: "Spanish" }),
      });
      const data = await res.json();
      setTranslated(data.translated);
    } catch {
      setTranslated(null);
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="pill px-1.5 py-0 text-[10px] uppercase"
            style={{ borderColor: `${intentColor}66`, color: intentColor }}
          >
            {tf.intent}
          </span>
          <span className="mono truncate text-[11px] text-ink-muted">
            #{tf.commit_hash} on {tf.branch}
          </span>
        </div>
        <h2 className="mt-1.5 text-lg font-semibold leading-snug text-ink">{tf.title}</h2>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          {relativeTime(tf.created_at)} · {tf.language} · sentiment {tf.sentiment}
          {tf.parent_hashes[0] && (
            <>
              {" "}· parent{" "}
              <span className="mono">{tf.parent_hashes[0].slice(0, 6)}</span>
            </>
          )}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <LatencyDial ms={tf.request_time_ms} size={44} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="btn-primary text-xs"
            onClick={() => onConvene(`${tf.title}. ${tf.polished_text}`)}
          >
            <Users2 className="h-3.5 w-3.5" /> Convene council
          </button>
          <button
            className="btn-outline text-xs"
            onClick={() => forkFromFocus(`fork-${Math.random().toString(36).slice(2, 6)}`)}
          >
            <GitBranch className="h-3.5 w-3.5" /> Branch this
          </button>
          <button className="btn-outline text-xs" onClick={publish}>
            {published ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </div>

      {published && (
        <a
          href={published}
          target="_blank"
          rel="noreferrer"
          className="mx-4 mb-2 block truncate rounded-lg border border-vox-green/30 bg-vox-green/5 px-3 py-1.5 text-[11px] text-vox-green hover:underline"
        >
          Public artifact: {published}
        </a>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line px-3">
        {(
          [
            ["thoughtform", "Thoughtform"],
            ["graph", `Graph (${graphCount})`],
            ["trace", "AssemblyAI trace"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "relative px-2.5 py-2 text-[12px] font-medium transition",
              tab === key ? "text-vox-teal" : "text-ink-muted hover:text-ink"
            )}
          >
            {label}
            {tab === key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-vox-teal shadow-glow" />
            )}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === "thoughtform" && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="label-caps">Polished</span>
                <span className="pill border-vox-green/40 px-1.5 py-0 text-[9px] text-vox-green">
                  final_text
                </span>
                <button
                  onClick={translate}
                  className="btn-outline ml-auto gap-1 px-1.5 py-0.5 text-[10px]"
                >
                  <Languages className="h-3 w-3" />
                  {translating ? "…" : "Translate"}
                </button>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{tf.polished_text}</p>
              {translated && (
                <p className="mt-2 rounded-lg border border-line bg-base-800/60 p-2 text-[12px] italic text-ink-muted">
                  {translated}
                </p>
              )}
            </div>

            <div>
              <span className="label-caps">Raw (confidence heatmap)</span>
              <ConfidenceHeatmap
                words={tf.words.length ? tf.words : tf.raw_text.split(/\s+/).map((t) => ({ text: t, confidence: tf.confidence }))}
                className="mt-1.5 text-[12px] leading-relaxed text-ink-muted"
              />
            </div>

            {tf.entities.length > 0 && (
              <div>
                <span className="label-caps">Entities</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tf.entities.map((e) => (
                    <span key={e} className="pill border-line text-[11px] text-ink">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {tf.actions.length > 0 && (
              <div>
                <span className="label-caps">Actions</span>
                <ul className="mt-1.5 space-y-1">
                  {tf.actions.map((a) => (
                    <li key={a} className="flex items-start gap-2 text-[12px] text-ink-muted">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-vox-teal" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {councilRuns.length > 0 && (
              <div>
                <span className="label-caps">Agent Council</span>
                <div className="mt-1.5">
                  <AgentChoir runs={councilRuns} />
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "graph" && (
          <div className="space-y-2">
            <span className="label-caps">Graph mutations & entities</span>
            {(tf.graph_mutations.length
              ? tf.graph_mutations.map((m) => m.node?.label ?? m.edge?.label ?? m.op)
              : tf.entities
            ).map((label, i) => (
              <div
                key={`${label}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-base-800/50 px-3 py-2 text-[12px]"
              >
                <span className="h-2 w-2 rounded-full bg-vox-purple" />
                {label}
              </div>
            ))}
            {!tf.graph_mutations.length && !tf.entities.length && (
              <p className="text-[12px] text-ink-muted">No graph mutations for this Thoughtform.</p>
            )}
          </div>
        )}

        {tab === "trace" && (
          <dl className="space-y-2 text-[12px]">
            {[
              ["session_id", tf.session_id ?? "—"],
              ["request_time_ms", `${tf.request_time_ms} ms`],
              ["audio_duration_ms", tf.audio_duration_ms ? `${tf.audio_duration_ms} ms` : "—"],
              ["overall confidence", `${Math.round(tf.confidence * 100)}%`],
              ["language_code", tf.language],
              ["model", "universal-3-5-pro"],
              ["endpoint", "sync.assemblyai.com/transcribe"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-line/60 pb-1.5">
                <dt className="text-ink-muted">{k}</dt>
                <dd className="mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
