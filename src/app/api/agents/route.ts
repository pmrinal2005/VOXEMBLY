import { NextRequest, NextResponse } from "next/server";
import { runCouncil } from "@/lib/kernel/agents";
import { chat, groqConfigured } from "@/lib/llm/groq";
import type { AgentKind } from "@/lib/types";
import { ALL_AGENTS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Convene the Agent Council over a thought; returns per-agent outputs + synthesis. */
export async function POST(req: NextRequest) {
  let body: { thought?: string; agents?: AgentKind[]; context?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const thought = (body.thought || "").trim();
  if (!thought) return NextResponse.json({ error: "missing thought" }, { status: 400 });

  const agents = (body.agents && body.agents.length ? body.agents : ALL_AGENTS.slice(0, 4)).filter(
    (a) => ALL_AGENTS.includes(a),
  );
  const context = body.context || "";

  const events = await runCouncil(agents, thought, context);

  // Synthesize a consensus update from the debate.
  let synthesis = "";
  if (groqConfigured()) {
    try {
      const debate = events.map((e) => `${e.agent} (${e.model}): ${e.output}`).join("\n\n");
      const { text } = await chat(
        [
          {
            role: "system",
            content:
              "You are the VOXEMBLY Council Synthesizer. Given a thought and the specialists' critiques, produce ONE consensus recommendation in <=60 words. Be decisive.",
          },
          { role: "user", content: `Thought: ${thought}\n\nDebate:\n${debate}` },
        ],
        { temperature: 0.4, maxTokens: 200 },
      );
      synthesis = text.trim();
    } catch {
      synthesis = "";
    }
  }
  if (!synthesis) {
    synthesis =
      "Consensus: proceed, but de-risk the top concern raised by the Devil's Advocate and set a concrete follow-up. (Simulated synthesis — set GROQ_API_KEY for live consensus.)";
  }

  return NextResponse.json({ events, synthesis });
}
