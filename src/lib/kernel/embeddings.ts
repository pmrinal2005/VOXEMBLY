// ============================================================================
// VOXEMBLY — Embeddings (SERVER-SIDE). Jina Embeddings v4 (primary) with a
// deterministic $0 hash-embedding fallback so semantic retrieval works with no
// keys and no network (the plan's "true $0" guarantee).
// ============================================================================

import { fnv1a } from "@/lib/utils";

const DIM = 256;

export async function embed(text: string): Promise<{ vector: number[]; source: string }> {
  const key = process.env.JINA_API_KEY;
  if (key) {
    try {
      const res = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "jina-embeddings-v3",
          task: "text-matching",
          input: [text.slice(0, 8000)],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const json: any = await res.json();
        const vec = json?.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length) return { vector: vec, source: "jina" };
      }
    } catch {
      /* fall through to hash embed */
    }
  }
  return { vector: hashEmbed(text), source: "hash" };
}

/**
 * Deterministic bag-of-words hash embedding. Not semantically rich, but stable,
 * fast, and free — good enough for the demo's k-NN retrieval and DMR probes.
 */
export function hashEmbed(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  for (const tok of tokens) {
    const h = fnv1a(tok);
    const idx = h % DIM;
    vec[idx] += 1;
    // second hash bucket for a bit more spread
    vec[(h >>> 8) % DIM] += 0.5;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
