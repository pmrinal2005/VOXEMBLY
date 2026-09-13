/**
 * Flow H — the public Shareable Thoughtform artifact at /t/{commit_hash}.
 *
 * Two-tier resolution, because publishing must work at $0 with zero accounts:
 *   1. Server: if SUPABASE_SERVICE_ROLE_KEY is configured, the artifact was persisted to Postgres on
 *      publish, so this renders as a real server component — shareable to anyone, indexable, with
 *      proper OG metadata.
 *   2. Client: otherwise the artifact only exists in the author's IndexedDB, so we hand off to a
 *      client fallback that reads it locally. The page then renders for the author and says plainly
 *      that the link is local-only — rather than pretending a share happened.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PublishedThoughtform } from "@/lib/types";
import { shortHash, truncate } from "@/lib/utils";
import { Artifact, LocalArtifactFallback } from "@/components/artifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "published_thoughtforms";

async function fetchArtifact(hash: string): Promise<PublishedThoughtform | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from(TABLE).select("*").eq("hash", hash).maybeSingle();
    if (error || !data) return null;
    return {
      hash: data.hash,
      author: data.author ?? "Anonymous",
      published_at: new Date(data.published_at).getTime(),
      thoughtform: data.thoughtform,
      snapshot: data.snapshot ?? { nodes: [], edges: [], at: Date.now(), branch: "main" },
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ hash: string }> }): Promise<Metadata> {
  const { hash } = await params;
  const art = await fetchArtifact(hash);
  if (!art) {
    return {
      title: `Thoughtform ${shortHash(hash)} — VOXEMBLY`,
      description: "A typed, versioned, executable Thoughtform compiled from one dictation.",
    };
  }
  const c = art.thoughtform.compiled;
  return {
    title: `${c.title} — VOXEMBLY`,
    description: truncate(c.polished_text, 180),
    openGraph: {
      title: c.title,
      description: truncate(c.polished_text, 180),
      type: "article",
      siteName: "VOXEMBLY",
      publishedTime: new Date(art.published_at).toISOString(),
    },
    twitter: { card: "summary_large_image", title: c.title, description: truncate(c.polished_text, 180) },
  };
}

export default async function ThoughtformPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const artifact = await fetchArtifact(hash);

  return (
    <main className="grid-bg min-h-dvh" id="main">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-14">
        {/* brand header */}
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/studio" className="flex items-center gap-2.5 rounded-lg" aria-label="Open the VOXEMBLY Studio">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-vox-cyan to-vox-violet text-sm font-black text-background"
              aria-hidden="true"
            >
              V
            </span>
            <span className="leading-none">
              <span className="block text-sm font-bold tracking-tight">VOXEMBLY</span>
              <span className="block text-[10px] text-muted-foreground">Voice is the new compiler.</span>
            </span>
          </Link>
        </header>

        {artifact ? <Artifact artifact={artifact} shared /> : <LocalArtifactFallback hash={hash} />}
      </div>
    </main>
  );
}
