// ============================================================================
// VOXEMBLY — Embeddings. Jina v3/v4 primary, deterministic hash fallback.
// ============================================================================

import { fnv1a } from "@/lib/utils";

const DIM = 256;

export async function embed(text: string): Promise<{ vector: number[]; model: string }> {
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
        const json: { data?: { embedding?: number[] }[] } = await res.json();
        const vec = json?.data?.[0]?.embedding;
        if (Array.isArray(vec) && vec.length) return { vector: vec, model: "jina-embeddings-v3" };
      }
    } catch {
      /* fall through */
    }
  }
  return { vector: hashEmbed(text), model: "hash-v1" };
}

export function hashEmbed(text: string): number[] {
  const vec = new Array(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  for (const tok of tokens) {
    const h = fnv1a(tok);
    vec[h % DIM] += 1;
    vec[(h >>> 8) % DIM] += 0.5;
  }
  const norm = Math.sqrt(vec.reduce((a, v) => a + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
