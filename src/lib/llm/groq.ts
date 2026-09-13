// ============================================================================
// VOXEMBLY — GroqCloud round-robin LLM client (SERVER-SIDE ONLY).
//
// OpenAI-compatible endpoint: https://api.groq.com/openai/v1/chat/completions
// Rate-limit-aware: on 429/503 it hops to the next model in the pool so the
// Agent Council never hard-fails during a heavy demo.
// ============================================================================

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Free-tier model pool (per the plan §4.2.4). Order = round-robin priority. */
export const MODELS = {
  fast: "llama-3.1-8b-instant",
  reasoner: "llama-3.3-70b-versatile",
  tools: "openai/gpt-oss-120b",
  contrarian: "moonshotai/kimi-k2-instruct",
  multilingual: "qwen/qwen3-32b",
} as const;

export const MODEL_POOL: string[] = [
  MODELS.reasoner,
  MODELS.tools,
  MODELS.contrarian,
  MODELS.multilingual,
  MODELS.fast,
];

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export class GroqError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GroqError";
    this.status = status;
  }
}

function apiKey(): string {
  return process.env.GROQ_API_KEY || "";
}

export function groqConfigured(): boolean {
  return Boolean(apiKey());
}

/**
 * A single chat completion with automatic round-robin failover across the
 * model pool on 429/503. Returns the assistant text.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<{ text: string; model: string }> {
  const key = apiKey();
  if (!key) throw new GroqError("GROQ_API_KEY is not set", 401);

  // Build the ordered attempt list: requested model first, then the pool.
  const attempts = opts.model
    ? [opts.model, ...MODEL_POOL.filter((m) => m !== opts.model)]
    : [...MODEL_POOL];

  let lastErr: unknown;
  for (const model of attempts) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 900,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: opts.signal ?? AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || res.status === 503) {
        lastErr = new GroqError(`rate/unavailable on ${model}`, res.status);
        continue; // hop to next model
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new GroqError(body || res.statusText, res.status);
      }
      const json: any = await res.json();
      const text: string = json?.choices?.[0]?.message?.content ?? "";
      return { text, model };
    } catch (e) {
      lastErr = e;
      // network / timeout — try next model
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new GroqError("all models failed");
}
