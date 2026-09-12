/**
 * Embeddings — $0 ladder.
 *  1. Jina Embeddings v4 (`jina-embeddings-v4`, hosted, 1M tokens/month free) — server route /api/embed
 *  2. In-browser bge-small-en-v1.5 via Transformers.js (lazy-loaded from CDN, never bundled) — see client/embed.ts
 *  3. Deterministic hashed n-gram embedding (256-d) — always available, keeps k-NN retrieval alive at $0.
 *
 * All vectors are L2-normalised so cosine == dot product. Vectors of different models are never compared:
 * the Twin stores `embedding_model` next to each vector and re-embeds the query with the same model.
 */

export const EMBED_MODELS = {
  jina: "jina-embeddings-v4",
  local: "bge-small-en-v1.5",
  hash: "hash-ngram-256",
} as const;
export type EmbedModel = (typeof EMBED_MODELS)[keyof typeof EMBED_MODELS];

export const JINA_URL = "https://api.jina.ai/v1/embeddings";
export const JINA_DIMS = 1024; // Matryoshka truncation keeps pgvector rows small; v4 supports 128..2048

export function l2(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** FNV-1a 32-bit — stable across JS runtimes. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hashed word + character-trigram embedding. Language-agnostic, 256-d, deterministic. */
export function hashEmbed(text: string, dims = 256): number[] {
  const v = new Array(dims).fill(0);
  const norm = text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = norm.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const h = fnv1a("w:" + w);
    v[h % dims] += 1.5 * (h & 1 ? 1 : -1);
    const padded = `^${w}$`;
    for (let i = 0; i + 3 <= padded.length; i++) {
      const g = fnv1a("g:" + padded.slice(i, i + 3));
      v[g % dims] += g & 1 ? 1 : -1;
    }
  }
  for (let i = 0; i + 1 < words.length; i++) {
    const b = fnv1a("b:" + words[i] + " " + words[i + 1]);
    v[b % dims] += 0.8 * (b & 1 ? 1 : -1);
  }
  return l2(v);
}

export interface EmbedResult {
  vectors: number[][];
  model: EmbedModel;
  provider: "jina" | "local" | "hash";
  latency_ms: number;
  usage_tokens?: number;
  degraded_reason?: string;
}

/** Server-side: Jina v4 with hashed fallback. */
export async function embedServer(texts: string[], task: "retrieval.query" | "retrieval.passage" | "text-matching" = "text-matching"): Promise<EmbedResult> {
  const t0 = performance.now();
  const key = process.env.JINA_API_KEY;
  const clean = texts.map((t) => String(t ?? "").slice(0, 8000));
  if (key) {
    try {
      const res = await fetch(JINA_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: EMBED_MODELS.jina,
          task,
          dimensions: JINA_DIMS,
          normalized: true,
          input: clean.map((text) => ({ text })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status === 402) throw Object.assign(new Error("jina_quota"), { status: res.status });
      if (!res.ok) throw new Error(`jina ${res.status}`);
      const j = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage?: { total_tokens?: number } };
      const vectors = j.data.sort((a, b) => a.index - b.index).map((d) => l2(d.embedding));
      return { vectors, model: EMBED_MODELS.jina, provider: "jina", latency_ms: Math.round(performance.now() - t0), usage_tokens: j.usage?.total_tokens };
    } catch (e) {
      return { vectors: clean.map((t) => hashEmbed(t)), model: EMBED_MODELS.hash, provider: "hash", latency_ms: Math.round(performance.now() - t0), degraded_reason: (e as Error).message };
    }
  }
  return { vectors: clean.map((t) => hashEmbed(t)), model: EMBED_MODELS.hash, provider: "hash", latency_ms: Math.round(performance.now() - t0), degraded_reason: "JINA_API_KEY not set" };
}
