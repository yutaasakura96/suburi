import { and, asc, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";

type Db = Pick<NodePgDatabase, "select">;

/**
 * The current CV version in a language (04): the newest by `created_at` for this user. No flag, no
 * pointer. Scoped by `user_id`, so another user's version is indistinguishable from none (07 §1).
 * Returns the version with its documents in `position` order and its claims' spans.
 */
export async function currentCvVersion(db: Db, userId: string, language: "ja" | "en") {
  const [version] = await db
    .select()
    .from(s.cvVersions)
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)))
    .orderBy(desc(s.cvVersions.createdAt))
    .limit(1);
  if (!version) return null;

  const documents = await db
    .select()
    .from(s.cvDocuments)
    .where(eq(s.cvDocuments.cvVersionId, version.id))
    .orderBy(asc(s.cvDocuments.position));
  const claims = await db
    .select({ start: s.cvClaims.spanStart, end: s.cvClaims.spanEnd })
    .from(s.cvClaims)
    .where(eq(s.cvClaims.cvVersionId, version.id));

  return { version, documents, claims };
}
