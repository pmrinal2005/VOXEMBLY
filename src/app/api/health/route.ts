import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "voxembly",
    time: Date.now(),
    config: {
      assemblyai: Boolean(process.env.ASSEMBLYAI_API_KEY),
      groq: Boolean(process.env.GROQ_API_KEY),
      supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      jina: Boolean(process.env.JINA_API_KEY),
      neo4j: Boolean(process.env.NEO4J_URI),
      region: process.env.NEXT_PUBLIC_AAI_REGION ?? "global",
    },
  });
}
