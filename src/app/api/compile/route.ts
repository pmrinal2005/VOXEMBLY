/**
 * POST /api/compile — the Cleanup Pass + Intent Kernel.
 * Verbatim Sync STT transcript in → strict CompiledThoughtform JSON out (Groq llama-3.1-8b-instant,
 * round-robin fallback → AssemblyAI LLM Gateway → local heuristic compiler so the loop never dies).
 */
import { NextResponse } from "next/server";
import { compileThoughtform, type CompileContext } from "@/lib/kernel/compile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { transcript?: string; context?: CompileContext };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript = String(body.transcript ?? "").trim();
  if (!transcript) return NextResponse.json({ error: "`transcript` is required" }, { status: 400 });

  const result = await compileThoughtform(transcript.slice(0, 8000), body.context ?? {});
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
