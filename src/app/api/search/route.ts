import { NextRequest, NextResponse } from "next/server";
import { webSearch } from "@/lib/kernel/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const query = (body.query || "").trim();
  if (!query) return NextResponse.json({ results: [] });
  const result = await webSearch(query);
  return NextResponse.json({ results: result.hits, provider: result.provider, latency_ms: result.latency_ms });
}
