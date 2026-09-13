/** Optional Supabase admin — unused. Persistence is Drizzle/Postgres. */
export function getSupabaseAdmin(): null {
  return null;
}

export function supabaseAdmin(): null {
  return getSupabaseAdmin();
}
