import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as s from "./schema";
import { closePool, expectRefused, inRolledBackTransaction } from "./test/database";
import {
  answerValues,
  attemptValues,
  insertAnswer,
  insertAttempt,
  insertRound,
  insertWorld,
  roundValues,
} from "./test/fixtures";

// docs/11-testing-plan.md §3.1. These may not be deleted to make a refactor pass; if one becomes
// inconvenient, the invariant has changed and docs/04-database-schema.md is amended first.

afterAll(closePool);

describe("the measurement record refuses", () => {
  it("a second first attempt for the same question and language", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const firstRound = await insertRound(db, world);
      const secondRound = await insertRound(db, world);
      await insertAnswer(db, world, firstRound, { isFirstAttempt: true });

      await expectRefused(
        db,
        () =>
          db.insert(s.answers).values(answerValues(world, secondRound, { isFirstAttempt: true })),
        { kind: "unique", constraint: "answers_first_attempt_uniq" },
      );
    }));

  it("a follow-up marked as a first attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const parent = await insertAnswer(db, world, round);

      await expectRefused(
        db,
        () =>
          db.insert(s.answers).values(
            answerValues(world, round, {
              questionId: null,
              parentAnswerId: parent,
              position: 2,
              isFirstAttempt: true,
            }),
          ),
        { kind: "check", constraint: "answers_follow_up_not_first_attempt_check" },
      );
    }));

  it("a retry overwriting its original: the retry is a new row and the original keeps the flag", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const original = await insertAnswer(db, world, round, { isFirstAttempt: true });

      await expectRefused(
        db,
        () =>
          db
            .insert(s.answers)
            .values(answerValues(world, round, { retryOfAnswerId: original, isFirstAttempt: true })),
        { kind: "unique", constraint: "answers_first_attempt_uniq" },
      );

      const retry = await insertAnswer(db, world, round, { retryOfAnswerId: original });
      const rows = await db
        .select({ id: s.answers.id, isFirstAttempt: s.answers.isFirstAttempt })
        .from(s.answers)
        .where(eq(s.answers.roundId, round));

      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual({ id: original, isFirstAttempt: true });
      expect(rows).toContainEqual({ id: retry, isFirstAttempt: false });
    }));

  it("a felt-pressure rating on a practice round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);

      await expectRefused(
        db,
        () => db.insert(s.rounds).values(roundValues(world, { mode: "practice", feltPressure: 3 })),
        { kind: "check", constraint: "rounds_practice_no_pressure_check" },
      );
    }));

  it.each([0, 6])("felt pressure of %i", (feltPressure) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);

      await expectRefused(
        db,
        () => db.insert(s.rounds).values(roundValues(world, { feltPressure })),
        { kind: "check", constraint: "rounds_felt_pressure_range_check" },
      );
    }),
  );

  it.each([
    ["cvVersionId", "cv_version_id"],
    ["rubricVersionId", "rubric_version_id"],
    // Stamp 3 (06, 2026-09-27): a set piece's content version, never a null.
    ["generatorPromptVersion", "generator_prompt_version"],
    ["modelId", "model_id"],
    ["scoringPromptVersion", "scoring_prompt_version"],
  ] as const)("a scoring attempt without its %s stamp", (field, column) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const answer = await insertAnswer(db, world, round);
      const unstamped = { ...attemptValues(world, answer), [field]: null };

      await expectRefused(
        db,
        // Deliberately ill-typed: the point is that the database refuses it too.
        () => db.insert(s.scoringAttempts).values(unstamped as typeof s.scoringAttempts.$inferInsert),
        { kind: "not_null", column },
      );
    }),
  );

  it.each([0, 6])("a score of %i", (value) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const attempt = await insertAttempt(db, world, await insertAnswer(db, world, round));

      await expectRefused(
        db,
        () => db.insert(s.scores).values({ scoringAttemptId: attempt, dimension: "structure", value }),
        { kind: "check", constraint: "scores_value_range_check" },
      );
    }),
  );

  it("two scores for one dimension in one attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const attempt = await insertAttempt(db, world, await insertAnswer(db, world, round));
      await db.insert(s.scores).values({ scoringAttemptId: attempt, dimension: "keigo", value: 4 });

      await expectRefused(
        db,
        () => db.insert(s.scores).values({ scoringAttemptId: attempt, dimension: "keigo", value: 2 }),
        { kind: "unique", constraint: "scores_scoring_attempt_id_dimension_unique" },
      );
    }));

  it.each([
    [10, 10],
    [10, 4],
  ])("a claim span from %i to %i", (spanStart, spanEnd) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);

      await expectRefused(
        db,
        () =>
          db.insert(s.cvClaims).values({
            cvVersionId: world.cvVersionId,
            userId: world.userId,
            textNormalised: "請求処理を40%短縮",
            spanStart,
            spanEnd,
          }),
        { kind: "check", constraint: "cv_claims_span_order_check" },
      );
    }),
  );

  it.each([
    [10, 10],
    [10, 4],
  ])("an answer flag span from %i to %i", (spanStart, spanEnd) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const answer = await insertAnswer(db, world, round);
      const attempt = await insertAttempt(db, world, answer);

      await expectRefused(
        db,
        () =>
          db.insert(s.answerFlags).values({
            answerId: answer,
            scoringAttemptId: attempt,
            userId: world.userId,
            kind: "unsupported",
            spanStart,
            spanEnd,
          }),
        { kind: "check", constraint: "answer_flags_span_order_check" },
      );
    }),
  );

  it("deleting a scoring attempt that raised a flag", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const answer = await insertAnswer(db, world, round);
      const attempt = await insertAttempt(db, world, answer);
      await db.insert(s.answerFlags).values({ answerId: answer, scoringAttemptId: attempt, userId: world.userId, kind: "unsupported", spanStart: 0, spanEnd: 4 });

      await expectRefused(db, () => db.delete(s.scoringAttempts).where(eq(s.scoringAttempts.id, attempt)), {
        kind: "restrict",
        constraint: "answer_flags_scoring_attempt_id_scoring_attempts_id_fk",
      });
    }));

  // 04 `scoring_attempts`: null until `ok`. A pending or failed attempt read no answer.
  it.each(["pending", "failed"] as const)("an answered language on a %s scoring attempt", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const answer = await insertAnswer(db, world, round);

      await expectRefused(
        db,
        () => db.insert(s.scoringAttempts).values({ ...attemptValues(world, answer), status, answeredLanguage: "ja" }),
        { kind: "check", constraint: "scoring_attempts_answered_language_ok_check" },
      );
    }),
  );

  it("an answer that is both a bank question and a follow-up", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const parent = await insertAnswer(db, world, round);

      await expectRefused(
        db,
        () =>
          db.insert(s.answers).values(answerValues(world, round, { parentAnswerId: parent, position: 2 })),
        { kind: "check", constraint: "answers_question_xor_follow_up_check" },
      );
    }));

  it("an answer that is neither a bank question nor a follow-up", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);

      await expectRefused(
        db,
        () => db.insert(s.answers).values(answerValues(world, round, { questionId: null })),
        { kind: "check", constraint: "answers_question_xor_follow_up_check" },
      );
    }));

  it("deleting a question that an answer references", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      await insertAnswer(db, world, round);

      await expectRefused(
        db,
        () => db.delete(s.questions).where(eq(s.questions.id, world.questionId)),
        { kind: "restrict", constraint: "answers_question_id_questions_id_fk" },
      );
    }));
  it("a bank question without the stamp 3 comes from", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await expectRefused(
        db,
        () =>
          db.insert(s.questions).values({
            userId: world.userId,
            language: "en",
            roundType: "hr",
            origin: "set_piece",
            body: "Could you introduce yourself?",
          } as typeof s.questions.$inferInsert),
        { kind: "not_null", column: "generator_prompt_version" },
      );
    }));

  it("a second question at one position of a round, or one question twice in a round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const round = await insertRound(db, world);
      const [other] = await db
        .insert(s.questions)
        .values({
          userId: world.userId,
          language: "ja",
          roundType: "behavioural",
          origin: "generated",
          body: "別の質問。",
          generatorPromptVersion: "generate-fixture",
        })
        .returning({ id: s.questions.id });
      await db.insert(s.roundQuestions).values({ roundId: round, userId: world.userId, position: 1, questionId: world.questionId });

      await expectRefused(
        db,
        () => db.insert(s.roundQuestions).values({ roundId: round, userId: world.userId, position: 1, questionId: other.id }),
        { kind: "unique", constraint: "round_questions_round_id_position_unique" },
      );
      await expectRefused(
        db,
        () => db.insert(s.roundQuestions).values({ roundId: round, userId: world.userId, position: 2, questionId: world.questionId }),
        { kind: "unique", constraint: "round_questions_round_id_question_id_unique" },
      );
      await expectRefused(
        db,
        () => db.insert(s.roundQuestions).values({ roundId: round, userId: world.userId, position: 0, questionId: other.id }),
        { kind: "check", constraint: "round_questions_position_check" },
      );
    }));

  it("a second General practice row for one user", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await expectRefused(
        db,
        () => db.insert(s.roleContexts).values({ userId: world.userId, kind: "general" }),
        { kind: "unique", constraint: "role_contexts_general_uniq" },
      );
    }));
});
