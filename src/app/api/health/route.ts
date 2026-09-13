import { NextResponse } from "next/server";
import { groqConfigured } from "@/lib/llm/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "voxembly",
    time: Date.now(),
    config: {
      assemblyai: Boolean(process.env.ASSEMBLYAI_API_KEY),
      groq: groqConfigured(),
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      jina: Boolean(process.env.JINA_API_KEY),
      region: process.env.NEXT_PUBLIC_AAI_REGION || "global",
    },
  });
}
