/**
 * The Fleet — typed specialist agents dispatched by the Intent Kernel.
 * Each agent runs on a different free GroqCloud model (round-robin fallback on 429 → AssemblyAI LLM Gateway → paused).
 * Server-side only.
 */
import { chat, extractJSON, GROQ_MODELS, LLMPausedError } from "@/lib/llm/groq";
import { formatHitsForPrompt, webSearch, type SearchHit } from "@/lib/kernel/search";
import type { AgentKind, AgentOutput, CompiledThoughtform } from "@/lib/types";

export interface AgentContext {
  /** The thoughtform under consideration */
  compiled: CompiledThoughtform;
  raw_text: string;
  /** Related past thoughtforms (retrieved client-side from the Twin) */
  related: { commit: string; when: string; title: string; text: string; score?: number }[];
  /** Known graph labels for grounding */
  knownNodes: string[];
  domain?: string;
  project?: string | null;
  nowISO: string;
  timezone?: string;
  language?: string;
}

export interface AgentRunResult {
  agent: AgentKind;
  model: string;
  provider: "groq" | "assemblyai-llm-gateway" | "local";
  status: "done" | "error" | "paused";
  output?: AgentOutput;
  error?: string;
  latency_ms: number;
  hops?: number;
}

export const AGENT_META: Record<AgentKind, { name: string; model: string; role: string; color: string; emoji: string }> = {
  researcher: { name: "Researcher", model: GROQ_MODELS.reasoner, role: "Web + graph RAG; returns cited findings", color: "#22d3ee", emoji: "🔎" },
  executor: { name: "Executor", model: GROQ_MODELS.tools, role: "Turns intent into concrete actions (calendar / message / PR / note)", color: "#34d399", emoji: "⚡" },
  devils_advocate: { name: "Devil's Advocate", model: GROQ_MODELS.contrarian, role: "Contrarian critique + risk register", color: "#fb7185", emoji: "😈" },
  historian: { name: "Historian", model: GROQ_MODELS.reasoner, role: "\"You already said this on…\" — retrieves related past Thoughtforms", color: "#a78bfa", emoji: "📜" },
  scheduler: { name: "Scheduler", model: GROQ_MODELS.multilingual, role: "Normalises time expressions to ISO-8601 reminders", color: "#fbbf24", emoji: "🗓️" },
  emotion_curator: { name: "Emotion Curator", model: GROQ_MODELS.fast, role: "Valence / arousal + a supportive reframe", color: "#f472b6", emoji: "💗" },
};

const BASE_RULES = `Return ONE strict JSON object and nothing else. Never invent facts about the speaker that are not in the transcript or the provided context. Be concise: headline ≤ 90 chars, each bullet ≤ 160 chars.`;

function ctxBlock(ctx: AgentContext) {
  const related = ctx.related.length
    ? ctx.related.map((r) => `- [${r.commit.slice(0, 7)} • ${r.when}] ${r.title}: ${r.text.slice(0, 220)}`).join("\n")
    : "- none";
  return `Now: ${ctx.nowISO}${ctx.timezone ? ` (${ctx.timezone})` : ""}
Domain: ${ctx.domain ?? "general"} | Project: ${ctx.project ?? "none"}
Known graph nodes: ${ctx.knownNodes.slice(0, 40).join(", ") || "none"}
Related past thoughtforms:
${related}

CURRENT THOUGHTFORM
intent: ${ctx.compiled.intent}
title: ${ctx.compiled.title}
polished: ${ctx.compiled.polished_text}
verbatim: ${ctx.raw_text}
entities: ${ctx.compiled.entities.map((e) => `${e.name} (${e.type})`).join(", ") || "none"}`;
}

