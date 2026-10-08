import { afterAll, describe, expect, it } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { answerValues, attemptValues, insertRubric, insertWorld, roundValues, type World } from "../../db/test/fixtures";
import { firstAttemptCounts, firstAttempts, seriesOf } from "./first-attempts";
import { boundaries, segments, trendLine } from "./series";

// What Progress plots and what it leaves out (11 §3.5), and where it draws its boundaries (11 §3.6),
// against the migrated test database. These are tests that may not be deleted to make a refactor pass.

afterAll(closePool);

const DAY = 86_400_000;
const START = Date.parse("2026-09-01T01:00:00.000Z");

interface Scored {
  /** Days after the fixture's start: the order the series is plotted in. */
  readonly day: number;
  readonly round?: Partial<typeof s.rounds.$inferInsert>;
  readonly question?: Partial<typeof s.questions.$inferInsert>;
  readonly answer?: Partial<typeof s.answers.$inferInsert>;
  /** Oldest first. Defaults to one `ok` attempt. */
  readonly attempts?: readonly (Partial<typeof s.scoringAttempts.$inferInsert> & { readonly scores?: Record<string, number> })[];
}

const THREES = { structure: 3, evidence: 3 };

/** One answer to its own question in its own round, with its attempts and their scores. */
async function scored(db: TestDb, world: World, fixture: Scored) {
  const at = new Date(START + fixture.day * DAY);
  const language = fixture.round?.language ?? "ja";
  const [question] = await db
    .insert(s.questions)
    .values({
      userId: world.userId,
      language,
      roundType: fixture.round?.roundType ?? "behavioural",
      origin: "generated",
      body: `synthetic question ${fixture.day}-${Math.random()}`,
      generatorPromptVersion: "generate-fixture",
      ...fixture.question,
    })
    .returning({ id: s.questions.id });
  const [round] = await db
    .insert(s.rounds)
    .values(roundValues(world, { startedAt: at, completedAt: new Date(at.getTime() + 1_800_000), ...fixture.round }))
    .returning({ id: s.rounds.id });
  const [answer] = await db
    .insert(s.answers)
    .values(
      answerValues(world, round.id, {
        questionId: question.id,
        language,
        isFirstAttempt: true,
        transcriptRaw: "synthetic",
        transcriptCorrected: "synthetic",
        transcriberModelId: "fixture-transcriber",
        createdAt: at,
        ...fixture.answer,
      }),
    )
    .returning({ id: s.answers.id });
  for (const [index, { scores, ...attempt }] of (fixture.attempts ?? [{}]).entries()) {
    const status = attempt.status ?? "ok";
    const [row] = await db
      .insert(s.scoringAttempts)
      .values({ ...attemptValues(world, answer.id), status, createdAt: new Date(at.getTime() + (index + 1) * 60_000), ...attempt })
      .returning({ id: s.scoringAttempts.id });
    if (status !== "ok") continue;
    await db
      .insert(s.scores)
      .values(Object.entries(scores ?? THREES).map(([dimension, value]) => ({ scoringAttemptId: row.id, dimension, value })));
  }
  return answer.id;
}

const JA_BEHAVIOURAL = { language: "ja", roundType: "behavioural", context: "general" } as const;

