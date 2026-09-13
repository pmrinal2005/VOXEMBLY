import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
