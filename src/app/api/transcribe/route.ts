import { NextRequest, NextResponse } from "next/server";
import { DictationError, getDictationClient } from "@/lib/dictation/client";
import { pickDemoClip } from "@/lib/demo-transcripts";
import type { AaiRegion, TranscribeResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side round-robin counter for the demo path.
let demoSeq = 0;

/**
 * The core Push-to-Think transcription route. Accepts multipart form-data with:
 *   audio             (WAV blob, required)
 *   prompt            (string)
 *   keyterms_prompt   (JSON array string)
 *   language_code     (string, optional)
 *   region            (us|eu|global, optional)
 *
 * Proxies to AssemblyAI Sync STT. If no ASSEMBLYAI_API_KEY is set, returns a
 * clearly-labeled simulated transcript so the whole app remains demoable.
 */
export async function POST(req: NextRequest) {
  const client = getDictationClient();

  // ---- No API key → simulated path (still fully demoable) ----
  if (!client.configured) {
    const demo = pickDemoClip(demoSeq++);
    const sim: TranscribeResponse = {
      text: demo.raw,
      words: demo.words,
      confidence: demo.confidence,
      audio_duration_ms: 4200,
      session_id: `sim-${Date.now()}`,
      request_time_ms: 118 + Math.round(Math.random() * 40),
      language_code: demo.language_code || "en",
      region: (process.env.NEXT_PUBLIC_AAI_REGION as AaiRegion) || "global",
      endpoint: "simulated",
      simulated: true,
    };
    // small artificial latency so the UI phases feel real
    await new Promise((r) => setTimeout(r, 160));
    return NextResponse.json(sim);
  }

  // ---- Live AssemblyAI path ----
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }

  const prompt = (form.get("prompt") as string) || undefined;
  const language_code = (form.get("language_code") as string) || undefined;
  const region = ((form.get("region") as string) as AaiRegion) || undefined;
  let keyterms_prompt: string[] | undefined;
  try {
    const raw = form.get("keyterms_prompt") as string;
    keyterms_prompt = raw ? JSON.parse(raw) : undefined;
  } catch {
    keyterms_prompt = undefined;
  }

  try {
    const buf = Buffer.from(await audio.arrayBuffer());
    const result = await client.transcribe(
      buf,
      { prompt, keyterms_prompt, language_code, region },
      "clip.wav",
      audio.type || "audio/wav",
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof DictationError) {
      // audio_too_large → tell client to route to long-form path
      const status = e.code === "audio_too_large" ? 413 : e.status || 502;
      return NextResponse.json(
        { error: e.message, code: e.code, retryable: e.retryable },
        { status },
      );
    }
    return NextResponse.json({ error: String(e), code: "unknown" }, { status: 500 });
  }
}
