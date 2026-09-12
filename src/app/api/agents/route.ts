/**
 * POST /api/agents — the Agent Council (Flow F).
 *
 * Streams NDJSON so each agent card fills in the moment its model returns, instead of the user
 * waiting for the slowest one. Each agent runs on a DIFFERENT free Groq model; on 429 the client
 * round-robins to the next model, then to the AssemblyAI LLM Gateway, then reports "Council paused".
 * A final `synthesis` event carries the consensus verdict + improved polished_text.
 */
import { AGENT_META, runAgent, synthesizeCouncil, type AgentContext, type AgentRunResult } from "@/lib/kernel/agents";
import { AGENTS, type AgentKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  agents?: string[];
  context?: Partial<AgentContext>;
  synthesize?: boolean;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const ctx = body.context ?? {};
  if (!ctx.compiled) {
    return new Response(JSON.stringify({ error: "`context.compiled` is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const requested = (body.agents ?? ctx.compiled.suggested_agents ?? []).filter((a): a is AgentKind => (AGENTS as readonly string[]).includes(String(a)));
  const fleet = [...new Set(requested)].slice(0, 6);
  if (!fleet.length) {
    return new Response(JSON.stringify({ error: "No valid agents requested" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const full: AgentContext = {
    compiled: ctx.compiled,
    raw_text: ctx.raw_text ?? "",
    related: Array.isArray(ctx.related) ? ctx.related.slice(0, 8) : [],
    knownNodes: Array.isArray(ctx.knownNodes) ? ctx.knownNodes.slice(0, 60) : [],
    domain: ctx.domain,
    project: ctx.project ?? null,
    nowISO: ctx.nowISO ?? new Date().toISOString(),
    timezone: ctx.timezone,
    language: ctx.language,
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      send({ type: "start", agents: fleet.map((a) => ({ agent: a, ...AGENT_META[a] })), at: Date.now() });

      // All agents run in parallel — different models, so no single rate limit serialises them.
      const results: AgentRunResult[] = [];
      await Promise.all(
        fleet.map(async (agent) => {
          send({ type: "running", agent, model: AGENT_META[agent].model });
          try {
            const r = await runAgent(agent, full);
            results.push(r);
            send({ type: "result", ...r });
          } catch (e) {
            const failed: AgentRunResult = {
              agent,
              model: AGENT_META[agent].model,
              provider: "local",
              status: "error",
              error: (e as Error).message,
              latency_ms: 0,
            };
            results.push(failed);
            send({ type: "result", ...failed });
          }
        }),
      );

      if (body.synthesize !== false && results.some((r) => r.status === "done")) {
        send({ type: "synthesizing" });
        const synth = await synthesizeCouncil(full, results);
        send({ type: "synthesis", synthesis: synth });
      }

      send({ type: "done", at: Date.now(), paused: results.every((r) => r.status === "paused") });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
