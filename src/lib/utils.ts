// ============================================================================
// VOXEMBLY — utilities. Pure, environment-agnostic (works in Node & browser).
// ============================================================================

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** A short, URL-safe unique id. */
export function uid(prefix = ""): string {
  const s =
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${s}` : s;
}

/**
 * SHA-256 hex digest. Uses Web Crypto (available in Node 18+ globalThis.crypto
 * and all modern browsers / edge runtimes). Falls back to a deterministic
 * non-crypto hash if subtle is unavailable.
 */
export async function sha256Hex(input: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(input);
    const buf = await globalThis.crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return fnv1a(input).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
  }
}

/** A git-style 7-char short hash. */
export function shortHash(hash: string): string {
  return (hash || "").slice(0, 7);
}

/** Synchronous FNV-1a 32-bit hash (used for deterministic fallbacks). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Format milliseconds for the Latency Dial ("134 ms" / "1.9 s"). */
export function formatMs(ms: number | undefined | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Clamp a number. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Relative time string ("2m ago"). */
export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

/** Format an epoch ms into a compact date/time. */
export function fmtDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

/** Safe JSON parse that extracts the first balanced {...} object from text. */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  // Strip common code fences.
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  // Try direct parse first.
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through */
  }
  // Find the first balanced object.
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic pseudo-random in [0,1) from a string seed. */
export function seededRandom(seed: string): () => number {
  let s = fnv1a(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/** Title-case a word list into a label. */
export function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
