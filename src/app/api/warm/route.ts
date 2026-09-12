/**
 * GET /api/warm — fires AssemblyAI's `GET /warm` (unauthenticated no-op) so the DNS + TCP + TLS
 * handshake is off the critical path before /transcribe runs.
 *
 * Called by the client on key-DOWN (and on route change). Because Node reuses one undici agent per
 * process, the pooled connection warmed here is the one /api/transcribe reuses — which is exactly the
 * documented requirement ("a /transcribe request sent shortly afterward through the same client reuses it").
 */
import { NextResponse } from "next/server";
import { getDictationClient, SYNC_ENDPOINTS } from "@/lib/dictation/client";
import type { SyncRegion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("region") ?? "").toLowerCase();
  const region: SyncRegion = raw === "us" || raw === "eu" || raw === "global" ? raw : (process.env.ASSEMBLYAI_SYNC_REGION as SyncRegion) || "global";

  if (!process.env.ASSEMBLYAI_API_KEY) {
    // /warm needs no key, but warming a pool we can't use is pointless — report honestly.
    return NextResponse.json(
      { ok: false, region, endpoint: SYNC_ENDPOINTS[region], ms: 0, reason: "ASSEMBLYAI_API_KEY not configured" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await getDictationClient().warm(region);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, region, endpoint: SYNC_ENDPOINTS[region], ms: 0, reason: (e as Error).message }, { headers: { "Cache-Control": "no-store" } });
  }
}
