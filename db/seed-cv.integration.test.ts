import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { saveCvVersion } from "../lib/cv/save-cv-version";
import * as s from "./schema";
import { SYNTHETIC_CV, seedSyntheticCv, syntheticCvVersion } from "./seed-cv";
import { closePool, inRolledBackTransaction, type TestDb } from "./test/database";
import { insertUser } from "./test/fixtures";

afterAll(closePool);

function versions(db: TestDb, userId: string) {
  return db
    .select({
      language: s.cvVersions.language,
      versionLabel: s.cvVersions.versionLabel,
      extractorModelId: s.cvVersions.extractorModelId,
      extractorPromptVersion: s.cvVersions.extractorPromptVersion,
    })
    .from(s.cvVersions)
    .where(eq(s.cvVersions.userId, userId))
    .orderBy(s.cvVersions.language);
}

describe("the synthetic CV seed", () => {
  it("seeds v1 in each language, with its documents and null extractor stamps", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);

      expect(await seedSyntheticCv(db, userId, "ja")).toBe(true);
      expect(await seedSyntheticCv(db, userId, "en")).toBe(true);

      expect(await versions(db, userId)).toEqual([
        { language: "en", versionLabel: "CV v1", extractorModelId: null, extractorPromptVersion: null },
        { language: "ja", versionLabel: "応募書類 v1", extractorModelId: null, extractorPromptVersion: null },
      ]);
      const documents = await db
        .select({ kind: s.cvDocuments.kind, title: s.cvDocuments.title })
        .from(s.cvDocuments)
        .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.cvDocuments.cvVersionId))
        .where(eq(s.cvDocuments.userId, userId))
        .orderBy(s.cvVersions.language, s.cvDocuments.position);
      expect(documents).toEqual([
        { kind: "cv", title: null },
        { kind: "additional", title: "PostgreSQL migration" },
        { kind: "rirekisho", title: null },
        { kind: "shokumu_keirekisho", title: null },
        { kind: "additional", title: "在庫連携バッチ再設計" },
      ]);
    }));

  it("stores spans that Postgres slices back to every fixture quote", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await seedSyntheticCv(db, userId, "ja");
      await seedSyntheticCv(db, userId, "en");

      // Postgres counts code points, as the span checker does; 𠮷 in the 履歴書 would expose a mismatch.
      const { rows } = await db.execute<{ language: string; quote: string }>(sql`
        select v.language, substring(v.body from c.span_start + 1 for c.span_end - c.span_start) as quote
        from cv_claims c join cv_versions v on v.id = c.cv_version_id
        where c.user_id = ${userId}
        order by v.language, c.span_start`);
      const quotes = (language: "ja" | "en") => rows.filter((row) => row.language === language).map((row) => row.quote);
      expect(quotes("ja")).toEqual(SYNTHETIC_CV.ja.flatMap((document) => document.claims));
      expect(quotes("en")).toEqual(SYNTHETIC_CV.en.flatMap((document) => document.claims));
    }));

  it("is idempotent: a second run leaves one version per language", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await seedSyntheticCv(db, userId, "ja");
      await seedSyntheticCv(db, userId, "en");

      expect(await seedSyntheticCv(db, userId, "ja")).toBe(false);
      expect(await seedSyntheticCv(db, userId, "en")).toBe(false);

      expect((await versions(db, userId)).map((row) => row.versionLabel)).toEqual(["CV v1", "応募書類 v1"]);
    }));

  it("skips a language that already has any version, even one the seed did not write", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      const saved = syntheticCvVersion(userId, "en", [
        { kind: "cv", title: null, text: "Wrote the on-call runbook.", claims: ["Wrote the on-call runbook."] },
      ]);
      await saveCvVersion(db, { ...saved, extractorModelId: "fake-extractor", extractorPromptVersion: "cv-extract-en-fake" });

      expect(await seedSyntheticCv(db, userId, "en")).toBe(false);
      expect(await seedSyntheticCv(db, userId, "ja")).toBe(true);

      expect(await versions(db, userId)).toEqual([
        { language: "en", versionLabel: "CV v1", extractorModelId: "fake-extractor", extractorPromptVersion: "cv-extract-en-fake" },
        { language: "ja", versionLabel: "応募書類 v1", extractorModelId: null, extractorPromptVersion: null },
      ]);
    }));
});
