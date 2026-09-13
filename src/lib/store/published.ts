import type { PublishedThoughtform } from "@/lib/types";
import { db } from "@/db";
import { publishedThoughtforms } from "@/db/schema";
import { eq } from "drizzle-orm";

const memory = new Map<string, PublishedThoughtform>();

export async function putPublished(p: PublishedThoughtform): Promise<void> {
  memory.set(p.hash, p);
  try {
    await db
      .insert(publishedThoughtforms)
      .values({
        hash: p.hash,
        author: p.author || "Anonymous",
        publishedAt: new Date(p.published_at),
        thoughtform: p.thoughtform as unknown as Record<string, unknown>,
        snapshot: p.snapshot as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: publishedThoughtforms.hash,
        set: {
          author: p.author || "Anonymous",
          publishedAt: new Date(p.published_at),
          thoughtform: p.thoughtform as unknown as Record<string, unknown>,
          snapshot: p.snapshot as unknown as Record<string, unknown>,
        },
      });
  } catch (e) {
    console.warn("[voxembly] published persist failed", e);
  }
}

export async function getPublished(hash: string): Promise<PublishedThoughtform | null> {
  if (memory.has(hash)) return memory.get(hash)!;
  for (const [k, v] of memory) {
    if (k.startsWith(hash)) return v;
  }
  try {
    const rows = await db
      .select()
      .from(publishedThoughtforms)
      .where(eq(publishedThoughtforms.hash, hash))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const rec: PublishedThoughtform = {
      hash: row.hash,
      author: row.author,
      published_at: row.publishedAt.getTime(),
      thoughtform: row.thoughtform as PublishedThoughtform["thoughtform"],
      snapshot: row.snapshot as PublishedThoughtform["snapshot"],
    };
    memory.set(rec.hash, rec);
    return rec;
  } catch {
    return null;
  }
}
