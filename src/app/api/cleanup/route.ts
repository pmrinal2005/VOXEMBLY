import { NextResponse } from "next/server";
import { groqChat, extractJson } from "@/lib/groq-client";
import { GROQ_MODELS } from "@/lib/groq-client";
import {
  CLEANUP_SYSTEM_PROMPT,
  dispatchAgents,
  type CleanupResult,
} from "@/lib/intent-kernel";
import type { IntentType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Local heuristic fallback so the demo works even with no GROQ key.
function heuristicCleanup(text: string): CleanupResult {
  const cleaned = text
    .replace(/\b(um+|uh+|er+|like|you know|i mean|sort of|kind of)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*(so|well|okay|ok)\b[,:]?\s*/i, "")
    .trim();
  const lower = text.toLowerCase();
  let intent: IntentType = "note";
  if (/\b(decide|decision|should we|vs\.?|versus)\b/.test(lower)) intent = "decision";
  else if (/\b(todo|task|assign|move .* to|remind)\b/.test(lower)) intent = "task";
  else if (/\?/.test(text) || /\b(how|why|what|when|where)\b/.test(lower)) intent = "question";
  else if (/\b(idea|what if|imagine|concept)\b/.test(lower)) intent = "idea";
  else if (/\b(meeting|sync|standup|call)\b/.test(lower)) intent = "meeting";
  else if (/\b(feel|excited|worried|anxious|happy|sad)\b/.test(lower)) intent = "emotion";

  const caps = Array.from(text.matchAll(/\b([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)?)\b/g)).map(
    (m) => m[1]
  );
  const entities = Array.from(new Set(caps)).slice(0, 6);

  return {
    intent,
    polished_text: cleaned.slice(0, 300) || text.slice(0, 300),
    title: (cleaned || text).slice(0, 48),
    entities,
    actions: [],
    sentiment: /\b(worried|anxious|risk|problem|bad)\b/.test(lower)
      ? "negative"
      : /\b(great|excited|love|good|win)\b/.test(lower)
      ? "positive"
      : "neutral",
    graph_mutations: entities.map((e) => ({
      op: "add_node",
      kind: /\s/.test(e) ? "Person" : "Concept",
      label: e,
    })),
    suggested_agents: [],
  };
}

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  let result: CleanupResult;
  let modelUsed = "heuristic";

  if (apiKey) {
    try {
      const { content, model } = await groqChat({
        apiKey,
        model: GROQ_MODELS.fast,
        jsonMode: true,
        temperature: 0.2,
        messages: [
          { role: "system", content: CLEANUP_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      });
      const parsed = extractJson<CleanupResult>(content);
      result = parsed ?? heuristicCleanup(text);
      modelUsed = parsed ? model : "heuristic-fallback";
    } catch {
      result = heuristicCleanup(text);
      modelUsed = "heuristic-fallback";
    }
  } else {
    result = heuristicCleanup(text);
  }

  const agents = dispatchAgents(result.intent, result.suggested_agents);

  return NextResponse.json({ ...result, spawned_agents: agents, model: modelUsed });
}
