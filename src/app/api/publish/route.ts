/**
 * POST /api/publish — publish a Thoughtform to a public /t/{hash} artifact (Flow H).
 * GET  /api/publish?hash= — fetch a published artifact.
 *
 * With SUPABASE_SERVICE_ROLE_KEY the artifact is stored in Postgres so the link works from any
 * browser. Without it, publishing still succeeds locally (IndexedDB) and the page renders for the
 * author — the route reports `shared: false` so the UI can say so honestly.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PublishedThoughtform } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "published_thoughtforms";

export async function POST(req: Request) {
  let body: { artifact?: PublishedThoughtform };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const art = body.artifact;
  if (!art?.hash || !art.thoughtform) return NextResponse.json({ error: "`artifact.hash` and `artifact.thoughtform` are required" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) {
    return NextResponse.json({ ok: true, shared: false, hash: art.hash, reason: "SUPABASE_SERVICE_ROLE_KEY not configured — artifact saved locally only" });
  }

  const { error } = await sb.from(TABLE).upsert(
    {
      hash: art.hash,
      author: art.author ?? "anonymous",
      published_at: new Date(art.published_at ?? Date.now()).toISOString(),
      thoughtform: art.thoughtform,
      snapshot: art.snapshot ?? null,
    },
    { onConflict: "hash" },
  );

  if (error) return NextResponse.json({ ok: false, shared: false, hash: art.hash, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, shared: true, hash: art.hash });
}

export async function GET(req: Request) {
  const hash = new URL(req.url).searchParams.get("hash");
  if (!hash) return NextResponse.json({ error: "`hash` query param is required" }, { status: 400 });

  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ found: false, shared: false, reason: "Shared publishing is not configured" }, { status: 404 });

  const { data, error } = await sb.from(TABLE).select("*").eq("hash", hash).maybeSingle();
  if (error) return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ found: false }, { status: 404 });

  return NextResponse.json({
    found: true,
    shared: true,
    artifact: {
      hash: data.hash,
      author: data.author,
      published_at: new Date(data.published_at).getTime(),
      thoughtform: data.thoughtform,
      snapshot: data.snapshot,
    } satisfies PublishedThoughtform,
  });
}
