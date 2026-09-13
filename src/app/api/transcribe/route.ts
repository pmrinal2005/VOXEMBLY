import { NextRequest, NextResponse } from "next/server";
import { DictationError, getDictationClient, LIMITS } from "@/lib/dictation/client";
import { pickDemoClip } from "@/lib/demo-transcripts";
import type { AaiRegion, TranscribeResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let demoSeq = 0;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const client = getDictationClient();
  const region = ((req.nextUrl.searchParams.get("region") as AaiRegion) ||
    (process.env.NEXT_PUBLIC_AAI_REGION as AaiRegion) ||
    "global") as AaiRegion;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const prompt = (form.get("prompt") as string) || "";
  const language_code = (form.get("language_code") as string) || undefined;
  const regionField = ((form.get("region") as string) as AaiRegion) || region;
  let keyterms_prompt: string[] = [];
  try {
    const raw = form.get("keyterms_prompt") as string;
    keyterms_prompt = raw ? JSON.parse(raw) : [];
  } catch {
    keyterms_prompt = [];
  }

  if (!client.configured) {
    const demo = pickDemoClip(demoSeq++);
    const sim: TranscribeResponse = {
      transcript: {
        text: demo.raw,
        words: demo.words,
        confidence: demo.confidence,
        audio_duration_ms: 4200,
        session_id: `sim-${Date.now()}`,
        request_time_ms: 118 + Math.round(Math.random() * 40),
        language_code: demo.language_code || "en",
      },
      meta: {
        proxy_ms: Date.now() - t0,
        warmed: false,
        region: regionField,
        endpoint: "simulated",
        route: "simulated",
        retries: 0,
        simulated: true,
      },
    };
    await new Promise((r) => setTimeout(r, 140));
    return NextResponse.json(sim);
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing audio" }, { status: 400 });
  }

  try {
    const buf = Buffer.from(await audio.arrayBuffer());
    const result = await client.transcribe(
      buf,
      { prompt, keyterms_prompt, language_code, region: regionField },
      "clip.wav",
      audio.type || "audio/wav",
    );
    const body: TranscribeResponse = {
      transcript: {
        text: result.text,
        words: result.words,
        confidence: result.confidence,
        audio_duration_ms: result.audio_duration_ms,
        session_id: result.session_id,
        request_time_ms: result.request_time_ms,
        language_code: result.language_code,
      },
      meta: {
        proxy_ms: Date.now() - t0,
        warmed: true,
        region: result.region,
        endpoint: result.endpoint,
        route: result.audio_duration_ms > LIMITS.maxDurationMs ? "prerecorded" : "sync",
        retries: 0,
      },
    };
    return NextResponse.json(body);
  } catch (e) {
    if (e instanceof DictationError) {
      const status = e.code === "audio_too_large" ? 413 : e.status || 502;
      return NextResponse.json({ error: e.message, code: e.code, retryable: e.retryable }, { status });
    }
    return NextResponse.json({ error: String(e), code: "unknown" }, { status: 500 });
  }
}
