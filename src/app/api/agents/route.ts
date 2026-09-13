import { NextRequest } from "next/server";
import { runAgent } from "@/lib/kernel/agents";
import { chat, groqConfigured } from "@/lib/llm/groq";
import type { AgentKind } from "@/lib/types";
import { ALL_AGENTS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { thought?: string; agents?: AgentKind[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }
  const thought = (body.thought || "").trim();
  if (!thought) return new Response(JSON.stringify({ error: "missing thought" }), { status: 400 });
  const agents = (body.agents?.length ? body.agents : ALL_AGENTS.slice(0, 4)).filter((a) =>
    ALL_AGENTS.includes(a),
  );
  const context = body.context || "";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      let paused = false;
      const results: { agent: string; model: string; output: string }[] = [];
      await Promise.all(
        agents.map(async (agent) => {
          try {
            const r = await runAgent(agent, thought, context);
            results.push({ agent, model: r.model, output: r.output.headline });
            send({
              type: "result",
              agent: r.agent,
              model: r.model,
              provider: r.provider,
              status: "done",
              output: r.output,
              latency_ms: r.latency_ms,
            });
          } catch (e) {
            paused = true;
            send({
              type: "result",
              agent,
              model: "",
              provider: "groq",
              status: "error",
              error: String(e),
              latency_ms: 0,
            });
          }
        }),
      );
      send({ type: "synthesizing" });
      let synthesis = {
        consensus:
          "Proceed, but de-risk the top concern raised by the Devil's Advocate and set a concrete follow-up.",
        verdict: "proceed_with_caution" as const,
        next_steps: ["Write the decision down", "Assign an owner", "Revisit in 48h"],
        polished_text: thought,
        model: "heuristic",
        provider: "local",
        latency_ms: 0,
      };
      if (groqConfigured()) {
        const t0 = Date.now();
        try {
          const debate = results.map((e) => `${e.agent} (${e.model}): ${e.output}`).join("\n\n");
          const { text, model } = await chat(
            [
              {
                role: "system",
                content:
                  'You are the VOXEMBLY Council Synthesizer. Return JSON {consensus (<=60 words), verdict: "proceed"|"proceed_with_caution"|"reconsider", next_steps: string[], polished_text}. Be decisive.',
              },
              { role: "user", content: `Thought: ${thought}\n\nDebate:\n${debate}` },
            ],
            { temperature: 0.4, maxTokens: 280, json: true },
          );
          const parsed = JSON.parse(text) as Partial<typeof synthesis>;
          synthesis = {
            consensus: parsed.consensus || synthesis.consensus,
            verdict: parsed.verdict || synthesis.verdict,
            next_steps: parsed.next_steps || synthesis.next_steps,
            polished_text: parsed.polished_text || thought,
            model,
            provider: "groq",
            latency_ms: Date.now() - t0,
          };
        } catch {
          /* keep heuristic */
        }
      }
      send({ type: "synthesis", synthesis });
      send({ type: "done", paused });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
