/**
 * POST /api/search — the Researcher agent's web tier, also exposed for the "search" voice command.
 * SearXNG → Brave (2k/mo free) → DuckDuckGo + Wikipedia (no key). Always $0.
 */
import { NextResponse } from "next/server";
import { webSearch } from "@/lib/kernel/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "`query` is required" }, { status: 400 });
  return NextResponse.json(await webSearch(query), { headers: { "Cache-Control": "no-store" } });
}
