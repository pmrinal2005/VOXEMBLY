import { NextResponse } from "next/server";
import { groqChat, GROQ_MODELS } from "@/lib/groq-client";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const { text, target } = (await req.json().catch(() => ({}))) as {
    text?: string;
    target?: string;
  };
  if (!text || !target) {
    return NextResponse.json({ error: "missing text/target" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      translated: text,
      target,
      note: "GROQ_API_KEY not set — echoing original.",
    });
  }

  try {
    const { content } = await groqChat({
      apiKey,
      model: GROQ_MODELS.multilingual,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `Translate the user's text into ${target}. Preserve meaning and tone. Return ONLY the translation.`,
        },
        { role: "user", content: text },
      ],
    });
    return NextResponse.json({ translated: content.trim(), target });
  } catch (e) {
    return NextResponse.json(
      { translated: text, target, error: (e as Error).message },
      { status: 200 }
    );
  }
}
