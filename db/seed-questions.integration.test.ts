import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "./schema";
import { seedUser } from "./seed";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "./seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "./test/database";

afterAll(closePool);

async function user(db: TestDb) {
  const email = "seed-questions-fixture@example.test";
  await seedUser(db, email);
  const [row] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
  return row.id;
}

// 12 §3 step 9: what production's seed writes after the user row — rubric v1.0 and the set pieces,
// for `ja` and `en` alike. Both are idempotent, and neither rewrites a stored row (04 §5).
describe("the rubric and set-piece seeds, in the form 12 §3 step 9 seeds", () => {
  it("seeds rubric v1.0 in both languages, once: six dimensions in English, seven in Japanese", () =>
    inRolledBackTransaction(async (db) => {
      expect(await seedRubrics(db)).toBe(2);
      expect(await seedRubrics(db)).toBe(0);

      const rows = await db.select().from(s.rubricVersions).orderBy(asc(s.rubricVersions.language));
      expect(rows.map((row) => `${row.language} ${row.versionLabel}`)).toEqual(["en v1.0", "ja v1.0"]);
      const keys = (row: (typeof rows)[number]) => (row.dimensions as { key: string }[]).map((dimension) => dimension.key);
      const shared = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];
      expect(keys(rows[0])).toEqual(shared);
      expect(keys(rows[1])).toEqual([...shared, "keigo"]);
      for (const row of rows) {
        for (const dimension of row.dimensions as { definition: { anchors: string[] } }[]) {
          expect(dimension.definition.anchors).toHaveLength(5);
        }
      }
    }));

  it("seeds the four set pieces in each language under its content version, once, in the order asked", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      expect(await seedSetPieces(db, userId)).toBe(8);
      expect(await seedSetPieces(db, userId)).toBe(0);

      const rows = await db
        .select()
        .from(s.questions)
        .where(eq(s.questions.userId, userId))
        .orderBy(asc(s.questions.language), asc(s.questions.createdAt));
      expect(rows.every((row) => row.origin === "set_piece" && row.generatorModelId === null && row.retiredAt === null)).toBe(true);
      const ja = rows.filter((row) => row.language === "ja");
      const en = rows.filter((row) => row.language === "en");
      for (const set of [ja, en]) expect(set.map((row) => row.roundType)).toEqual(["hr", "hr", "hr", "ceo"]);
      expect(new Set(ja.map((row) => row.generatorPromptVersion))).toEqual(new Set(["set-piece-ja-1.0"]));
      expect(new Set(en.map((row) => row.generatorPromptVersion))).toEqual(new Set(["set-piece-en-1.0"]));
      // The self-introduction is asked first (06, 2026-10-01).
      expect(ja[0].body).toBe("まず、簡単に自己紹介をお願いします。");
      expect(en[0].body).toBe("Could you start by introducing yourself?");
    }));

  // 12 §1: fixtures for `develop` and local only, stamped so no chart takes them for the generator's.
  it("seeds the synthetic bank in both languages, once, enough to fill a round of every type", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      expect(await seedSyntheticQuestions(db, userId)).toBe(34);
      expect(await seedSyntheticQuestions(db, userId)).toBe(0);

      const rows = await db.select().from(s.questions).where(eq(s.questions.userId, userId));
      for (const language of ["ja", "en"] as const) {
        const bank = rows.filter((row) => row.language === language);
        expect(bank).toHaveLength(17);
        expect(new Set(bank.map((row) => row.generatorPromptVersion))).toEqual(new Set([`synthetic-generated-${language}-1.0`]));
        for (const roundType of s.ROUND_TYPES) {
          expect(bank.filter((row) => row.roundType === roundType).length).toBeGreaterThanOrEqual(3);
        }
      }
    }));
});
