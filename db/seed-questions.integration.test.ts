import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "./schema";
import { seedUser } from "./seed";
import { SET_PIECES_JA_EN } from "../lib/questions/set-pieces";
import { seedRubrics, seedSetPieceEnglish, seedSetPieces, seedSyntheticEnglish, seedSyntheticQuestions } from "./seed-questions";
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

  // 12 §1, English help (#106): each seeded Japanese question's English beside it, hand-written, with
  // no model call. Idempotent, and the question rows are never touched (04 `question_translations`).
  it("seeds the Japanese set pieces' hand-written English, once, beside whichever set pieces the bank holds", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      // A bank with no set pieces yet, as production's before step 9: nothing to write beside.
      expect(await seedSetPieceEnglish(db, userId)).toBe(0);

      await seedSetPieces(db, userId);
      const before = await db.select().from(s.questions).orderBy(asc(s.questions.id));
      expect(await seedSetPieceEnglish(db, userId)).toBe(4);
      expect(await seedSetPieceEnglish(db, userId)).toBe(0);

      const rows = await db
        .select({ translation: s.questionTranslations, question: s.questions })
        .from(s.questionTranslations)
        .innerJoin(s.questions, eq(s.questions.id, s.questionTranslations.questionId));
      expect(rows).toHaveLength(4);
      for (const { translation, question } of rows) {
        expect(question.language).toBe("ja");
        expect(translation).toMatchObject({
          userId,
          language: "en",
          source: "hand_written",
          modelId: null,
          promptVersion: "set-piece-ja-en-1.0",
          tokensIn: null,
          tokensOut: null,
          body: SET_PIECES_JA_EN.english.get(question.body),
        });
      }
      expect(await db.select().from(s.questions).orderBy(asc(s.questions.id))).toEqual(before);
    }));

  it("seeds the synthetic Japanese questions' English, once, from the parallel English list", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      await seedSyntheticQuestions(db, userId);
      expect(await seedSyntheticEnglish(db, userId)).toBe(17);
      expect(await seedSyntheticEnglish(db, userId)).toBe(0);

      const rows = await db
        .select({ body: s.questionTranslations.body, version: s.questionTranslations.promptVersion, question: s.questions.body })
        .from(s.questionTranslations)
        .innerJoin(s.questions, eq(s.questions.id, s.questionTranslations.questionId));
      expect(new Set(rows.map((row) => row.version))).toEqual(new Set(["synthetic-generated-ja-en-1.0"]));
      expect(rows.find((row) => row.question === "仕事での失敗と、そのあとに変えたことを教えてください。")?.body).toBe(
        "Tell me about a mistake you made at work and what you changed afterwards.",
      );
    }));
});
