import { NextRequest, NextResponse } from "next/server";
import { getPublished, putPublished } from "@/lib/store/published";
import type { PublishedThoughtform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { artifact?: PublishedThoughtform } & Partial<PublishedThoughtform>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const artifact = body.artifact || (body as PublishedThoughtform);
  if (!artifact?.thoughtform?.commit_hash) {
    return NextResponse.json({ error: "missing thoughtform" }, { status: 400 });
  }
  const record: PublishedThoughtform = {
    hash: artifact.hash || artifact.thoughtform.commit_hash,
    thoughtform: artifact.thoughtform,
    snapshot: artifact.snapshot || { nodes: {}, edges: {} },
    author: artifact.author || "Anonymous",
    published_at: artifact.published_at || Date.now(),
  };
  await putPublished(record);
  return NextResponse.json({ ok: true, hash: record.hash, url: `/t/${record.hash}`, shared: true });
}

export async function GET(req: NextRequest) {
  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash) return NextResponse.json({ error: "missing hash" }, { status: 400 });
  const record = await getPublished(hash);
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(record);
}
