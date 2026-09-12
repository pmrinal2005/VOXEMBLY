/**
 * Local Twin persistence (IndexedDB via `idb`).
 *
 * VOXEMBLY is local-first: the Cognitive Twin lives in IndexedDB so the app works with zero accounts,
 * offline, and at $0. Supabase (Postgres + pgvector) is an optional mirror — see lib/supabase/sync.ts.
 * The `drafts` store is the offline dictation queue (Flow B / §3.6 accessibility requirement): audio
 * captured without connectivity is kept as a Blob and replayed when the network returns.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Branch, Profile, PublishedThoughtform, Thoughtform } from "@/lib/types";

export const DB_NAME = "voxembly";
export const DB_VERSION = 1;

export interface DraftRecord {
  id: string;
  created_at: number;
  audio: Blob;
  contentType: "audio/wav" | "audio/pcm";
  durationMs: number;
  sampleRate: number;
  channels: number;
  branch: string;
  /** composed config snapshot, so a replayed draft keeps the context it was recorded with */
  config: unknown;
  attempts: number;
  last_error?: string;
}

interface VoxDB extends DBSchema {
  thoughtforms: {
    key: string;
    value: Thoughtform;
    indexes: { by_created: number; by_branch: string };
  };
  branches: { key: string; value: Branch };
  profile: { key: string; value: Profile & { key: string } };
  drafts: { key: string; value: DraftRecord; indexes: { by_created: number } };
  published: { key: string; value: PublishedThoughtform };
  meta: { key: string; value: { key: string; value: unknown } };
}

let dbp: Promise<IDBPDatabase<VoxDB>> | null = null;

export function db(): Promise<IDBPDatabase<VoxDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable (server)"));
  if (!dbp) {
    dbp = openDB<VoxDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("thoughtforms")) {
          const s = d.createObjectStore("thoughtforms", { keyPath: "commit_hash" });
          s.createIndex("by_created", "created_at");
          s.createIndex("by_branch", "branch");
        }
        if (!d.objectStoreNames.contains("branches")) d.createObjectStore("branches", { keyPath: "name" });
        if (!d.objectStoreNames.contains("profile")) d.createObjectStore("profile", { keyPath: "key" });
        if (!d.objectStoreNames.contains("drafts")) {
          const s = d.createObjectStore("drafts", { keyPath: "id" });
          s.createIndex("by_created", "created_at");
        }
        if (!d.objectStoreNames.contains("published")) d.createObjectStore("published", { keyPath: "hash" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" });
      },
    });
  }
  return dbp;
}

const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/* ───────────────────────── thoughtforms ───────────────────────── */

export const loadThoughtforms = () => safe(async () => (await db()).getAllFromIndex("thoughtforms", "by_created"), [] as Thoughtform[]);

export const putThoughtform = (tf: Thoughtform) => safe(async () => void (await (await db()).put("thoughtforms", tf)), undefined);

export const putThoughtforms = (list: Thoughtform[]) =>
  safe(async () => {
    const d = await db();
    const tx = d.transaction("thoughtforms", "readwrite");
    await Promise.all([...list.map((t) => tx.store.put(t)), tx.done]);
  }, undefined);

export const getThoughtform = (hash: string) => safe(async () => (await db()).get("thoughtforms", hash), undefined);

export const deleteThoughtform = (hash: string) => safe(async () => void (await (await db()).delete("thoughtforms", hash)), undefined);

/* ───────────────────────── branches ───────────────────────── */

export const loadBranches = () => safe(async () => (await db()).getAll("branches"), [] as Branch[]);

export const putBranch = (b: Branch) => safe(async () => void (await (await db()).put("branches", b)), undefined);

export const putBranches = (list: Branch[]) =>
  safe(async () => {
    const d = await db();
    const tx = d.transaction("branches", "readwrite");
    await Promise.all([...list.map((b) => tx.store.put(b)), tx.done]);
  }, undefined);

/* ───────────────────────── profile ───────────────────────── */

export const loadProfile = () =>
  safe(async () => {
    const p = await (await db()).get("profile", "me");
    if (!p) return undefined;
    const { key: _key, ...rest } = p;
    return rest as Profile;
  }, undefined);

export const saveProfile = (p: Profile) => safe(async () => void (await (await db()).put("profile", { ...p, key: "me" })), undefined);

/* ───────────────────────── offline draft queue ───────────────────────── */

export const loadDrafts = () => safe(async () => (await db()).getAllFromIndex("drafts", "by_created"), [] as DraftRecord[]);
export const putDraft = (d0: DraftRecord) => safe(async () => void (await (await db()).put("drafts", d0)), undefined);
export const deleteDraft = (id: string) => safe(async () => void (await (await db()).delete("drafts", id)), undefined);
export const countDrafts = () => safe(async () => (await db()).count("drafts"), 0);

/* ───────────────────────── published artifacts ───────────────────────── */

export const putPublished = (p: PublishedThoughtform) => safe(async () => void (await (await db()).put("published", p)), undefined);
export const getPublished = (hash: string) => safe(async () => (await db()).get("published", hash), undefined);
export const loadPublished = () => safe(async () => (await db()).getAll("published"), [] as PublishedThoughtform[]);

/* ───────────────────────── meta (keyterm memory, DMR results, …) ───────────────────────── */

export const getMeta = <T,>(key: string) => safe(async () => ((await (await db()).get("meta", key))?.value as T | undefined), undefined);
export const setMeta = (key: string, value: unknown) => safe(async () => void (await (await db()).put("meta", { key, value })), undefined);

export async function wipeLocalTwin() {
  return safe(async () => {
    const d = await db();
    await Promise.all([
      d.clear("thoughtforms"),
      d.clear("branches"),
      d.clear("drafts"),
      d.clear("published"),
      d.clear("meta"),
    ]);
  }, undefined);
}

export async function exportTwin() {
  const [thoughtforms, branches, profile, published] = await Promise.all([loadThoughtforms(), loadBranches(), loadProfile(), loadPublished()]);
  return { version: DB_VERSION, exported_at: Date.now(), profile, branches, thoughtforms, published };
}
