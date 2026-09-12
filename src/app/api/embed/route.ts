/**
 * POST /api/embed — Jina Embeddings v4 with a deterministic hashed-n-gram fallback.
 * Vectors are L2-normalised and tagged with their model; the Twin never compares across models.
 */
import { NextResponse } from "next/server";
import { embedServer } from "@/lib/kernel/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { texts?: unknown; task?: "retrieval.query" | "retrieval.passage" | "text-matching" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t ?? "")).filter(Boolean).slice(0, 32) : [];
  if (!texts.length) return NextResponse.json({ error: "`texts` must be a non-empty array" }, { status: 400 });

  const result = await embedServer(texts, body.task ?? "text-matching");
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
