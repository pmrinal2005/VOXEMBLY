"use client";

// ============================================================================
// VOXEMBLY — Local persistence over IndexedDB (via idb).
// Offline draft queue + Twin state. Postgres (Drizzle) is the share plane.
// ============================================================================

import { openDB, type IDBPDatabase } from "idb";
import type {
  Branch,
  DraftRecord,
  Graph,
  Profile,
  PublishedThoughtform,
  Thoughtform,
} from "@/lib/types";

export type { DraftRecord };

const DB_NAME = "voxembly";
const DB_VERSION = 2;

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no_indexeddb"));
  }
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("thoughtforms")) {
          d.createObjectStore("thoughtforms", { keyPath: "commit_hash" });
        }
        if (!d.objectStoreNames.contains("branches")) {
          d.createObjectStore("branches", { keyPath: "name" });
        }
        if (!d.objectStoreNames.contains("meta")) {
          d.createObjectStore("meta", { keyPath: "key" });
        }
        if (!d.objectStoreNames.contains("drafts")) {
          d.createObjectStore("drafts", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("published")) {
          d.createObjectStore("published", { keyPath: "hash" });
        }
      },
    });
  }
  return dbp;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function putThoughtform(tf: Thoughtform): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("thoughtforms", tf);
  }, undefined);
}

export async function allThoughtforms(): Promise<Thoughtform[]> {
  return safe(async () => {
    const d = await db();
    const all = (await d.getAll("thoughtforms")) as Thoughtform[];
    return all.sort((a, b) => a.created_at - b.created_at);
  }, []);
}

export async function getThoughtform(hash: string): Promise<Thoughtform | null> {
  return safe(async () => {
    const d = await db();
    const row = (await d.get("thoughtforms", hash)) as Thoughtform | undefined;
    if (row) return row;
    const all = (await d.getAll("thoughtforms")) as Thoughtform[];
    return all.find((t) => t.commit_hash.startsWith(hash)) ?? null;
  }, null);
}

export async function getMeta<T>(key: string, fallback?: T): Promise<T | undefined> {
  return safe(async () => {
    const d = await db();
    const row = await d.get("meta", key);
    return row ? ((row as { value: T }).value as T) : fallback;
  }, fallback);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("meta", { key, value });
  }, undefined);
}

export async function saveProfile(p: Profile): Promise<void> {
  await setMeta("profile", p);
}

export async function getProfile(): Promise<Profile | null> {
  return (await getMeta<Profile>("profile")) ?? null;
}

export async function putBranch(b: Branch): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("branches", b);
  }, undefined);
}

export async function getBranches(): Promise<Record<string, Branch>> {
  return safe(async () => {
    const d = await db();
    const all = (await d.getAll("branches")) as Branch[];
    const rec: Record<string, Branch> = {};
    for (const b of all) rec[b.name] = b;
    return rec;
  }, {});
}

export const getGraph = () => getMeta<Graph>("graph", { nodes: {}, edges: {} } as Graph);
export const setGraph = (g: Graph) => setMeta("graph", g);

export const getCurrentBranch = async () =>
  (await getMeta<string>("currentBranch", "main")) ?? "main";
export const setCurrentBranch = (n: string) => setMeta("currentBranch", n);

export async function loadDrafts(): Promise<DraftRecord[]> {
  return safe(async () => {
    const d = await db();
    return ((await d.getAll("drafts")) as DraftRecord[]).sort(
      (a, b) => a.created_at - b.created_at,
    );
  }, []);
}

export async function enqueueDraft(draft: DraftRecord): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("drafts", draft);
  }, undefined);
}

export async function dropDraft(id: string): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.delete("drafts", id);
  }, undefined);
}

export async function putPublished(p: PublishedThoughtform): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("published", p);
  }, undefined);
}

export async function getPublished(hash: string): Promise<PublishedThoughtform | null> {
  return safe(async () => {
    const d = await db();
    const row = (await d.get("published", hash)) as PublishedThoughtform | undefined;
    if (row) return row;
    const all = (await d.getAll("published")) as PublishedThoughtform[];
    return all.find((a) => a.hash.startsWith(hash)) ?? null;
  }, null);
}

export async function loadPublished(): Promise<PublishedThoughtform[]> {
  return safe(async () => {
    const d = await db();
    return (await d.getAll("published")) as PublishedThoughtform[];
  }, []);
}

export async function exportTwin(): Promise<string> {
  const [profile, thoughtforms, branches, graph] = await Promise.all([
    getProfile(),
    allThoughtforms(),
    getBranches(),
    getGraph(),
  ]);
  return JSON.stringify(
    { profile, thoughtforms, branches, graph, exported_at: Date.now() },
    null,
    2,
  );
}

export async function wipeLocalTwin(): Promise<void> {
  await safe(async () => {
    const d = await db();
    for (const s of ["thoughtforms", "branches", "meta", "drafts"] as const) {
      await d.clear(s);
    }
  }, undefined);
}

export async function wipeAll(): Promise<void> {
  await safe(async () => {
    const d = await db();
    for (const s of ["thoughtforms", "branches", "meta", "drafts", "published"] as const) {
      await d.clear(s);
    }
  }, undefined);
}
