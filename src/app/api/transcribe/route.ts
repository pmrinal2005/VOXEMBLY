import { NextResponse } from "next/server";
import {
  transcribe,
  DictationError,
  type Region,
} from "@/lib/dictation-client";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST audio (multipart form: audio blob + prompt + keyterms_prompt + language_code)
// Proxies to AssemblyAI Sync STT so the API key never touches the client.
export async function POST(req: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "ASSEMBLYAI_API_KEY not configured",
        code: "no_api_key",
        hint: "Add ASSEMBLYAI_API_KEY to .env.local (or Vercel env) and restart.",
      },
      { status: 501 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "missing audio blob" }, { status: 400 });
  }

  const prompt = (form.get("prompt") as string) || undefined;
  const keytermsRaw = (form.get("keyterms_prompt") as string) || undefined;
  const language_code = (form.get("language_code") as string) || undefined;
  const region = ((form.get("region") as string) ||
    process.env.NEXT_PUBLIC_AAI_REGION ||
    "global") as Region;

  let keyterms_prompt: string[] | undefined;
  if (keytermsRaw) {
    try {
      const parsed = JSON.parse(keytermsRaw);
      if (Array.isArray(parsed)) keyterms_prompt = parsed.map(String);
    } catch {
      keyterms_prompt = keytermsRaw.split(",").map((s) => s.trim());
    }
  }

  const buf = new Uint8Array(await audio.arrayBuffer());

  try {
    const resp = await transcribe({
      apiKey,
      region,
      audio: buf,
      contentType: audio.type || "audio/wav",
      prompt,
      keyterms_prompt,
      language_code,
    });
    return NextResponse.json(resp);
  } catch (err) {
    if (err instanceof DictationError) {
      // audio_too_large → signal client to route to long-form pathway.
      const status =
        err.code === "unauthorized"
          ? 401
          : err.code === "rate_limited"
          ? 429
          : err.code === "audio_too_large"
          ? 413
          : 502;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status }
      );
    }
    return NextResponse.json(
      { error: (err as Error).message, code: "unknown" },
      { status: 502 }
    );
  }
}
