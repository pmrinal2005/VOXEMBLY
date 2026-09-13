import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** User / Cognitive Twin profile (one row per local or authenticated identity). */
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Thoughtform commits — the atomic unit of VOXEMBLY. */
export const thoughtforms = pgTable(
  "thoughtforms",
  {
    id: text("id").primaryKey(),
    commitHash: text("commit_hash").notNull(),
    branch: text("branch").notNull(),
    userId: text("user_id").notNull().default("local"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("thoughtforms_commit_hash_idx").on(t.commitHash),
    index("thoughtforms_branch_idx").on(t.branch),
  ],
);

/** Git-style branch refs. */
export const branches = pgTable("branches", {
  name: text("name").primaryKey(),
  userId: text("user_id").notNull().default("local"),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Public Thoughtform artifacts at /t/{hash}.
 * This is the server-side share plane (Postgres via Drizzle) so a published
 * link works from any browser — the $0 replacement for Supabase.
 */
export const publishedThoughtforms = pgTable("published_thoughtforms", {
  hash: text("hash").primaryKey(),
  author: text("author").notNull().default("Anonymous"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  thoughtform: jsonb("thoughtform").notNull(),
  snapshot: jsonb("snapshot").notNull(),
});

/** AssemblyAI session_id traces + agent/council events. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_events_session_idx").on(t.sessionId)],
);