describe("what Progress plots (11 §3.5)", () => {
  it("plots a realistic first attempt of a completed round, with its scores and the stamps that scored it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const answerId = await scored(db, world, { day: 0, answer: { position: 2 }, attempts: [{ scores: { structure: 4, evidence: 2 } }] });

      const all = await firstAttempts(db, world.userId);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ language: "ja", roundType: "behavioural", context: "general" });
      expect(all[0].point).toMatchObject({
        answerId,
        date: "2026-09-01",
        position: 2,
        scores: { structure: 4, evidence: 2 },
        stamps: {
          cvVersionId: world.cvVersionId,
          cvLabel: "応募書類 v1",
          rubricVersionId: world.rubricVersionId,
          generatorPromptVersion: "generate-fixture",
          origin: "generated",
          modelId: "fixture-model-2026-01-01",
          scoringPromptVersion: "score-fixture",
        },
      });
    }));

  it("leaves out a pending score and a failed one: no measurement, never a zero", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const kept = await scored(db, world, { day: 0 });
      await scored(db, world, { day: 1, attempts: [{ status: "pending" }] });
      await scored(db, world, { day: 2, attempts: [{ status: "failed", errorClass: "upstream_timeout" }] });

      const all = await firstAttempts(db, world.userId);
      expect(all.map((entry) => entry.point.answerId)).toEqual([kept]);
      expect(all.flatMap((entry) => Object.values(entry.point.scores))).not.toContain(0);
    }));

  it("reads the newest superseding attempt, not the first and not a blend of the two", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await scored(db, world, {
        day: 0,
        attempts: [
          { status: "failed", errorClass: "upstream_timeout" },
          { isSuperseding: true, modelId: "fixture-model-2026-06-01", scores: { structure: 5, evidence: 1 } },
        ],
      });

      const [entry] = await firstAttempts(db, world.userId);
      expect(entry.point.scores).toEqual({ structure: 5, evidence: 1 });
      expect(entry.point.stamps.modelId).toBe("fixture-model-2026-06-01");
    }));

  it("never reads a held-out re-score", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await scored(db, world, {
        day: 0,
        attempts: [
          { scores: { structure: 2, evidence: 2 } },
          { isSuperseding: false, modelId: "fixture-model-2026-06-01", scores: { structure: 5, evidence: 5 } },
        ],
      });

      const [entry] = await firstAttempts(db, world.userId);
      expect(entry.point.scores).toEqual({ structure: 2, evidence: 2 });
      expect(entry.point.stamps.modelId).toBe("fixture-model-2026-01-01");
    }));

  it("gives a dimension the rubric did not score no point at all, not a null one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await scored(db, world, { day: 0, attempts: [{ scores: { structure: 3, keigo: 4 } }] });
      await scored(db, world, { day: 1, round: { language: "en" }, attempts: [{ scores: { structure: 3 } }] });

      const all = await firstAttempts(db, world.userId);
      const [english] = seriesOf(all, { ...JA_BEHAVIOURAL, language: "en" });
      expect(english.scores).toEqual({ structure: 3 });
      expect("keigo" in english.scores).toBe(false);
      expect(seriesOf(all, JA_BEHAVIOURAL)[0].scores.keigo).toBe(4);
    }));

  it("leaves out an answer given in the wrong language, and keeps one scored before the language was read", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await scored(db, world, { day: 0, attempts: [{ answeredLanguage: "en" }] });
      const right = await scored(db, world, { day: 1, attempts: [{ answeredLanguage: "ja" }] });
      const unread = await scored(db, world, { day: 2, attempts: [{ answeredLanguage: null }] });

      const all = await firstAttempts(db, world.userId);
      expect(all.map((entry) => entry.point.answerId)).toEqual([right, unread]);
    }));

  it("leaves out an abandoned round, though its answer keeps its row and its first-attempt flag", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const abandoned = await scored(db, world, { day: 0, round: { completedAt: null } });

      expect(await firstAttempts(db, world.userId)).toEqual([]);
      const rows = await db.select({ id: s.answers.id, isFirstAttempt: s.answers.isFirstAttempt }).from(s.answers);
      expect(rows).toEqual([{ id: abandoned, isFirstAttempt: true }]);
    }));

  it("leaves out a typed answer: a raw transcript with no transcriber", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await scored(db, world, { day: 0, answer: { transcriberModelId: null } });

      expect(await firstAttempts(db, world.userId)).toEqual([]);
    }));

  it("leaves out a practice round, a retry, and a question practised before it met a realistic round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const first = await scored(db, world, { day: 0 });
      // Flagged as first attempts on purpose: the mode and the retry are checked, not trusted.
      await scored(db, world, { day: 1, round: { mode: "practice", perAnswerCapSeconds: 900 } });
      await scored(db, world, { day: 2, answer: { retryOfAnswerId: first } });
      // Practised first, so its realistic answer was never a first attempt (06, 2026-09-27).
      await scored(db, world, { day: 3, answer: { isFirstAttempt: false } });

      const all = await firstAttempts(db, world.userId);
      expect(all.map((entry) => entry.point.answerId)).toEqual([first]);
    }));

  it("groups General practice apart from rounds pitched at a role, and counts both against thirty", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const [posting] = await db
        .insert(s.roleContexts)
        .values({ userId: world.userId, kind: "posting", companyName: "Fixture", roleTitle: "Engineer", body: "synthetic" })
        .returning({ id: s.roleContexts.id });
      const general = await scored(db, world, { day: 0 });
      const pitched = await scored(db, world, { day: 1, round: { roleContextId: posting.id } });
      await scored(db, world, { day: 2, round: { language: "en", roleContextId: posting.id } });

      const all = await firstAttempts(db, world.userId);
      expect(seriesOf(all, JA_BEHAVIOURAL).map((point) => point.answerId)).toEqual([general]);
      expect(seriesOf(all, { ...JA_BEHAVIOURAL, context: "role" }).map((point) => point.answerId)).toEqual([pitched]);
      expect(firstAttemptCounts(all)).toEqual({ ja: 2, en: 1 });
    }));

  it("keeps round types apart, and plots oldest first", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const later = await scored(db, world, { day: 5 });
      const earlier = await scored(db, world, { day: 1 });
      await scored(db, world, { day: 2, round: { roundType: "hr" } });

      const all = await firstAttempts(db, world.userId);
      expect(seriesOf(all, JA_BEHAVIOURAL).map((point) => point.answerId)).toEqual([earlier, later]);
      expect(seriesOf(all, { ...JA_BEHAVIOURAL, roundType: "hr" })).toHaveLength(1);
    }));

  it("reads one user's first attempts only", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const other = await insertWorld(db);
      await scored(db, other, { day: 0 });

      expect(await firstAttempts(db, world.userId)).toEqual([]);
    }));
});

