import { NextResponse } from "next/server";
import type { Thoughtform } from "@/lib/types";

export const runtime = "nodejs";

// In-memory publish registry (resets on cold start). For durable sharing the
// client also encodes the Thoughtform into the /t/[hash] URL as a fallback,
// and Supabase can be wired in later. This keeps the demo $0 and dependency-free.
const REGISTRY = new Map<string, Thoughtform>();

export async function POST(req: Request) {
  const tf = (await req.json().catch(() => null)) as Thoughtform | null;
  if (!tf || !tf.commit_hash) {
    return NextResponse.json({ error: "invalid thoughtform" }, { status: 400 });
  }
  REGISTRY.set(tf.commit_hash, tf);
  return NextResponse.json({
    ok: true,
    url: `/t/${tf.commit_hash}`,
    hash: tf.commit_hash,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const hash = url.searchParams.get("hash");
  if (!hash) return NextResponse.json({ error: "missing hash" }, { status: 400 });
  const tf = REGISTRY.get(hash);
  if (!tf) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({ found: true, thoughtform: tf });
}
