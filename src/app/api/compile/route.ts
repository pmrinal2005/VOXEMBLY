import { NextRequest, NextResponse } from "next/server";
import { compileTranscript } from "@/lib/kernel/compile";

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
  const result = await compileTranscript(text);
  return NextResponse.json(result);
}
