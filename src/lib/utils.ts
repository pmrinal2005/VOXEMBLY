import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Short unique id with a readable prefix (e.g. `draft-1a2b3c`). */
export function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * SHA-256 hex digest. Uses Web Crypto (available in the browser and in the Node/Edge
 * runtimes Next.js uses); falls back to a deterministic FNV mix if subtle crypto is
 * unavailable, so commit hashing never throws.
 */
export async function sha256Hex(input: string): Promise<string> {
  try {
    const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
    if (subtle) {
      const data = new TextEncoder().encode(input);
      const digest = await subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fall through to deterministic fallback */
  }
  // Deterministic 64-hex fallback (two FNV passes over the input + reversed input).
  const mix = (s: string) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  const a = mix(input);
  const b = mix([...input].reverse().join(""));
  const c = mix(a + input);
  const d = mix(b + input);
  return (a + b + c + d).padEnd(64, "0").slice(0, 64);
}

/** Cosine similarity of two equal-length L2-ish vectors. Returns 0 on mismatch. */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

/** Format a millisecond number for the Latency Dial / traces. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

// Deterministic short "commit" hash (7 hex chars, git-style) from a seed string.
export function shortHash(seed: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Mix a bit more so short inputs still spread.
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 7);
}

// Random-ish commit hash for runtime-created Thoughtforms.
export function randomHash(): string {
  return shortHash(`${Date.now()}-${Math.random()}`);
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export const NODE_COLORS: Record<string, string> = {
  Person: "#A78BFA",
  Project: "#00CBD6",
  Concept: "#F59E0B",
  Task: "#34D399",
  Decision: "#EC4899",
  Domain: "#60A5FA",
  Location: "#F472B6",
  Emotion: "#FB7185",
  Memory: "#A78BFA",
  Entity: "#94A3B8",
};

export const INTENT_COLORS: Record<string, string> = {
  note: "#94A3B8",
  task: "#34D399",
  decision: "#EC4899",
  question: "#60A5FA",
  idea: "#F59E0B",
  meeting: "#00CBD6",
  emotion: "#FB7185",
  command: "#A78BFA",
  memory: "#A78BFA",
};

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}
