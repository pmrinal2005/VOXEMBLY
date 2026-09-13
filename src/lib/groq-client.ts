// ============================================================================
// GroqCloud round-robin client (OpenAI-compatible).
// Handles: cleanup pass (strict-JSON Thoughtform extraction) + agent calls.
// On 429/503, hops to the next model in the pool (graceful degradation).
// ============================================================================

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Model pool ordered by role/preference. Round-robin on rate limits.
export const GROQ_MODELS = {
  fast: "llama-3.1-8b-instant",
  reasoner: "llama-3.3-70b-versatile",
  tools: "openai/gpt-oss-120b",
  contrarian: "moonshotai/kimi-k2-instruct",
  multilingual: "qwen/qwen3-32b",
} as const;

export const MODEL_ROTATION = [
  GROQ_MODELS.reasoner,
  GROQ_MODELS.tools,
  GROQ_MODELS.contrarian,
  GROQ_MODELS.multilingual,
  GROQ_MODELS.fast,
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqCallOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class GroqError extends Error {
  status?: number;
  rateLimited: boolean;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GroqError";
    this.status = status;
    this.rateLimited = status === 429 || status === 503;
  }
}

async function callOnce(o: GroqCallOptions): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${o.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: o.model,
      messages: o.messages,
      temperature: o.temperature ?? 0.3,
      max_tokens: o.maxTokens ?? 1024,
      ...(o.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new GroqError(detail || `HTTP ${res.status}`, res.status);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

// Call a specific model, but round-robin to the rest of the pool on 429/503.
export async function groqChat(o: GroqCallOptions): Promise<{ content: string; model: string }> {
  const tried = new Set<string>();
  const order = [o.model, ...MODEL_ROTATION.filter((m) => m !== o.model)];

  let lastErr: unknown;
  for (const model of order) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      const content = await callOnce({ ...o, model });
      return { content, model };
    } catch (err) {
      lastErr = err;
      if (err instanceof GroqError && err.rateLimited) {
        continue; // hop to next model
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new GroqError("Groq pool exhausted");
}

export function extractJson<T = unknown>(text: string): T | null {
  // Try direct parse, then fenced code block, then first {...} span.
  const attempts = [
    text,
    text.replace(/```(?:json)?/gi, "").trim(),
  ];
  const brace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (brace >= 0 && lastBrace > brace) {
    attempts.push(text.slice(brace, lastBrace + 1));
  }
  for (const a of attempts) {
    try {
      return JSON.parse(a) as T;
    } catch {
      /* keep trying */
    }
  }
  return null;
}
