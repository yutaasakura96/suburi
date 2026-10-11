import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { STUDY_PAGE_ROUNDS, studyPage } from "../../app/(app)/history/study/load";
import * as s from "../../db/schema";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSyntheticQuestions } from "../../db/seed-questions";
import { SYNTHETIC_MODEL_ID, seedSyntheticRounds, syntheticId } from "../../db/seed-rounds";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { decodeCursor } from "./list-rounds";

// The study view's loader (#75, 10 §16), against the migrated test database, over the synthetic
// rounds (12 §1). Every model answer here is an invented fixture, inserted by the test: the seed
// writes none, and nothing in the loader could.

afterAll(closePool);

/** Everything `db:seed:develop` seeds for one user (12 §1). */
async function seededUser(db: TestDb) {
  const userId = await insertUser(db);
  await seedRubrics(db);
  await seedSyntheticCv(db, userId, "en");
  await seedSyntheticCv(db, userId, "ja");
  await seedSyntheticQuestions(db, userId);
  await seedSyntheticRounds(db, userId);
  return userId;
}

function modelAnswer(userId: string, answerId: string, values: Partial<typeof s.modelAnswers.$inferInsert> & { body: string }) {
  return { answerId, userId, modelId: SYNTHETIC_MODEL_ID, promptVersion: "synthetic-model-answer-1.0", ...values };
}

/** A complete round beside the seeded ones, with nothing answered yet. */
async function insertCompleteRound(db: TestDb, userId: string, values: { mode?: "realistic" | "practice"; startedAt: Date | ReturnType<typeof sql> }) {
  const [like] = await db.select().from(s.rounds).where(eq(s.rounds.id, syntheticId(userId, "pending-en")));
  const [round] = await db
    .insert(s.rounds)
    .values({
      userId,
      roundType: "hr",
      language: "en",
      mode: values.mode ?? "realistic",
      length: 3,
      perAnswerCapSeconds: 240,
      cvVersionId: like.cvVersionId,
      roleContextId: like.roleContextId,
      rubricVersionId: like.rubricVersionId,
      startedAt: values.startedAt as Date,
      completedAt: new Date("2026-10-01T00:00:00.000Z"),
    })
    .returning();
  return round;
}

async function insertAnswer(
  db: TestDb,
  round: typeof s.rounds.$inferSelect,
  values: { position: number; corrected: string; retryOf?: string; minute: number },
) {
  const [question] = await db
    .select()
    .from(s.questions)
    .where(and(eq(s.questions.userId, round.userId), eq(s.questions.language, "en"), eq(s.questions.roundType, "hr")))
    .orderBy(asc(s.questions.createdAt))
    .offset(values.position - 1)
    .limit(1);
  const [answer] = await db
    .insert(s.answers)
    .values({
      roundId: round.id,
      userId: round.userId,
      questionId: question.id,
      promptText: question.body,
      position: values.position,
      language: round.language,
      transcriptRaw: `Um, ${values.corrected}`,
      transcriptCorrected: values.corrected,
      retryOfAnswerId: values.retryOf ?? null,
      createdAt: new Date(round.startedAt.getTime() + values.minute * 60_000),
    })
    .returning();
  return answer;
}

/** Every key anywhere in a value: what the screen could possibly be handed. */
function keysOf(value: unknown): Set<string> {
  const keys = new Set<string>();
  (function walk(node: unknown) {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        keys.add(key);
        walk(child);
      }
    }
  })(value);
  return keys;
}

