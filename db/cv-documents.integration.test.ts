import { eq } from "drizzle-orm";
import { afterAll, describe, it } from "vitest";
import * as s from "./schema";
import { closePool, expectRefused, inRolledBackTransaction, type TestDb } from "./test/database";
import { insertCvVersion, insertUser } from "./test/fixtures";

// docs/04-database-schema.md, cv_versions and cv_documents: the constraints that keep a CV version
// one exact, immutable set of documents.

afterAll(closePool);

function document(cvVersionId: string, userId: string, overrides: Partial<typeof s.cvDocuments.$inferInsert> = {}) {
  return {
    cvVersionId,
    userId,
    kind: "cv",
    position: 0,
    start: 0,
    end: 10,
    ...overrides,
  } satisfies typeof s.cvDocuments.$inferInsert;
}

async function version(db: TestDb) {
  const userId = await insertUser(db);
  return { userId, cvVersionId: await insertCvVersion(db, userId) };
}

describe("cv_documents refuses", () => {
  it("an additional document with no title", () =>
    inRolledBackTransaction(async (db) => {
      const { userId, cvVersionId } = await version(db);
      await expectRefused(
        db,
        () => db.insert(s.cvDocuments).values(document(cvVersionId, userId, { kind: "additional" })),
        { kind: "check", constraint: "cv_documents_title_check" },
      );
    }));

  it("a title on any other kind", () =>
    inRolledBackTransaction(async (db) => {
      const { userId, cvVersionId } = await version(db);
      await expectRefused(
        db,
        () => db.insert(s.cvDocuments).values(document(cvVersionId, userId, { title: "CV" })),
        { kind: "check", constraint: "cv_documents_title_check" },
      );
    }));

  it("an empty or inverted range", () =>
    inRolledBackTransaction(async (db) => {
      const { userId, cvVersionId } = await version(db);
      await expectRefused(
        db,
        () => db.insert(s.cvDocuments).values(document(cvVersionId, userId, { start: 10, end: 10 })),
        { kind: "check", constraint: "cv_documents_range_order_check" },
      );
    }));

  it("two documents at one position in one version", () =>
    inRolledBackTransaction(async (db) => {
      const { userId, cvVersionId } = await version(db);
      await db.insert(s.cvDocuments).values(document(cvVersionId, userId));
      await expectRefused(
        db,
        () =>
          db
            .insert(s.cvDocuments)
            .values(document(cvVersionId, userId, { kind: "additional", title: "Portfolio" })),
        { kind: "unique", constraint: "cv_documents_cv_version_id_position_unique" },
      );
    }));

  it("deleting the version its documents belong to", () =>
    inRolledBackTransaction(async (db) => {
      const { userId, cvVersionId } = await version(db);
      await db.insert(s.cvDocuments).values(document(cvVersionId, userId));
      await expectRefused(
        db,
        () => db.delete(s.cvVersions).where(eq(s.cvVersions.id, cvVersionId)),
        { kind: "restrict", constraint: "cv_documents_cv_version_id_cv_versions_id_fk" },
      );
    }));
});

describe("cv_versions refuses", () => {
  it("a second version with the same label in the same language for the same user", () =>
    inRolledBackTransaction(async (db) => {
      const { userId } = await version(db);
      await expectRefused(db, () => insertCvVersion(db, userId), {
        kind: "unique",
        constraint: "cv_versions_user_id_language_version_label_uniq",
      });
    }));

  it("nothing when another user, or the other language, uses the same number", () =>
    inRolledBackTransaction(async (db) => {
      const { userId } = await version(db);
      await insertCvVersion(db, await insertUser(db));
      await db
        .insert(s.cvVersions)
        .values({ userId, versionLabel: "CV v1", language: "en", body: "Invented CV." });
    }));
});
