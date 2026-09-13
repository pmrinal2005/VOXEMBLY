import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Researcher web search. Uses DuckDuckGo Instant Answer (zero-key) as the $0
 * default. Returns a small set of results; degrades gracefully to an empty set.
 */
export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const query = (body.query || "").trim();
  if (!query) return NextResponse.json({ results: [] });

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const json: any = await res.json();
    const results: { title: string; url: string; snippet: string }[] = [];
    if (json?.AbstractText) {
      results.push({
        title: json.Heading || query,
        url: json.AbstractURL || "",
        snippet: json.AbstractText,
      });
    }
    for (const topic of json?.RelatedTopics || []) {
      if (topic?.Text && topic?.FirstURL) {
        results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
      }
      if (results.length >= 5) break;
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
