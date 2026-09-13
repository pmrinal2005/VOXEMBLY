import { NextRequest, NextResponse } from "next/server";
import { getPublished, putPublished } from "@/lib/store/published";
import type { PublishedThoughtform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Publish a Thoughtform to a read-only public artifact at /t/[hash]. */
export async function POST(req: NextRequest) {
  let body: Partial<PublishedThoughtform>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.thoughtform || !body.thoughtform.commit_hash) {
    return NextResponse.json({ error: "missing thoughtform" }, { status: 400 });
  }
  const hash = body.thoughtform.commit_hash;
  const record: PublishedThoughtform = {
    hash,
    thoughtform: body.thoughtform,
    agentRuns: body.agentRuns || [],
    graphSnapshot: body.graphSnapshot || { nodes: [], edges: [] },
    publishedAt: Date.now(),
    author: body.author || "Anonymous",
  };
  await putPublished(record);
  return NextResponse.json({ ok: true, hash, url: `/t/${hash}` });
}

/** Fetch a published artifact (used by the public page as a fallback). */
export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash) return NextResponse.json({ error: "missing hash" }, { status: 400 });
  const record = await getPublished(hash);
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(record);
}
