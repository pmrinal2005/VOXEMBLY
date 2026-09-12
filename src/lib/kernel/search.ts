/**
 * Web search for the Researcher agent — $0 ladder:
 *   SearXNG (self-hosted, SEARXNG_URL) → Brave Search API (2,000/mo free) → DuckDuckGo Instant Answer + HTML (no key).
 * Every provider is normalised into SearchHit[] so the agent prompt never cares which one answered.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  source: "searxng" | "brave" | "duckduckgo" | "wikipedia";
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  provider: SearchHit["source"] | "none";
  latency_ms: number;
  attempts: string[];
}

const TIMEOUT = 6000;

async function searxng(query: string, base: string): Promise<SearchHit[]> {
  const url = `${base.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&language=auto&safesearch=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`searxng ${res.status}`);
  const j = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
  return (j.results ?? []).slice(0, 8).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "", source: "searxng" as const }));
}

async function brave(query: string, key: string): Promise<SearchHit[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const j = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "", source: "brave" as const }));
}

async function duckduckgo(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  // 1. Instant Answer API (JSON, no key)
  try {
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { "User-Agent": "VOXEMBLY/0.1 (+https://github.com/pmrinal2005/VOXEMBLY)" },
    });
    if (res.ok) {
      const j = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
      };
      if (j.AbstractText && j.AbstractURL) hits.push({ title: j.Heading ?? query, url: j.AbstractURL, snippet: j.AbstractText, source: "duckduckgo" });
      for (const t of j.RelatedTopics ?? []) {
        const items = t.Topics ?? [t];
        for (const it of items) {
          if (it.FirstURL && it.Text) hits.push({ title: it.Text.split(" - ")[0].slice(0, 80), url: it.FirstURL, snippet: it.Text, source: "duckduckgo" });
          if (hits.length >= 6) break;
        }
        if (hits.length >= 6) break;
      }
    }
  } catch {
    /* fall through */
  }
  // 2. Wikipedia opensearch as a zero-key knowledge backstop
  if (hits.length < 3) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`,
        { signal: AbortSignal.timeout(TIMEOUT), headers: { "User-Agent": "VOXEMBLY/0.1" } },
      );
      if (res.ok) {
        const j = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
        for (const s of j.query?.search ?? []) {
          hits.push({
            title: s.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
            snippet: s.snippet.replace(/<[^>]+>/g, ""),
            source: "wikipedia",
          });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return hits;
}

export async function webSearch(query: string): Promise<SearchResult> {
  const t0 = performance.now();
  const attempts: string[] = [];
  const q = query.trim().slice(0, 200);
  if (!q) return { query: q, hits: [], provider: "none", latency_ms: 0, attempts: ["empty"] };

  if (process.env.SEARXNG_URL) {
    try {
      const hits = await searxng(q, process.env.SEARXNG_URL);
      if (hits.length) return { query: q, hits, provider: "searxng", latency_ms: Math.round(performance.now() - t0), attempts };
      attempts.push("searxng:empty");
    } catch (e) {
      attempts.push(`searxng:${(e as Error).message}`);
    }
  }
  if (process.env.BRAVE_SEARCH_API_KEY) {
    try {
      const hits = await brave(q, process.env.BRAVE_SEARCH_API_KEY);
      if (hits.length) return { query: q, hits, provider: "brave", latency_ms: Math.round(performance.now() - t0), attempts };
      attempts.push("brave:empty");
    } catch (e) {
      attempts.push(`brave:${(e as Error).message}`);
    }
  }
  const hits = await duckduckgo(q);
  return {
    query: q,
    hits,
    provider: hits.length ? (hits[0].source as SearchHit["source"]) : "none",
    latency_ms: Math.round(performance.now() - t0),
    attempts: hits.length ? attempts : [...attempts, "duckduckgo:empty"],
  };
}

export function formatHitsForPrompt(hits: SearchHit[]): string {
  if (!hits.length) return "No web results were available.";
  return hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${h.snippet}`).join("\n\n");
}
