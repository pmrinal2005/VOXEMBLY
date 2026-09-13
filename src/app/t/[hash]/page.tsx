import type { Metadata } from "next";
import Link from "next/link";
import { getPublished } from "@/lib/store/published";
import { shortHash, truncate } from "@/lib/utils";
import { Artifact, LocalArtifactFallback } from "@/components/artifact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const art = await getPublished(hash);
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
  };
}

export default async function ThoughtformPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;
  const artifact = await getPublished(hash);

  return (
    <main className="grid-bg min-h-dvh" id="main">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-14">
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
