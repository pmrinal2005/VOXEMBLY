/**
 * GET /api/health — what is configured, what is degraded, and why.
 * Drives the Settings "System" panel and the header status pills.
 */
import { NextResponse } from "next/server";
import { llmStatus } from "@/lib/llm/groq";
import { adminConfigured } from "@/lib/supabase/admin";
import { SYNC_ENDPOINTS, SYNC_MODEL, LIMITS } from "@/lib/dictation/client";
import type { SyncRegion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const region = ((process.env.ASSEMBLYAI_SYNC_REGION as SyncRegion) || "global") as SyncRegion;
  const llm = llmStatus();
  const dictation = Boolean(process.env.ASSEMBLYAI_API_KEY);

  return NextResponse.json(
    {
      ok: true,
      service: "VOXEMBLY",
      time: new Date().toISOString(),
      dictation: {
        configured: dictation,
        model: SYNC_MODEL,
        region,
        endpoint: SYNC_ENDPOINTS[region],
        limits: LIMITS,
      },
      llm: {
        groq_configured: llm.groq_configured,
        gateway_configured: llm.gateway_configured,
        cooling: llm.cooling,
        compile_fallback: "heuristic (local, $0)",
      },
      embeddings: {
        jina_configured: Boolean(process.env.JINA_API_KEY),
        fallback: "hash-ngram-256 (local, unlimited)",
      },
      search: {
        searxng: Boolean(process.env.SEARXNG_URL),
        brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
        fallback: "duckduckgo + wikipedia (no key)",
      },
      persistence: {
        mode: process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase + indexeddb" : "indexeddb (Local Twin)",
        publish_shared: adminConfigured(),
      },
      degraded: [
        !dictation && "ASSEMBLYAI_API_KEY missing — dictation disabled",
        !llm.groq_configured && !llm.gateway_configured && "No LLM key — compiling with the local heuristic",
      ].filter(Boolean),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
