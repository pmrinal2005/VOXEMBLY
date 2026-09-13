import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { groqConfigured } from "@/lib/llm/groq";
import { LIMITS } from "@/lib/dictation/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const assemblyai = Boolean(process.env.ASSEMBLYAI_API_KEY);
  const groq = groqConfigured();
  const jina = Boolean(process.env.JINA_API_KEY);
  const region = process.env.NEXT_PUBLIC_AAI_REGION || "global";
  const degraded: string[] = [];
  if (!assemblyai) degraded.push("assemblyai (simulated transcripts)");
  if (!groq) degraded.push("groq (heuristic compiler)");

  return NextResponse.json({
    ok: true,
    service: "voxembly",
    time: Date.now(),
    degraded,
    dictation: {
      configured: true,
      model: LIMITS.MODEL,
      region,
      endpoint: assemblyai ? "sync.assemblyai.com/transcribe" : "simulated",
    },
    llm: {
      groq_configured: groq,
      gateway_configured: false,
      compile_fallback: "local heuristic",
      cooling: [],
    },
    embeddings: {
      jina_configured: jina,
      fallback: "local hash embeddings",
    },
    search: {
      searxng: Boolean(process.env.SEARXNG_URL),
      brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
      fallback: "DuckDuckGo + Wikipedia",
    },
    persistence: {
      mode: "postgres+indexeddb",
      publish_shared: true,
    },
  });
}
