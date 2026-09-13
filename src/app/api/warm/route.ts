import { NextResponse } from "next/server";
import { warm, type Region } from "@/lib/dictation-client";

export const runtime = "nodejs";

// Pre-warm the AssemblyAI connection pool (fired on key-down).
export async function GET(req: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  const url = new URL(req.url);
  const region = (url.searchParams.get("region") ?? process.env.NEXT_PUBLIC_AAI_REGION ?? "global") as Region;

  if (!apiKey) {
    return NextResponse.json({ warmed: false, reason: "no_api_key" }, { status: 200 });
  }
  const ok = await warm(region, apiKey);
  return NextResponse.json({ warmed: ok, region });
}
