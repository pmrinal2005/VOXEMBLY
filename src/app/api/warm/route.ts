import { NextRequest, NextResponse } from "next/server";
import { getDictationClient } from "@/lib/dictation/client";
import type { AaiRegion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pre-warm the Dictation connection (fired on key-down). Moves DNS/TCP/TLS off
 * the critical path so the transcribe POST only pays upload + inference.
 */
export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get("region") as AaiRegion) || undefined;
  const client = getDictationClient();
  if (!client.configured) {
    return NextResponse.json({
      ok: false,
      ms: 0,
      region: region || "global",
      endpoint: "",
      reason: "no_api_key",
      simulated: true,
    });
  }
  const result = await client.warm(region);
  return NextResponse.json(result);
}
