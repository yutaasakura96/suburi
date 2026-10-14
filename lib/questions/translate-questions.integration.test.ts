import { asc, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSetPieceEnglish, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertAnswer, insertAttempt, insertRound, insertWorld } from "../../db/test/fixtures";
import type { QuestionTranslationInput, QuestionTranslator } from "../ai/translate-question";
import { ModelCallFailed } from "../ai/upstream";
import { RewriteRefused, translateQuestions, type TranslationEvent } from "./translate-questions";
import { TranslationRefused, appendTranslation, questionEnglish } from "./translations";

// 11 §3.25: a question's English never touches the question. `scripts/translate-questions.mts`'s
// work, against the migrated test database, with the translator faked (11 §2).

afterAll(closePool);

// Recognisable text that must never reach the script's output (12 §7).
const SENTINEL = "QUOKKA-SENTINEL-6620";

function fakeTranslator(
  respond: (input: QuestionTranslationInput) => string = (input) => `English of ${input.body} ${SENTINEL}`,
): QuestionTranslator & { calls: number } {
  const fake = {
    modelId: "fake-translate-2026-01-01",
    promptVersion: "translate-question-en-fake",
    calls: 0,
    async translate(input: QuestionTranslationInput) {
      fake.calls += 1;
      return { english: respond(input), tokensIn: 120, tokensOut: 30 };
    },
  };
  return fake;
}

async function user(db: TestDb) {
  const email = "translate-fixture@example.test";
  await seedUser(db, email);
  const [row] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, email));
  return row.id;
}

/** Every row of the tables a translation must leave alone, as text: byte-identical or not. */
async function untouchable(db: TestDb) {
  const tables = ["questions", "round_questions", "answers", "scoring_attempts", "rounds"];
  const snapshot: Record<string, string> = {};
  for (const table of tables) {
    const result = await db.execute<{ rows: string }>(
      sql`select coalesce(json_agg(t order by t::text)::text, '[]') as rows from ${sql.identifier(table)} t`,
    );
    snapshot[table] = result.rows[0].rows;
  }
  return snapshot;
}

describe("scripts/translate-questions.mts (12 §1)", () => {
  it("writes an English only for a Japanese question with none, with its tokens, and never touches questions", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      await seedSetPieces(db, userId);
      await seedSyntheticQuestions(db, userId);
      // The set pieces already carry their hand-written English.
      await seedSetPieceEnglish(db, userId);
      const before = await untouchable(db);
      const translator = fakeTranslator();
      const events: TranslationEvent[] = [];

      expect(await translateQuestions(db, translator, { rewrite: null }, (event) => events.push(event))).toEqual({
        written: 17,
        failed: 0,
      });
      expect(translator.calls).toBe(17);
      const written = await db.select().from(s.questionTranslations).where(eq(s.questionTranslations.source, "translated"));
      expect(written).toHaveLength(17);
      for (const row of written) {
        expect(row).toMatchObject({
          userId,
          language: "en",
          modelId: "fake-translate-2026-01-01",
          promptVersion: "translate-question-en-fake",
          tokensIn: 120,
          tokensOut: 30,
        });
      }
      // No English question was sent, and none got an English.
      const english = await db
        .select({ id: s.questionTranslations.id })
        .from(s.questionTranslations)
        .innerJoin(s.questions, eq(s.questions.id, s.questionTranslations.questionId))
        .where(eq(s.questions.language, "en"));
      expect(english).toEqual([]);

      // A second run finds nothing left to translate.
      expect(await translateQuestions(db, translator, { rewrite: null }, () => {})).toEqual({ written: 0, failed: 0 });
      expect(translator.calls).toBe(17);

      expect(await untouchable(db)).toEqual(before);
      // Ids and events only: no question and no English in what the script prints.
      expect(JSON.stringify(events)).not.toContain(SENTINEL);
      expect(JSON.stringify(events)).not.toMatch(/[ぁ-んァ-ン一-龯]/u);
    }));

  it("re-writes one question as a new row beside the old, the newest wins, and no answer or stamp moves", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const answer = await insertAnswer(db, world, round);
      await insertAttempt(db, world, answer);
      const [first] = await db
        .insert(s.questionTranslations)
        .values({
          questionId: world.questionId,
          userId: world.userId,
          language: "en",
          body: "The first English.",
          source: "translated",
          modelId: "fake-translate-2026-01-01",
          promptVersion: "translate-question-en-fake",
          createdAt: new Date(Date.now() - 60_000),
        })
        .returning();
      const before = await untouchable(db);

      const run = await translateQuestions(db, fakeTranslator(() => "The re-written English."), { rewrite: world.questionId }, () => {});
      expect(run).toEqual({ written: 1, failed: 0 });

      const rows = await db
        .select()
        .from(s.questionTranslations)
        .where(eq(s.questionTranslations.questionId, world.questionId))
        .orderBy(asc(s.questionTranslations.createdAt));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(first);
      expect(rows[1].body).toBe("The re-written English.");
      expect(await questionEnglish(db, world.questionId)).toBe("The re-written English.");
      expect(await untouchable(db)).toEqual(before);
    }));

  it("reports a failed call by its class and leaves that question without an English", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const failing: QuestionTranslator = {
        modelId: "fake-translate-2026-01-01",
        promptVersion: "translate-question-en-fake",
        translate: async () => {
          throw new ModelCallFailed("Question translation", "malformed_output");
        },
      };
      const events: TranslationEvent[] = [];
      expect(await translateQuestions(db, failing, { rewrite: null }, (event) => events.push(event))).toEqual({ written: 0, failed: 1 });
      expect(events).toEqual([{ event: "translation_failed", question_id: world.questionId, error_class: "malformed_output" }]);
      expect(await db.select().from(s.questionTranslations)).toEqual([]);
    }));

  it("refuses to re-write a question that does not exist or is not Japanese, and the writer an English of an English one", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await user(db);
      await seedSetPieces(db, userId);
      const [english] = await db.select({ id: s.questions.id }).from(s.questions).where(eq(s.questions.language, "en")).limit(1);
      const translator = fakeTranslator();

      await expect(translateQuestions(db, translator, { rewrite: crypto.randomUUID() }, () => {})).rejects.toEqual(
        new RewriteRefused("no_such_question"),
      );
      await expect(translateQuestions(db, translator, { rewrite: english.id }, () => {})).rejects.toEqual(
        new RewriteRefused("not_japanese"),
      );
      await expect(
        appendTranslation(db, {
          questionId: english.id,
          body: "Already English.",
          source: "translated",
          modelId: "fake-translate-2026-01-01",
          promptVersion: "translate-question-en-fake",
        }),
      ).rejects.toEqual(new TranslationRefused("same_language"));
      expect(translator.calls).toBe(0);
      expect(await db.select().from(s.questionTranslations)).toEqual([]);
    }));
});
