/**
 * GroqCloud client (OpenAI-compatible) with rate-limit-aware round-robin across free-tier models.
 *
 * Fallback order on 429 / 5xx: the requested model → the rest of the pool → AssemblyAI LLM Gateway
 * (same ASSEMBLYAI_API_KEY, `https://llm-gateway.assemblyai.com/v1/chat/completions`) → "paused".
 */

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const AAI_GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";

export const GROQ_MODELS = {
  fast: "llama-3.1-8b-instant",
  reasoner: "llama-3.3-70b-versatile",
  tools: "openai/gpt-oss-120b",
  contrarian: "moonshotai/kimi-k2-instruct",
  multilingual: "qwen/qwen3-32b",
} as const;
export type GroqModel = (typeof GROQ_MODELS)[keyof typeof GROQ_MODELS];

export const ROUND_ROBIN: GroqModel[] = [
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

export interface ChatOptions {
  model: GroqModel | string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
  /** allow hopping to other models on 429/5xx */
  fallback?: boolean;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: "groq" | "assemblyai-llm-gateway";
  latency_ms: number;
  hops: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class LLMPausedError extends Error {
  constructor(public attempts: string[]) {
    super("All LLM providers are rate-limited — Council paused");
    this.name = "LLMPausedError";
  }
}

/** Per-model cool-down registry so a tripped model is skipped until its Retry-After elapses. */
const cooldown = new Map<string, number>();
function isCool(model: string) {
  const until = cooldown.get(model) ?? 0;
  return Date.now() >= until;
}
function trip(model: string, seconds = 20) {
  cooldown.set(model, Date.now() + seconds * 1000);
}

/** Strip <think>…</think> blocks (qwen3) and markdown fences around JSON. */
export function cleanModelText(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  return t;
}

/** Best-effort JSON extraction: tolerant of prose around the object. */
export function extractJSON<T = unknown>(text: string): T | null {
  const t = cleanModelText(text);
  try {
    return JSON.parse(t) as T;
  } catch {
    /* fallthrough */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

async function callOnce(
  url: string,
  key: string,
  provider: ChatResult["provider"],
  opts: ChatOptions,
  model: string,
): Promise<ChatResult> {
  const t0 = performance.now();
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.max_tokens ?? 1024,
  };
  // Groq honours response_format json_object for most models; Kimi/qwen prefer prompt-level JSON asks.
  if (opts.json && provider === "groq" && !model.startsWith("moonshotai") && !model.startsWith("qwen")) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    const err = new Error(`${provider} ${model} → HTTP ${res.status}`) as Error & { status: number; retryAfter?: number };
    err.status = res.status;
    err.retryAfter = Number.isFinite(ra) && ra > 0 ? ra : undefined;
    throw err;
  }
  const j = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: ChatResult["usage"];
  };
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    model,
    provider,
    latency_ms: Math.round(performance.now() - t0),
    hops: 0,
    usage: j.usage,
  };
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const groqKey = process.env.GROQ_API_KEY;
  const aaiKey = process.env.ASSEMBLYAI_API_KEY;
  const attempts: string[] = [];
  const candidates: string[] = [opts.model];
  if (opts.fallback !== false) for (const m of ROUND_ROBIN) if (!candidates.includes(m)) candidates.push(m);

  let hops = 0;
  if (groqKey) {
    for (const model of candidates) {
      if (!isCool(model)) {
        attempts.push(`${model}:cooling`);
        continue;
      }
      try {
        const r = await callOnce(GROQ_URL, groqKey, "groq", opts, model);
        r.hops = hops;
        return r;
      } catch (e) {
        const err = e as Error & { status?: number; retryAfter?: number };
        attempts.push(`${model}:${err.status ?? "net"}`);
        if (err.status === 429 || (err.status && err.status >= 500) || !err.status) {
          trip(model, err.retryAfter ?? 20);
          hops++;
          continue;
        }
        // 400/401/404 → model-specific problem; try the next one but don't cool it for long.
        trip(model, 5);
        hops++;
      }
    }
  } else {
    attempts.push("groq:no_key");
  }

  // Secondary provider: AssemblyAI LLM Gateway (same API key as Dictation).
  if (aaiKey && opts.fallback !== false && isCool("aai-gateway")) {
    for (const model of ["qwen3.5-4b-32k-fast", "gemini-2.5-flash", "gpt-4.1-mini"]) {
      try {
        const r = await callOnce(AAI_GATEWAY_URL, aaiKey, "assemblyai-llm-gateway", opts, model);
        r.hops = hops;
        return r;
      } catch (e) {
        const err = e as Error & { status?: number };
        attempts.push(`gateway/${model}:${err.status ?? "net"}`);
        hops++;
        if (err.status === 429) {
          trip("aai-gateway", 30);
          break;
        }
      }
    }
  }
  throw new LLMPausedError(attempts);
}

export function llmStatus() {
  const now = Date.now();
  return {
    groq_configured: Boolean(process.env.GROQ_API_KEY),
    gateway_configured: Boolean(process.env.ASSEMBLYAI_API_KEY),
    cooling: [...cooldown.entries()].filter(([, until]) => until > now).map(([m, until]) => ({ model: m, seconds: Math.ceil((until - now) / 1000) })),
  };
}
