import { NextRequest, NextResponse } from "next/server";
import { MODELS, chat, groqConfigured } from "@/lib/llm/groq";
import { languageLabel } from "@/lib/twin/domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Translate a Thoughtform's polished text to a target language (Flow G). */
export async function POST(req: NextRequest) {
  let body: { text?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text = (body.text || "").trim();
  const target = (body.target || "en").trim();
  if (!text) return NextResponse.json({ error: "missing text" }, { status: 400 });

  if (!groqConfigured()) {
    return NextResponse.json({
      translated: `[${languageLabel(target)}] ${text}`,
      target,
      simulated: true,
    });
  }
  try {
    const { text: out } = await chat(
      [
        {
          role: "system",
          content: `You are a translator. Translate the user's text into ${languageLabel(
            target,
          )} (code: ${target}). Preserve meaning and tone. Output ONLY the translation.`,
        },
        { role: "user", content: text },
      ],
      { model: MODELS.multilingual, temperature: 0.3, maxTokens: 400 },
    );
    return NextResponse.json({ translated: out.trim(), target });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
