import { NextRequest, NextResponse } from "next/server";
import { embed } from "@/lib/kernel/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400 });
  const { vector, model } = await embed(text);
  return NextResponse.json({ vector, model, dim: vector.length });
}
