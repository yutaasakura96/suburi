import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { historyDetail } from "../app/(app)/history/load";
import { listRounds } from "../lib/round/list-rounds";
import * as s from "./schema";
import { seedSyntheticCv } from "./seed-cv";
import { seedRubrics, seedSyntheticQuestions } from "./seed-questions";
import { SYNTHETIC_MODEL_ID, SYNTHETIC_ROUNDS, seedSyntheticRounds, syntheticId } from "./seed-rounds";
import { closePool, inRolledBackTransaction, type TestDb } from "./test/database";
import { insertUser } from "./test/fixtures";

afterAll(closePool);

/** What `db:seed:develop` seeds before the rounds (12 §1). */
async function seeded(db: TestDb) {
  const userId = await insertUser(db);
  for (const language of ["ja", "en"] as const) await seedSyntheticCv(db, userId, language);
  await seedRubrics(db);
  await seedSyntheticQuestions(db, userId);
  return userId;
}

const NOW = new Date("2026-10-04T03:00:00.000Z");

// 12 §1: History needs a round in each state it shows, as fixtures.
describe("the synthetic round seed", () => {
  it("seeds a completed, a pending, a failed and an abandoned round, once", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      expect(await seedSyntheticRounds(db, userId)).toBe(4);
      expect(await seedSyntheticRounds(db, userId)).toBe(0);

      const page = await listRounds(db, userId, { limit: 20, cursor: null }, NOW);
      expect(
        page.items.map((round) => [round.started_at.slice(0, 10), round.language, round.round_type, round.status, round.scoring]),
      ).toEqual([
        ["2026-09-12", "ja", "behavioural", "complete", { ok: 5, pending: 0, failed: 0 }],
        ["2026-09-06", "en", "technical", "complete", { ok: 5, pending: 1, failed: 0 }],
        ["2026-08-22", "en", "ceo", "complete", { ok: 4, pending: 0, failed: 1 }],
        ["2026-08-19", "en", "behavioural", "abandoned", { ok: 1, pending: 0, failed: 0 }],
      ]);
      expect(page.items.every((round) => round.mode === "realistic" && round.length === 3)).toBe(true);
    }));

  it("is idempotent per round: a round already held is left as it is and only the missing ones are written", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      await seedSyntheticRounds(db, userId);
      const before = await db.select().from(s.answers).where(eq(s.answers.userId, userId)).orderBy(asc(s.answers.id));

      expect(await seedSyntheticRounds(db, userId)).toBe(0);
      expect(await db.select().from(s.answers).where(eq(s.answers.userId, userId)).orderBy(asc(s.answers.id))).toEqual(before);
      expect(await db.$count(s.rounds, eq(s.rounds.userId, userId))).toBe(SYNTHETIC_ROUNDS.length);
    }));

  it("stamps every row as a fixture no model produced, with no recording and both transcripts", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      await seedSyntheticRounds(db, userId);

      const attempts = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.userId, userId));
      expect(attempts).toHaveLength(17);
      expect(new Set(attempts.map((attempt) => attempt.modelId))).toEqual(new Set([SYNTHETIC_MODEL_ID]));
      expect(new Set(attempts.map((attempt) => attempt.scoringPromptVersion))).toEqual(
        new Set(["synthetic-score-en-1.0", "synthetic-score-ja-1.0"]),
      );
      expect(attempts.every((attempt) => attempt.tokensIn === null && !attempt.isSuperseding)).toBe(true);

      const answers = await db.select().from(s.answers).where(eq(s.answers.userId, userId));
      expect(answers.every((answer) => answer.audioS3Key === null && answer.transcriberModelId === null)).toBe(true);
      expect(answers.every((answer) => answer.transcriptRaw !== null && answer.transcriptCorrected !== null)).toBe(true);
      // A first attempt is a bank question's, never a follow-up's (04 `answers`).
      expect(answers.filter((answer) => answer.isFirstAttempt)).toHaveLength(10);
      expect(answers.filter((answer) => answer.questionId === null).every((answer) => !answer.isFirstAttempt)).toBe(true);
    }));

  it("scores every dimension of the rubric the round is stamped with, and nothing that combines them", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      await seedSyntheticRounds(db, userId);

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, syntheticId(userId, "complete-ja")));
      const detail = await historyDetail(db, round, NOW);
      expect(detail.dimensions.map((dimension) => dimension.key)).toEqual([
        "structure",
        "evidence",
        "relevance",
        "fluency",
        "accuracy",
        "length_pacing",
        "keigo",
      ]);
      // 10 §10's sample row, and its consistency requirement with Progress and round feedback.
      expect(detail.rows[0]).toMatchObject({ kind: "answer", scoring: { state: "ok", values: [4, 3, 4, 3, 4, 2, 3] } });
      expect(detail.rows.map((row) => row.kind)).toEqual(["answer", "answer", "answer", "follow_up_missing", "answer", "answer"]);
      expect(detail.translated).toBe(true);
      expect(detail.feltPressure).toBe(4);

      const dimensions = await db
        .selectDistinct({ dimension: s.scores.dimension })
        .from(s.scores)
        .innerJoin(s.scoringAttempts, eq(s.scoringAttempts.id, s.scores.scoringAttemptId))
        .where(eq(s.scoringAttempts.userId, userId));
      expect(dimensions.map((row) => row.dimension).sort()).toEqual(
        ["accuracy", "evidence", "fluency", "keigo", "length_pacing", "relevance", "structure"],
      );
    }));

  it("leaves the abandoned round open on its follow-up, and writes feedback only for the completed ones", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      await seedSyntheticRounds(db, userId);

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, syntheticId(userId, "abandoned-en")));
      expect(round.completedAt).toBeNull();
      expect(round.feltPressure).toBeNull();
      const detail = await historyDetail(db, round, NOW);
      expect(detail.round.status).toBe("abandoned");
      expect(detail.rows.map((row) => row.kind)).toEqual(["answer", "follow_up_unanswered", "question_unanswered", "question_unanswered"]);

      const feedback = await db
        .select({ roundId: s.roundFeedback.roundId, modelId: s.roundFeedback.modelId })
        .from(s.roundFeedback)
        .where(
          inArray(
            s.roundFeedback.roundId,
            SYNTHETIC_ROUNDS.map((fixture) => syntheticId(userId, fixture.name)),
          ),
        );
      expect(feedback).toHaveLength(3);
      expect(feedback.some((row) => row.roundId === round.id)).toBe(false);
      expect(feedback.every((row) => row.modelId === SYNTHETIC_MODEL_ID)).toBe(true);
    }));

  it("claims a first attempt only where the question has no earlier answer in that language", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await seeded(db);
      // A round made on `develop` before the seed ran, answering one of the questions the seed uses.
      const body = "Tell me about the most difficult problem you solved in the last year.";
      const [question] = await db.select().from(s.questions).where(eq(s.questions.body, body));
      const [cv] = await db.select().from(s.cvVersions).where(eq(s.cvVersions.language, "en"));
      const [rubric] = await db.select().from(s.rubricVersions).where(eq(s.rubricVersions.language, "en"));
      const [context] = await db.insert(s.roleContexts).values({ userId, kind: "general" }).returning();
      const [earlier] = await db
        .insert(s.rounds)
        .values({
          userId,
          roundType: "behavioural",
          language: "en",
          mode: "practice",
          length: 3,
          perAnswerCapSeconds: 900,
          cvVersionId: cv.id,
          roleContextId: context.id,
          rubricVersionId: rubric.id,
        })
        .returning();
      await db
        .insert(s.answers)
        .values({ roundId: earlier.id, userId, questionId: question.id, promptText: body, position: 1, language: "en" });

      await seedSyntheticRounds(db, userId);

      const [again] = await db.select().from(s.answers).where(eq(s.answers.id, syntheticId(userId, "abandoned-en:q1")));
      expect(again.questionId).toBe(question.id);
      expect(again.isFirstAttempt).toBe(false);
      expect(await db.$count(s.roleContexts, eq(s.roleContexts.userId, userId))).toBe(1);
    }));

  it("refuses to seed onto a database without the CV, rubric and questions it stamps", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      await expect(seedSyntheticRounds(db, userId)).rejects.toThrow(/must be seeded before/);
    }));
});