const PROMPTS: Record<AgentKind, (ctx: AgentContext, extra?: string) => { system: string; user: string; model: string }> = {
  researcher: (ctx, extra) => ({
    model: AGENT_META.researcher.model,
    system: `You are the VOXEMBLY Researcher agent. Answer the question / evaluate the idea using the WEB RESULTS and the speaker's context. Cite results by index. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[] (3-5 findings, each ending with [n] citation indexes when grounded), "citations": [{"title": string, "url": string}], "graph_suggestions": [{"label": string, "type": "Concept"|"Entity"|"Person"|"Project"}]}`,
    user: `${ctxBlock(ctx)}\n\nWEB RESULTS\n${extra ?? "none"}\n\nReturn the JSON now.`,
  }),
  executor: (ctx) => ({
    model: AGENT_META.executor.model,
    system: `You are the VOXEMBLY Executor agent. Convert the thoughtform into concrete, minimal actions the app can execute locally (no external OAuth is connected yet): calendar events (.ics), reminders, message drafts, PR drafts, notes. Draft the actual payload text. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[], "actions": [{"kind": "calendar"|"reminder"|"message"|"pr_draft"|"note"|"search"|"other", "title": string, "when": ISO-8601|null, "target": string|null, "payload": string|null, "status": "proposed"}]}`,
    user: `${ctxBlock(ctx)}\n\nReturn the JSON now.`,
  }),
  devils_advocate: (ctx) => ({
    model: AGENT_META.devils_advocate.model,
    system: `You are the VOXEMBLY Devil's Advocate. Argue AGAINST the decision/idea rigorously but fairly: hidden assumptions, second-order effects, cheaper alternatives, what would have to be true. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[] (3-5 counter-arguments), "risk_register": [{"risk": string, "severity": "low"|"med"|"high", "mitigation": string}] (2-4 items), "steelman": string (the strongest one-sentence case FOR the idea)}`,
    user: `${ctxBlock(ctx)}\n\nReturn the JSON now.`,
  }),
  historian: (ctx) => ({
    model: AGENT_META.historian.model,
    system: `You are the VOXEMBLY Historian. Compare the current thoughtform against the speaker's RELATED PAST THOUGHTFORMS. Surface repetition ("you already said this on …"), contradictions, and how thinking evolved. If there is no related history, say so plainly in the headline. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[], "related": [{"commit": 7-char-hash, "when": string, "why": string}], "contradiction": string|null}`,
    user: `${ctxBlock(ctx)}\n\nReturn the JSON now.`,
  }),
  scheduler: (ctx) => ({
    model: AGENT_META.scheduler.model,
    system: `You are the VOXEMBLY Scheduler. Extract every date/time expression (relative or absolute) from the thoughtform and normalise to ISO-8601 with timezone offset, resolving relative phrases against "Now". Also propose one reminder per actionable item. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[], "schedule": [{"title": string, "iso": ISO-8601 string, "human": string}]}`,
    user: `${ctxBlock(ctx)}\n\nReturn the JSON now.`,
  }),
  emotion_curator: (ctx) => ({
    model: AGENT_META.emotion_curator.model,
    system: `You are the VOXEMBLY Emotion Curator. Read valence (-1..1) and arousal (0..1) from the verbatim transcript (word choice, hedging, intensity). Offer ONE gentle, non-clinical supportive reframe and one tiny next step. Never diagnose. ${BASE_RULES}
Schema: {"headline": string, "bullets": string[] (2-3), "valence": number, "arousal": number, "reframe": string}`,
    user: `${ctxBlock(ctx)}\n\nReturn the JSON now.`,
  }),
};

function normalizeOutput(agent: AgentKind, raw: unknown, fallbackRaw: string): AgentOutput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const out: AgentOutput = {
    headline: str(r.headline, `${AGENT_META[agent].name} finished`),
    bullets: arr<unknown>(r.bullets).map((b) => (typeof b === "string" ? b : JSON.stringify(b))).slice(0, 6),
    raw: Object.keys(r).length ? undefined : fallbackRaw.slice(0, 1200),
  };
  if (agent === "researcher") out.citations = arr<{ title: string; url: string }>(r.citations).filter((c) => c?.url).slice(0, 8);
  if (agent === "devils_advocate") {
    out.risk_register = arr<{ risk: string; severity: string; mitigation: string }>(r.risk_register)
      .filter((x) => x?.risk)
      .map((x) => ({ risk: x.risk, severity: (["low", "med", "high"].includes(x.severity) ? x.severity : "med") as "low" | "med" | "high", mitigation: x.mitigation ?? "" }))
      .slice(0, 5);
    if (r.steelman) out.bullets.push(`Steelman: ${str(r.steelman)}`);
  }
  if (agent === "historian") {
    out.related = arr<{ commit: string; when: string; why: string }>(r.related).filter((x) => x?.commit).slice(0, 5);
    if (r.contradiction && typeof r.contradiction === "string") out.bullets.unshift(`Contradiction: ${r.contradiction}`);
  }
  if (agent === "scheduler") out.schedule = arr<{ title: string; iso: string; human: string }>(r.schedule).filter((x) => x?.iso && !Number.isNaN(Date.parse(x.iso))).slice(0, 6);
  if (agent === "executor")
    out.actions = arr<Record<string, unknown>>(r.actions)
      .filter((a) => a?.title)
      .map((a) => ({
        kind: (["calendar", "reminder", "message", "pr_draft", "note", "search", "other"].includes(String(a.kind)) ? a.kind : "other") as "other",
        title: String(a.title),
        when: a.when ? String(a.when) : null,
        target: a.target ? String(a.target) : null,
        payload: a.payload ? String(a.payload) : null,
        status: "proposed" as const,
      }))
      .slice(0, 6);
  if (agent === "emotion_curator") {
    out.valence = typeof r.valence === "number" ? Math.max(-1, Math.min(1, r.valence)) : 0;
    out.arousal = typeof r.arousal === "number" ? Math.max(0, Math.min(1, r.arousal)) : 0.3;
    if (r.reframe) out.bullets.push(`Reframe: ${str(r.reframe)}`);
  }
  return out;
}

