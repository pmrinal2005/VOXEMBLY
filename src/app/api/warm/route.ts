import { NextRequest, NextResponse } from "next/server";
import { getDictationClient } from "@/lib/dictation/client";
import type { AaiRegion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const region = (req.nextUrl.searchParams.get("region") as AaiRegion) || undefined;
  const client = getDictationClient();
  if (!client.configured) {
    return NextResponse.json({
      ok: true,
      ms: 0,
      region: region || "global",
      endpoint: "simulated",
      reason: "no_api_key",
      simulated: true,
    });
  }
  const result = await client.warm(region);
  return NextResponse.json(result);
}
