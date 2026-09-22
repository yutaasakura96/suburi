import { and, asc, count, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema.ts";

type Db = Pick<NodePgDatabase, "select">;

// Postgres refuses a malformed uuid with an error rather than no rows; an id from a URL is either a
// version of this user's or a 404, never a 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A version with its documents in `position` order and its claims' spans.
async function withParts(db: Db, version: typeof s.cvVersions.$inferSelect) {
  const documents = await db
    .select()
    .from(s.cvDocuments)
    .where(eq(s.cvDocuments.cvVersionId, version.id))
    .orderBy(asc(s.cvDocuments.position));
  const claims = await db
    .select({
      id: s.cvClaims.id,
      textNormalised: s.cvClaims.textNormalised,
      start: s.cvClaims.spanStart,
      end: s.cvClaims.spanEnd,
    })
    .from(s.cvClaims)
    .where(eq(s.cvClaims.cvVersionId, version.id))
    .orderBy(asc(s.cvClaims.spanStart));
  return { version, documents, claims };
}

/**
 * The current CV version in a language (04): the newest by `created_at` for this user. No flag, no
 * pointer. Scoped by `user_id`, so another user's version is indistinguishable from none (07 §1).
 * This is what round creation resolves; nothing lets a round name another version (07 §6).
 */
export async function currentCvVersion(db: Db, userId: string, language: "ja" | "en") {
  const [version] = await db
    .select()
    .from(s.cvVersions)
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)))
    .orderBy(desc(s.cvVersions.createdAt))
    .limit(1);
  return version ? withParts(db, version) : null;
}

/** One version of this user's, current or not, read-only (10 §13). Another user's id is `null`. */
export async function cvVersionById(db: Db, userId: string, id: string) {
  if (!UUID.test(id)) return null;
  const [version] = await db
    .select()
    .from(s.cvVersions)
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.id, id)));
  return version ? withParts(db, version) : null;
}

/**
 * Every version in a language but the current one, newest first, with its claim count: the history
 * below the current version (10 §13). Labels and counts only — no body.
 */
export async function cvVersionHistory(db: Db, userId: string, language: "ja" | "en") {
  const rows = await db
    .select({
      id: s.cvVersions.id,
      versionLabel: s.cvVersions.versionLabel,
      createdAt: s.cvVersions.createdAt,
      claimCount: count(s.cvClaims.id),
    })
    .from(s.cvVersions)
    .leftJoin(s.cvClaims, eq(s.cvClaims.cvVersionId, s.cvVersions.id))
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)))
    .groupBy(s.cvVersions.id)
    .orderBy(desc(s.cvVersions.createdAt));
  return rows.slice(1);
}