describe("the study view's loader (10 §16)", () => {
  it("lists rounds with submitted answers newest first, including an abandoned round", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const unanswered = await insertCompleteRound(db, userId, { startedAt: new Date("2026-10-02T10:00:00.000Z") });
      const page = await studyPage(db, userId, null);

      expect(page.rounds.map((round) => round.id)).toEqual(["complete-ja", "pending-en", "failed-en", "abandoned-en"].map((name) => syntheticId(userId, name)));
      expect(page.rounds.some((round) => round.id === unanswered.id)).toBe(false);
      expect(page.older).toBeNull();
      expect(page.rounds[0]).toMatchObject({ roundType: "behavioural", language: "ja", mode: "realistic", length: 3, cvLabel: "応募書類 v1" });
      const abandoned = page.rounds[3];
      expect(abandoned).toMatchObject({ complete: false, toFix: null, questions: [{ own: "The hardest was the database migration. We ran dual writes for six weeks and cut over in eleven minutes.", modelAnswer: null, followUp: null }] });
      expect(JSON.stringify(abandoned)).not.toContain("What was the hardest part of those six weeks?");
      expect(JSON.stringify(abandoned)).not.toContain("Describe a time you had to deliver with less time than you needed.");
    }));

  it("reads each question in order, includes answered follow-ups, and omits missing ones", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const [round] = (await studyPage(db, userId, null)).rounds;

      expect(round.questions.map((question) => question.position)).toEqual([1, 2, 3]);
      expect(round.questions[0]).toMatchObject({
        prompt: "この1年で解決した、最も難しかった問題について教えてください。",
        own: "4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。",
        again: [],
        followUp: { prompt: "その判断は誰が下したのですか。", own: "差分連携に切り替え、処理を店舗単位で並列化しました。", again: [] },
      });
      expect(round.questions[1].followUp).toBeNull();
      expect(round.questions[2].followUp).toMatchObject({ own: "結果として、2023年度は遅延がゼロになりました。" });
      // What was said is the correction that was scored; the raw transcript is History's (10 §10).
      expect(JSON.stringify(round)).not.toContain("えー、");
    }));

  it("reads the round's stored to-fix list, and a Japanese round's stored English beside it", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const [japanese, english] = (await studyPage(db, userId, null)).rounds;

      expect(japanese.toFix).toEqual([
        { title: "結論を最初の一文に置く", body: "第1問で、結論が最後に出てくる。" },
        { title: "数値を一つ挙げる", body: "第2問で、成果が抽象的なままである。" },
      ]);
      expect(japanese.toFixTranslated).toEqual([
        { title: "Put the conclusion in the first sentence", body: "In answer 1, the conclusion arrives last." },
        { title: "Name one number", body: "In answer 2, the outcome stays general." },
      ]);
      expect(english.toFix).not.toBeNull();
      expect(english.toFixTranslated).toBeNull();
    }));

  it("says a round has no findings when none were written, and lists its questions all the same", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const round = await insertCompleteRound(db, userId, { startedAt: new Date("2026-09-30T10:00:00.000Z") });
      await insertAnswer(db, round, { position: 1, corrected: "An invented answer.", minute: 1 });

      const [newest] = (await studyPage(db, userId, null)).rounds;
      expect(newest).toMatchObject({ id: round.id, toFix: null, toFixTranslated: null });
      expect(newest.questions).toMatchObject([{ position: 1, own: "An invented answer.", modelAnswer: null, followUp: null }]);
    }));

  it("reads a stored model answer as runs cut at its stored spans, the follow-up's beside the follow-up, and none where none is stored", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const id = (name: string) => syntheticId(userId, name);
      await db.insert(s.modelAnswers).values([
        modelAnswer(userId, id("complete-ja:q1"), {
          body: "夜間処理を短縮しました。売上も倍増しました。",
          unsupportedSpans: [{ start: 12, end: 22 }],
          bodyTranslated: { language: "en", body: "We cut the nightly run. Sales doubled too.", unsupported_spans: [{ start: 24, end: 42 }] },
        }),
        modelAnswer(userId, id("complete-ja:q1:follow-up-answer"), { body: "判断はチームで下しました。" }),
      ]);

      const [round] = (await studyPage(db, userId, null)).rounds;
      expect(round.questions[0].modelAnswer).toEqual({
        segments: [
          { text: "夜間処理を短縮しました。", unsupported: false },
          { text: "売上も倍増しました。", unsupported: true },
        ],
        translated: [
          { text: "We cut the nightly run. ", unsupported: false },
          { text: "Sales doubled too.", unsupported: true },
        ],
      });
      expect(round.questions[0].followUp).toMatchObject({
        modelAnswer: { segments: [{ text: "判断はチームで下しました。", unsupported: false }], translated: null },
      });
      expect(round.questions[1].modelAnswer).toBeNull();
    }));

  it("puts a practice answer-again beside the first answer, in the order given, under the one model answer", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const round = await insertCompleteRound(db, userId, { mode: "practice", startedAt: new Date("2026-09-30T10:00:00.000Z") });
      const first = await insertAnswer(db, round, { position: 1, corrected: "The first answer.", minute: 1 });
      await insertAnswer(db, round, { position: 1, corrected: "The third answer.", retryOf: first.id, minute: 9 });
      await insertAnswer(db, round, { position: 1, corrected: "The second answer.", retryOf: first.id, minute: 5 });
      await db.insert(s.modelAnswers).values(modelAnswer(userId, first.id, { body: "An invented model answer." }));

      const [newest] = (await studyPage(db, userId, null)).rounds;
      // One question, not three: a retry is a row beside the first, and the first is still what is shown first.
      expect(newest.questions).toHaveLength(1);
      expect(newest.questions[0]).toMatchObject({
        own: "The first answer.",
        again: ["The second answer.", "The third answer."],
        modelAnswer: { segments: [{ text: "An invented model answer.", unsupported: false }] },
      });
    }));

  it("never lists another user's rounds", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      const other = await seededUser(db);
      const mine = (await studyPage(db, userId, null)).rounds.map((round) => round.id);
      const theirs = (await studyPage(db, other, null)).rounds.map((round) => round.id);

      expect(mine).toHaveLength(4);
      expect(theirs).toHaveLength(4);
      expect(mine.filter((id) => theirs.includes(id))).toEqual([]);
    }));

  it("pages by cursor without a skipped or repeated round, down to rounds a microsecond apart", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      // Enough newer rounds to fill the first page exactly, the last two a microsecond apart: a
      // millisecond cursor would lose one of them at the page boundary.
      const inserted: string[] = [];
      for (let index = 0; index < STUDY_PAGE_ROUNDS; index += 1) {
        const round = await insertCompleteRound(db, userId, {
          startedAt: sql`'2026-09-30T10:00:00.000000Z'::timestamptz + ${index} * interval '1 microsecond'`,
        });
        await insertAnswer(db, round, { position: 1, corrected: "An invented answer.", minute: 1 });
        inserted.unshift(round.id);
      }

      const first = await studyPage(db, userId, null);
      expect(first.rounds.map((round) => round.id)).toEqual(inserted);
      expect(first.older).not.toBeNull();
      const cursor = decodeCursor(first.older!);
      expect(cursor).not.toBeNull();

      const second = await studyPage(db, userId, cursor);
      expect(second.rounds.map((round) => round.id)).toEqual(["complete-ja", "pending-en", "failed-en", "abandoned-en"].map((name) => syntheticId(userId, name)));
      expect(second.older).toBeNull();
    }));

  it("carries no score, no stamp of a scorer and nothing that combines dimensions: only what the screen draws", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      await db.insert(s.modelAnswers).values(
        modelAnswer(userId, syntheticId(userId, "complete-ja:q1"), {
          body: "夜間処理を短縮しました。",
          bodyTranslated: { language: "en", body: "We cut the nightly run.", unsupported_spans: [] },
        }),
      );
      const page = await studyPage(db, userId, null);

      expect([...keysOf(page)].sort()).toEqual(
        [
          "again", "body", "complete", "cvLabel", "followUp", "id", "language", "length", "mode", "modelAnswer", "older", "own",
          "position", "prompt", "questions", "roundType", "rounds", "segments", "startedAt", "text", "title", "toFix",
          "toFixTranslated", "translated", "unsupported",
        ].sort(),
      );
    }));

  it("reads and never writes: it runs in a read-only transaction", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seededUser(db);
      await db.execute(sql`set transaction read only`);
      expect((await studyPage(db, userId, null)).rounds).toHaveLength(4);
    }));
});
