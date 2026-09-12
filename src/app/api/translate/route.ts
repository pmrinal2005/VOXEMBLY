/**
 * POST /api/translate — view any Thoughtform in the reader's own language (§3.5).
 * One `qwen/qwen3-32b` pass (multilingual specialist) with locale-pack register control.
 */
import { NextResponse } from "next/server";
import { chat, cleanModelText, GROQ_MODELS } from "@/lib/llm/groq";
import { LANGUAGES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTER: Record<string, string> = {
  none: "",
  keigo: " If the target language is Japanese, use polite keigo (丁寧語).",
  usted: " If the target language is Spanish, use the formal 'usted' register.",
  hinglish: " If mixing Hindi and English, keep Hindi in Devanagari and English in Latin script.",
};

export async function POST(req: Request) {
  let body: { text?: string; target?: string; locale_pack?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = String(body.text ?? "").trim();
  const target = String(body.target ?? "en");
  if (!text) return NextResponse.json({ error: "`text` is required" }, { status: 400 });

  const lang = LANGUAGES.find((l) => l.code === target);
  if (!lang) return NextResponse.json({ error: `Unsupported target language "${target}"` }, { status: 400 });

  try {
    const res = await chat({
      model: GROQ_MODELS.multilingual,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content: `Translate the user's text into ${lang.name} (${lang.native}). Preserve meaning, first person, proper nouns and any quoted phrases. Return ONLY the translation — no notes, no preamble.${REGISTER[body.locale_pack ?? "none"] ?? ""}`,
        },
        { role: "user", content: text.slice(0, 4000) },
      ],
    });
    return NextResponse.json({
      translation: cleanModelText(res.content),
      target,
      language: lang.name,
      model: res.model,
      provider: res.provider,
      latency_ms: res.latency_ms,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, paused: true }, { status: 503 });
  }
}