describe("where Progress draws its boundaries (11 §3.6)", () => {
  it("draws one at every stamp change — set pieces included — and no trend line across any", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const rubric2 = await insertRubric(db);
      const [{ id: cvVersion2 }] = await db
        .insert(s.cvVersions)
        .values({ userId: world.userId, versionLabel: "応募書類 v2", language: "ja", body: "架空の株式会社で請求処理を50%短縮。" })
        .returning({ id: s.cvVersions.id });
      const setPiece = (version: string) => ({ origin: "set_piece", generatorPromptVersion: version }) as const;
      const stamp = (overrides: Partial<typeof s.scoringAttempts.$inferInsert>) => [{ ...overrides }];

      // Five under the first stamps, so the first segment alone could carry a trend line.
      await scored(db, world, { day: 0, question: setPiece("set-piece-fixture-1.0"), attempts: stamp({ generatorPromptVersion: "set-piece-fixture-1.0" }) });
      for (const day of [1, 2, 3, 4]) await scored(db, world, { day });
      const later = { modelId: "fixture-model-2026-06-01" };
      await scored(db, world, { day: 5, attempts: stamp(later) });
      Object.assign(later, { rubricVersionId: rubric2 });
      await scored(db, world, { day: 6, attempts: stamp(later) });
      Object.assign(later, { scoringPromptVersion: "score-fixture-2" });
      await scored(db, world, { day: 7, attempts: stamp(later) });
      Object.assign(later, { cvVersionId: cvVersion2 });
      await scored(db, world, { day: 8, attempts: stamp(later) });
      await scored(db, world, { day: 9, attempts: stamp({ ...later, generatorPromptVersion: "generate-fixture-2" }) });
      await scored(db, world, {
        day: 10,
        question: setPiece("set-piece-fixture-1.1"),
        attempts: stamp({ ...later, generatorPromptVersion: "set-piece-fixture-1.1" }),
      });

      const series = seriesOf(await firstAttempts(db, world.userId), JA_BEHAVIOURAL);
      expect(series).toHaveLength(11);
      const bounds = boundaries(series);
      expect(bounds.map((boundary) => [boundary.before, boundary.changes.map((change) => change.kind)])).toEqual([
        [5, ["model"]],
        [6, ["rubric"]],
        [7, ["scoring_prompt"]],
        [8, ["cv"]],
        [9, ["generator"]],
        [10, ["set_pieces"]],
      ]);

      const lines = segments(series.length, bounds).map((segment) => trendLine(series, "structure", segment));
      // The first five share every stamp; every later run is under five, and no line spans two runs.
      expect(lines.map((line) => line !== null)).toEqual([true, false, false, false, false, false, false]);
      expect(lines[0]!.x2).toBeLessThan(180);
    }));
});
