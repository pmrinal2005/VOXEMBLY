/**
 * POST /api/transcribe — the Push-to-Think proxy.
 *
 * multipart/form-data in:
 *   audio   : Blob (audio/wav | audio/pcm — 16-bit, 80 ms–120 s, ≤40 MB)
 *   config  : JSON string (the Prompt Composer's output: prompt / keyterms_prompt /
 *             language_code / conversation_context / timestamps / sample_rate / channels)
 *   region  : "global" | "us" | "eu"
 *   duration_ms : client-measured duration, used to pre-route >120 s clips
 *
 * The API key never reaches the browser. Every documented response field is passed through so the UI
 * can render the Latency Dial (`request_time_ms`), Confidence Heatmap (`words[].confidence`) and the
 * auditable `session_id`.
 */
import { NextResponse } from "next/server";
import { DictationError, getDictationClient, LIMITS, SYNC_MODEL, type DictationConfig } from "@/lib/dictation/client";
import type { SyncRegion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseRegion(v: string | null): SyncRegion {
  const r = (v ?? "").toLowerCase();
  if (r === "us" || r === "eu" || r === "global") return r;
  return ((process.env.ASSEMBLYAI_SYNC_REGION as SyncRegion) || "global") as SyncRegion;
}

export async function POST(req: Request) {
  const t0 = performance.now();

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return NextResponse.json(
      { error: { status: 500, code: "missing_api_key", message: "ASSEMBLYAI_API_KEY is not configured. Add it to .env.local and restart." } },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json({ error: { status: 400, code: "bad_request", message: `Invalid multipart body: ${(e as Error).message}` } }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: { status: 400, code: "bad_request", message: "Missing `audio` part" } }, { status: 400 });
  }

  const declared = (audio.type || "audio/wav").split(";")[0];
  const contentType = declared === "audio/pcm" ? "audio/pcm" : "audio/wav";

  if (audio.size > LIMITS.maxBytes) {
    // Not fatal: the client adapter re-routes oversized clips to Pre-recorded STT.
    // We still let it through so that pathway can run server-side.
  }

  let config: DictationConfig | undefined;
  const rawCfg = form.get("config");
  if (typeof rawCfg === "string" && rawCfg.trim()) {
    try {
      config = JSON.parse(rawCfg) as DictationConfig;
    } catch {
      return NextResponse.json({ error: { status: 400, code: "bad_request", message: "`config` is not valid JSON" } }, { status: 400 });
    }
  }

  const region = parseRegion(typeof form.get("region") === "string" ? (form.get("region") as string) : null);
  const durationRaw = form.get("duration_ms");
  const durationHintMs = typeof durationRaw === "string" && durationRaw ? Number(durationRaw) : undefined;

  try {
    const buf = await audio.arrayBuffer();
    const result = await getDictationClient().transcribe({
      audio: buf,
      contentType,
      config,
      region,
      durationHintMs: Number.isFinite(durationHintMs) ? durationHintMs : undefined,
    });

    return NextResponse.json(
      {
        transcript: result.transcript,
        meta: {
          model: SYNC_MODEL,
          route: result.route,
          region: result.region,
          endpoint: result.endpoint,
          warmed: result.warmed,
          retries: result.retries,
          proxy_ms: result.proxy_ms,
          route_total_ms: Math.round(performance.now() - t0),
          audio_bytes: audio.size,
          audio_format: contentType,
          sent_config: config ?? null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof DictationError) {
      // audio_too_short is a user slip (<80 ms tap), not a failure — 200 so the UI can ignore it silently.
      const status = e.code === "audio_too_short" ? 200 : e.status >= 400 && e.status < 600 ? e.status : 500;
      return NextResponse.json({ error: e.toJSON(), swallowed: e.code === "audio_too_short" }, { status });
    }
    return NextResponse.json({ error: { status: 500, code: "proxy_error", message: (e as Error).message } }, { status: 500 });
  }
}
