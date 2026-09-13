import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Embeddings endpoint. Uses Jina if configured; otherwise returns a $0
// deterministic hashed vector so pgvector-style similarity still works in demo.
function hashedVector(text: string, dims = 256): number[] {
  const v = new Array(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    v[h % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400 });

  const jina = process.env.JINA_API_KEY;
  if (jina) {
    try {
      const res = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: {
          authorization: `Bearer ${jina}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "jina-embeddings-v4",
          input: [text],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { embedding: number[] }[] };
        const embedding = data.data?.[0]?.embedding;
        if (embedding) return NextResponse.json({ embedding, provider: "jina" });
      }
    } catch {
      /* fall through to local */
    }
  }

  return NextResponse.json({ embedding: hashedVector(text), provider: "local-hash" });
}