export async function runAgent(agent: AgentKind, ctx: AgentContext): Promise<AgentRunResult> {
  const t0 = performance.now();
  try {
    let extra: string | undefined;
    let hits: SearchHit[] = [];
    if (agent === "researcher") {
      const q = ctx.compiled.title.length > 8 ? ctx.compiled.title : ctx.compiled.polished_text.slice(0, 120);
      const sr = await webSearch(q);
      hits = sr.hits;
      extra = formatHitsForPrompt(hits);
    }
    const p = PROMPTS[agent](ctx, extra);
    const res = await chat({
      model: p.model,
      json: true,
      temperature: agent === "devils_advocate" ? 0.5 : 0.2,
      max_tokens: 900,
      messages: [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
    });
    const parsed = extractJSON(res.content);
    const output = normalizeOutput(agent, parsed, res.content);
    // Backfill citations from the actual hits so URLs are never hallucinated.
    if (agent === "researcher" && hits.length) {
      const valid = new Set(hits.map((h) => h.url));
      const cited = (output.citations ?? []).filter((c) => valid.has(c.url));
      output.citations = cited.length ? cited : hits.slice(0, 4).map((h) => ({ title: h.title, url: h.url }));
    }
    return { agent, model: res.model, provider: res.provider, status: "done", output, latency_ms: Math.round(performance.now() - t0), hops: res.hops };
  } catch (e) {
    const paused = e instanceof LLMPausedError;
    return {
      agent,
      model: AGENT_META[agent].model,
      provider: "local",
      status: paused ? "paused" : "error",
      error: paused ? "Council paused — all LLM providers are rate-limited. Retry shortly." : (e as Error).message,
      latency_ms: Math.round(performance.now() - t0),
    };
  }
}

/** Consensus pass: fold all agent outputs into an updated polished text + summary (Flow F). */
export async function synthesizeCouncil(ctx: AgentContext, runs: AgentRunResult[]) {
  const done = runs.filter((r) => r.status === "done" && r.output);
  if (!done.length) return null;
  const t0 = performance.now();
  try {
    const res = await chat({
      model: GROQ_MODELS.multilingual,
      json: true,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: `You are the VOXEMBLY Council Synthesizer. Given the speaker's thoughtform and several specialist agent critiques, produce a consensus. ${BASE_RULES}
Schema: {"consensus": string (≤ 400 chars, first person, actionable), "verdict": "proceed"|"proceed_with_caution"|"reconsider", "next_steps": string[] (2-4), "polished_text": string (an improved version of the speaker's polished text that incorporates the council's corrections, same language, ≤ 300 chars)}`,
        },
        {
          role: "user",
          content: `${ctxBlock(ctx)}\n\nAGENT OUTPUTS\n${done
            .map((r) => `## ${AGENT_META[r.agent].name} (${r.model})\n${r.output!.headline}\n${r.output!.bullets.map((b) => "- " + b).join("\n")}`)
            .join("\n\n")}\n\nReturn the JSON now.`,
        },
      ],
    });
    const j = extractJSON<{ consensus: string; verdict: string; next_steps: string[]; polished_text: string }>(res.content);
    if (!j) return null;
    return {
      consensus: String(j.consensus ?? ""),
      verdict: (["proceed", "proceed_with_caution", "reconsider"].includes(j.verdict) ? j.verdict : "proceed_with_caution") as "proceed" | "proceed_with_caution" | "reconsider",
      next_steps: Array.isArray(j.next_steps) ? j.next_steps.map(String).slice(0, 4) : [],
      polished_text: String(j.polished_text ?? ctx.compiled.polished_text).slice(0, 400),
      model: res.model,
      provider: res.provider,
      latency_ms: Math.round(performance.now() - t0),
    };
  } catch {
    return null;
  }
}
