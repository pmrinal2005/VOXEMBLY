/**
 * Supabase — OPTIONAL. When the env vars are absent VOXEMBLY runs in "Local Twin" mode
 * (IndexedDB only, zero accounts, $0) and every helper here degrades to a no-op.
 * Postgres holds the relational planes + pgvector; temporal edges are modelled in the
 * thoughtform rows themselves (valid_from / valid_to live on the graph mutations), so no
 * graph database is required for Time Travel.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let browser: SupabaseClient | null = null;

/** Browser client (RLS-scoped to the signed-in user). null when unconfigured. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!browser) browser = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return browser;
}

export type TwinMode = "local" | "cloud";

export function twinMode(): TwinMode {
  return supabaseConfigured() ? "cloud" : "local";
}
