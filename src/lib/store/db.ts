"use client";

// ============================================================================
// VOXEMBLY — Local persistence over IndexedDB (via idb). Also serves as the
// offline draft queue (Flow: accessibility / low-bandwidth). Everything works
// with zero backend; Supabase sync is layered on top when configured.
// ============================================================================

import { openDB, type IDBPDatabase } from "idb";
import type { Branch, Graph, Profile, Thoughtform } from "@/lib/types";

const DB_NAME = "voxembly";
const DB_VERSION = 1;

interface Stores {
  thoughtforms: Thoughtform;
  meta: any;
  drafts: { id: string; wav: Blob; createdAt: number };
}

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("no_indexeddb"));
  }
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("thoughtforms")) {
          d.createObjectStore("thoughtforms", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("meta")) {
          d.createObjectStore("meta", { keyPath: "key" });
        }
        if (!d.objectStoreNames.contains("drafts")) {
          d.createObjectStore("drafts", { keyPath: "id" });
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

// ---- Thoughtforms ----------------------------------------------------------

export async function saveThoughtform(tf: Thoughtform): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("thoughtforms", tf);
  }, undefined);
}

export async function allThoughtforms(): Promise<Thoughtform[]> {
  return safe(async () => {
    const d = await db();
    const all = (await d.getAll("thoughtforms")) as Thoughtform[];
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }, []);
}

// ---- Meta (profile, branches, graph) ---------------------------------------

async function getMeta<T>(key: string, fallback: T): Promise<T> {
  return safe(async () => {
    const d = await db();
    const row = await d.get("meta", key);
    return row ? (row.value as T) : fallback;
  }, fallback);
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("meta", { key, value });
  }, undefined);
}

export const getProfile = () => getMeta<Profile | null>("profile", null);
export const setProfile = (p: Profile) => setMeta("profile", p);

export const getBranches = () => getMeta<Branch[] | null>("branches", null);
export const setBranches = (b: Branch[]) => setMeta("branches", b);

export const getGraph = () => getMeta<Graph | null>("graph", null);
export const setGraph = (g: Graph) => setMeta("graph", g);

export const getCurrentBranch = () => getMeta<string>("currentBranch", "main");
export const setCurrentBranch = (n: string) => setMeta("currentBranch", n);

// ---- Offline draft queue ---------------------------------------------------

export async function queueDraft(id: string, wav: Blob): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.put("drafts", { id, wav, createdAt: Date.now() });
  }, undefined);
}

export async function dequeueDraft(id: string): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.delete("drafts", id);
  }, undefined);
}

export async function pendingDrafts(): Promise<{ id: string; wav: Blob; createdAt: number }[]> {
  return safe(async () => {
    const d = await db();
    return (await d.getAll("drafts")) as any[];
  }, []);
}

export async function wipeAll(): Promise<void> {
  await safe(async () => {
    const d = await db();
    await d.clear("thoughtforms");
    await d.clear("meta");
    await d.clear("drafts");
  }, undefined);
}
