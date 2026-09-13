// ============================================================================
// VOXEMBLY — Published Thoughtform store (SERVER-SIDE).
//
// Persists published artifacts to Supabase when configured; otherwise keeps an
// in-memory map (survives within a single server instance) so /t/[hash] works
// for the live demo without any backend.
// ============================================================================

import type { PublishedThoughtform } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const memory = new Map<string, PublishedThoughtform>();

const TABLE = "published_thoughtforms";

export async function putPublished(p: PublishedThoughtform): Promise<void> {
  memory.set(p.hash, p);
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      await sb.from(TABLE).upsert({
        hash: p.hash,
        payload: p,
        published_at: new Date(p.publishedAt).toISOString(),
        author: p.author,
      });
    } catch {
      /* keep memory copy */
    }
  }
}

export async function getPublished(hash: string): Promise<PublishedThoughtform | null> {
  if (memory.has(hash)) return memory.get(hash)!;
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data } = await sb.from(TABLE).select("payload").eq("hash", hash).single();
      if (data?.payload) {
        memory.set(hash, data.payload as PublishedThoughtform);
        return data.payload as PublishedThoughtform;
      }
    } catch {
      /* not found */
    }
  }
  return null;
}
