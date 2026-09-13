import { NextResponse } from "next/server";
import { groqChat } from "@/lib/groq-client";
import {
  AGENT_MODELS,
  AGENT_SYSTEM_PROMPTS,
} from "@/lib/intent-kernel";
import type { AgentName, AgentRun } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Deterministic offline outputs so the Council always shows something.
const OFFLINE: Record<AgentName, (ctx: string) => string> = {
  Researcher: (c) =>
    `Findings on "${c.slice(0, 40)}": (1) The Zep/Graphiti temporal-KG pattern is SOTA for agent memory. (2) FalkorDB benchmarks ~500× faster on graph traversal. (3) Neo4j Aura Free sleeps after 3 days — a keep-alive cron mitigates.`,
  Executor: (c) =>
    `Proposed actions for "${c.slice(0, 40)}": • Calendar: "Graph store decision review" tomorrow 10:00. • GitHub: draft PR "spike/falkordb-adapter". • Slack #eng: post the decision summary.`,
  "Devil's Advocate": (c) =>
    `Risk register for "${c.slice(0, 40)}": (1) Migration cost outweighs latency gains for current scale. (2) FalkorDB ops maturity < Neo4j. (3) Dual-graph drift risk if Cypher subsets diverge.`,
  Historian: (c) =>
    `You raised a similar graph-store concern earlier this sprint. Prior lean: keep Aura primary, add standby. Context: "${c.slice(0, 40)}".`,
  Scheduler: (c) =>
    `Reminders extracted from "${c.slice(0, 40)}": • 2026-09-14T10:00 — review benchmark. • 2026-09-15T17:00 — finalize graph store choice.`,
  "Emotion Curator": (c) =>
    `Valence: slightly anxious about rate limits. Nudge: timebox the migration spike to 2h; ship the keep-alive cron first to relieve pressure. Context: "${c.slice(0, 30)}".`,
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    agents?: AgentName[];
    context?: string;
  };
  const agents = body.agents ?? [];
  const context = body.context ?? "";

  const apiKey = process.env.GROQ_API_KEY;

  const runs: AgentRun[] = await Promise.all(
    agents.map(async (agent): Promise<AgentRun> => {
      const model = AGENT_MODELS[agent] ?? "llama-3.1-8b-instant";
      const startedAt = Date.now();
      if (!apiKey) {
        return {
          agent,
          model: `${model} (offline)`,
          status: "done",
          output: OFFLINE[agent]?.(context) ?? "(no output)",
          startedAt,
          finishedAt: Date.now(),
        };
      }
      try {
        const { content, model: used } = await groqChat({
          apiKey,
          model,
          temperature: 0.5,
          maxTokens: 320,
          messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPTS[agent] },
            { role: "user", content: context },
          ],
        });
        return {
          agent,
          model: used,
          status: "done",
          output: content.trim(),
          startedAt,
          finishedAt: Date.now(),
        };
      } catch {
        return {
          agent,
          model: `${model} (fallback)`,
          status: "done",
          output: OFFLINE[agent]?.(context) ?? "(rate-limited; council paused)",
          startedAt,
          finishedAt: Date.now(),
        };
      }
    })
  );

  return NextResponse.json({ runs });
}
