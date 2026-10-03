import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { answerValues, attemptValues, insertUser, insertWorld, roundValues, type World } from "../../db/test/fixtures";
import { statusLine } from "../../app/(app)/status/copy";
import { CV_EXTRACTION_MODEL } from "../ai/models";
import type { BackupOutcome } from "../backup/run";
import { createCronRoute } from "./cron-route";
import { loadStatus } from "./status";

// 11 §3.17: 12 §6's jobs against the migrated test database. Each signal is seeded to fire and to
// stay quiet, and every age and week is measured from a fixed run instant, NOW.

afterAll(closePool);

const SECRET = "integration-cron-secret-not-a-real-one";
// Wednesday 13:00 in Tokyo. Its week began Monday 2029-12-31 00:00 in Tokyo, 2029-12-30 15:00 UTC. In
// the future, so every row a fixture leaves at its default created_at is before it.
const NOW = new Date("2030-01-02T04:00:00Z");
const WEEK_START = new Date("2029-12-30T15:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

// Recognisable text that must never reach a stored run, a response or a log line (11 §3.10).
const SENTINEL = "ZEBRA-SENTINEL-5582";

let logged: string[];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

// The route's transaction, as a savepoint inside the test's own rolled-back transaction.
function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint cron_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint cron_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint cron_write`);
      throw error;
    }
  };
}

type Backup = (now: Date) => Promise<BackupOutcome>;

function route(db: TestDb, job: "self-check" | "digest", { secret = SECRET as string | undefined, now = NOW, backup = undefined as Backup | undefined } = {}) {
  return createCronRoute(job, { secret, db, transaction: savepointTransaction(db), now: () => now, backup });
}

async function call(db: TestDb, job: "self-check" | "digest", authorization: string | null = `Bearer ${SECRET}`, options = {}) {
  const response = await route(db, job, options)(
    new Request(`http://localhost:3000/api/cron/${job}`, {
      headers: authorization === null ? {} : { authorization },
    }),
  );
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
}

async function runCount(db: TestDb) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(s.cronRuns);
  return row.n;
}

/** This user's readings from one run, by signal. */
async function readingsOf(db: TestDb, runId: string, userId: string) {
  const rows = await db
    .select()
    .from(s.cronReadings)
    .where(sql`${s.cronReadings.runId} = ${runId} and ${s.cronReadings.userId} = ${userId}`);
  return Object.fromEntries(rows.map((row) => [row.signal, row]));
}

async function selfCheck(db: TestDb, userId: string, now = NOW) {
  const { status, json } = await call(db, "self-check", `Bearer ${SECRET}`, { now });
  expect(status).toBe(200);
  return readingsOf(db, json.run_id, userId);
}

async function round(db: TestDb, world: World, overrides: Partial<typeof s.rounds.$inferInsert> = {}) {
  const [row] = await db.insert(s.rounds).values(roundValues(world, overrides)).returning({ id: s.rounds.id });
  return row.id;
}

async function answer(db: TestDb, world: World, roundId: string, position = 1) {
  const [row] = await db.insert(s.answers).values(answerValues(world, roundId, { position })).returning({ id: s.answers.id });
  return row.id;
}

async function attempt(
  db: TestDb,
  world: World,
  answerId: string,
  overrides: Partial<typeof s.scoringAttempts.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.scoringAttempts)
    .values({ ...attemptValues(world, answerId), modelId: CV_EXTRACTION_MODEL, ...overrides })
    .returning({ id: s.scoringAttempts.id });
  return row.id;
}

async function feedback(db: TestDb, roundId: string, overrides: Partial<typeof s.roundFeedback.$inferInsert> = {}) {
  await db.insert(s.roundFeedback).values({
    roundId,
    toFix: [],
    whatWorked: "fixture",
    language: "ja",
    modelId: CV_EXTRACTION_MODEL,
    promptVersion: "feedback-fixture",
    ...overrides,
  });
}

async function tokenQuestion(db: TestDb, world: World, createdAt: Date, tokensIn: number, tokensOut: number, body = "fixture") {
  await db.insert(s.questions).values({
    userId: world.userId,
    language: "ja",
    roundType: "behavioural",
    origin: "generated",
    body,
    generatorModelId: CV_EXTRACTION_MODEL,
    generatorPromptVersion: "generate-fixture",
    tokensIn,
    tokensOut,
    createdAt,
  });
}

async function cvVersion(
  db: TestDb,
  world: World,
  label: string,
  createdAt: Date,
  counters: Partial<typeof s.cvVersions.$inferInsert> = {},
  language: "ja" | "en" = "ja",
  body = "架空の株式会社で請求処理を40%短縮。",
) {
  const [row] = await db
    .insert(s.cvVersions)
    .values({ userId: world.userId, versionLabel: label, language, body, createdAt, ...counters })
    .returning({ id: s.cvVersions.id });
  return row.id;
}

const CLEAN = { spansRejected: 0, claimsSplit: 0, claimsDuplicated: 0, unclaimedRunMax: 1_071, quotesOutsideWindow: 0 };

describe("the cron routes refuse a caller without CRON_SECRET, and write nothing", () => {
  it.each([
    ["no Authorization header", null],
    ["a wrong secret", "Bearer not-the-secret-at-all"],
    ["the secret without its scheme", SECRET],
    ["another scheme", `Basic ${SECRET}`],
  ])("401 with %s", (_, authorization) =>
    inRolledBackTransaction(async (db) => {
      await insertWorld(db);
      for (const job of ["self-check", "digest"] as const) {
        const before = await runCount(db);
        const { status, json } = await call(db, job, authorization);
        expect(status).toBe(401);
        expect(json).toMatchObject({ error: { code: "unauthenticated" } });
        expect(await runCount(db)).toBe(before);
      }
    }));

  it("401 when CRON_SECRET is unset, whatever the header says", () =>
    inRolledBackTransaction(async (db) => {
      await insertWorld(db);
      for (const authorization of ["Bearer ", "Bearer undefined", null]) {
        const before = await runCount(db);
        const { status } = await call(db, "self-check", authorization, { secret: undefined });
        expect(status).toBe(401);
        expect(await runCount(db)).toBe(before);
      }
    }));

  it("200 with the secret, and one run appended", () =>
    inRolledBackTransaction(async (db) => {
      await insertWorld(db);
      const before = await runCount(db);
      const { status, json } = await call(db, "self-check");
      expect(status).toBe(200);
      expect(json).toMatchObject({ job: "self-check", created_at: NOW.toISOString() });
      expect(await runCount(db)).toBe(before + 1);
    }));
});

describe("self-check", () => {
  it("writes every row for a healthy fixture, none red", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await cvVersion(db, world, "応募書類 v2", at(-HOUR), CLEAN);
      const done = await round(db, world, { startedAt: at(-3 * HOUR), completedAt: at(-2 * HOUR) });
      await feedback(db, done, { tokensIn: 1_000, tokensOut: 200, createdAt: at(-2 * HOUR) });
      const scored = await answer(db, world, done);
      await attempt(db, world, scored, { status: "ok", tokensIn: 3_120, tokensOut: 604, createdAt: at(-2 * HOUR) });
      // Pending for an hour: normal, not yet a signal.
      await attempt(db, world, scored, { status: "pending", createdAt: at(-HOUR) });

      const readings = await selfCheck(db, world.userId);
      expect(Object.keys(readings).sort()).toEqual([...s.SELF_CHECK_SIGNALS].sort());
      for (const reading of Object.values(readings)) {
        expect(reading.isRed, reading.signal).toBe(false);
        expect(reading.subjectIds, reading.signal).toEqual([]);
      }
      expect(readings.scoring_pending_over_24h.value).toBe(0);
      expect(readings.cv_unclaimed_run_max.value).toBe(1_071);
      expect(readings.spend_week_to_date_usd.value).toBeCloseTo(0.02456 + 0.008, 6);
    }));

  it("scores pending over 24 hours: red strictly past the limit, naming the attempt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const answerId = await answer(db, world, await round(db, world));
      await attempt(db, world, answerId, { status: "pending", createdAt: at(-24 * HOUR + 60_000) });
      await attempt(db, world, answerId, { status: "pending", createdAt: at(-24 * HOUR) });
      const late = await attempt(db, world, answerId, { status: "pending", createdAt: at(-24 * HOUR - 60_000) });

      const { scoring_pending_over_24h: reading } = await selfCheck(db, world.userId);
      expect(reading).toMatchObject({ value: 1, threshold: 0, isRed: true, subjectIds: [late] });
    }));

  it("failed scores: red until a later ok attempt for the same answer supersedes them", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const roundId = await round(db, world);
      const retried = await answer(db, world, roundId, 1);
      await attempt(db, world, retried, { status: "failed", errorClass: "upstream_timeout", createdAt: at(-5 * HOUR) });
      await attempt(db, world, retried, { status: "ok", createdAt: at(-4 * HOUR) });
      const stuck = await answer(db, world, roundId, 2);
      const failed = await attempt(db, world, stuck, { status: "failed", createdAt: at(-3 * HOUR) });
      // A later attempt that is not ok does not supersede it.
      await attempt(db, world, stuck, { status: "pending", createdAt: at(-2 * HOUR) });

      const { scoring_failed_unsuperseded: reading } = await selfCheck(db, world.userId);
      expect(reading).toMatchObject({ value: 1, isRed: true, subjectIds: [failed] });
    }));

  it("an earlier ok attempt does not supersede a later failure", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const answerId = await answer(db, world, await round(db, world));
      await attempt(db, world, answerId, { status: "ok", createdAt: at(-5 * HOUR) });
      const failed = await attempt(db, world, answerId, { status: "failed", createdAt: at(-4 * HOUR), isSuperseding: true });

      const { scoring_failed_unsuperseded: reading } = await selfCheck(db, world.userId);
      expect(reading).toMatchObject({ value: 1, isRed: true, subjectIds: [failed] });
    }));

  it("rounds without feedback: red when completed over 24 hours ago, quiet with feedback or when recent", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const missing = await round(db, world, { completedAt: at(-24 * HOUR - 60_000) });
      await round(db, world, { completedAt: at(-24 * HOUR) });
      await round(db, world, { completedAt: at(-23 * HOUR) });
      await feedback(db, await round(db, world, { completedAt: at(-48 * HOUR) }));
      // Still open: not complete, so not waiting on feedback.
      await round(db, world, { startedAt: at(-72 * HOUR) });

      const { round_feedback_missing_over_24h: reading } = await selfCheck(db, world.userId);
      expect(reading).toMatchObject({ value: 1, isRed: true, subjectIds: [missing] });
    }));

  describe("week-to-date spend", () => {
    it("is not red exactly at 3 × $0.40 with no round started, and red a token above it", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        // 300,000 tokens in at $4.00 per million is $1.20.
        await tokenQuestion(db, world, at(-HOUR), 300_000, 0);

        const quiet = await selfCheck(db, world.userId);
        expect(quiet.spend_week_to_date_usd).toMatchObject({ value: 1.2, threshold: 1.2, isRed: false });
        expect(quiet.spend_week_to_date_usd.windowStart).toEqual(WEEK_START);
        expect(quiet.spend_week_to_date_usd.windowEnd).toEqual(NOW);

        await tokenQuestion(db, world, at(-HOUR), 0, 1);
        const red = await selfCheck(db, world.userId);
        expect(red.spend_week_to_date_usd).toMatchObject({ value: 1.20002, threshold: 1.2, isRed: true, subjectIds: [] });
      }));

    it("counts every token table, each row by its own created_at, and nothing from before Monday in Tokyo", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        // Sunday 23:59 in Tokyo: last week, however large.
        await tokenQuestion(db, world, new Date(WEEK_START.getTime() - 60_000), 10_000_000, 10_000_000);
        await tokenQuestion(db, world, WEEK_START, 100_000, 0); // $0.40
        // A round started last week whose attempt and feedback land this week count this week.
        const old = await round(db, world, { startedAt: at(-7 * 24 * HOUR), completedAt: at(-HOUR) });
        await attempt(db, world, await answer(db, world, old), { status: "ok", tokensIn: 100_000, createdAt: at(-HOUR) });
        await feedback(db, old, { tokensOut: 20_000, createdAt: at(-HOUR) }); // $0.40

        const { spend_week_to_date_usd: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 1.2, threshold: 1.2, isRed: false });
      }));

    it("raises the threshold by $1.20 for each round started this week", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        await round(db, world, { startedAt: WEEK_START });
        await round(db, world, { startedAt: at(-HOUR) });
        await round(db, world, { startedAt: new Date(WEEK_START.getTime() - 1) }); // last week
        await tokenQuestion(db, world, at(-HOUR), 600_000, 0); // $2.40

        const { spend_week_to_date_usd: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 2.4, threshold: 2.4, isRed: false });
      }));

    it("turns red for an unpriced model and names it in the stored run and status", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        const answerId = await answer(db, world, await round(db, world));
        await attempt(db, world, answerId, { status: "ok", modelId: "unpriced-model-2031-01-01", tokensIn: 300_001, createdAt: at(-HOUR) });
        await tokenQuestion(db, world, at(-HOUR), 100_000, 0);

        const { spend_week_to_date_usd: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 0.4, threshold: 1.2, isRed: true, unpricedModelIds: ["unpriced-model-2031-01-01"] });
        const status = await loadStatus(db, world.userId, at(HOUR));
        expect(status.checks.find((check) => check.signal === "spend_week_to_date_usd")).toMatchObject({
          value: 0.4, isRed: true, unpricedModelIds: ["unpriced-model-2031-01-01"],
        });
        expect(statusLine(status)).toContain("Unpriced model: unpriced-model-2031-01-01");
      }));
  });

  describe("the five CV counters, read from the current version in each language", () => {
    it("fires each counter above its threshold, naming the version", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        const bad = await cvVersion(db, world, "応募書類 v2", at(-HOUR), {
          spansRejected: 2,
          claimsSplit: 1,
          claimsDuplicated: 3,
          unclaimedRunMax: 2_001,
          quotesOutsideWindow: 1,
        });

        const readings = await selfCheck(db, world.userId);
        expect(readings.cv_spans_rejected).toMatchObject({ value: 2, threshold: 0, isRed: true, subjectIds: [bad] });
        expect(readings.cv_claims_split).toMatchObject({ value: 1, isRed: true, subjectIds: [bad] });
        expect(readings.cv_claims_duplicated).toMatchObject({ value: 3, isRed: true, subjectIds: [bad] });
        expect(readings.cv_unclaimed_run_max).toMatchObject({ value: 2_001, threshold: 2_000, isRed: true, subjectIds: [bad] });
        expect(readings.cv_quotes_outside_window).toMatchObject({ value: 1, isRed: true, subjectIds: [bad] });
      }));

    it("is not red at the unclaimed-run threshold", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        await cvVersion(db, world, "応募書類 v2", at(-HOUR), { ...CLEAN, unclaimedRunMax: 2_000 });

        const { cv_unclaimed_run_max: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 2_000, isRed: false, subjectIds: [] });
      }));

    it("clears when a newer version reads clean: only the current version counts", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        await cvVersion(db, world, "応募書類 v2", at(-2 * HOUR), { ...CLEAN, spansRejected: 5 });
        await cvVersion(db, world, "応募書類 v3", at(-HOUR), CLEAN);

        const { cv_spans_rejected: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 0, isRed: false });
      }));

    it("reads both languages and takes the higher, naming only the version that trips it", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        await cvVersion(db, world, "応募書類 v2", at(-HOUR), CLEAN);
        const en = await cvVersion(db, world, "CV v1", at(-HOUR), { ...CLEAN, claimsSplit: 4 }, "en");

        const { cv_claims_split: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 4, isRed: true, subjectIds: [en] });
      }));

    it("treats null counters as no reading, never as zero", () =>
      inRolledBackTransaction(async (db) => {
        // insertWorld's version predates the counters: all five null.
        const world = await insertWorld(db);

        const readings = await selfCheck(db, world.userId);
        for (const signal of ["cv_spans_rejected", "cv_claims_split", "cv_claims_duplicated", "cv_unclaimed_run_max", "cv_quotes_outside_window"]) {
          expect(readings[signal], signal).toMatchObject({ value: null, isRed: false, subjectIds: [] });
        }
      }));

    it("skips a null-counter version in one language and reads the other", () =>
      inRolledBackTransaction(async (db) => {
        const world = await insertWorld(db);
        await cvVersion(db, world, "CV v1", at(-HOUR), { ...CLEAN, quotesOutsideWindow: 0 }, "en");

        const { cv_quotes_outside_window: reading } = await selfCheck(db, world.userId);
        expect(reading).toMatchObject({ value: 0, isRed: false });
      }));
  });

  it("scopes every reading to its own user", () =>
    inRolledBackTransaction(async (db) => {
      const mine = await insertWorld(db);
      const theirs = await insertWorld(db);
      await answer(db, theirs, await round(db, theirs)).then((answerId) =>
        attempt(db, theirs, answerId, { status: "failed", createdAt: at(-HOUR) }),
      );

      expect((await selfCheck(db, mine.userId)).scoring_failed_unsuperseded).toMatchObject({ value: 0, isRed: false });
    }));

  it("appends: a second run is a new row, and the first run's readings are untouched", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const first = await call(db, "self-check");
      const before = await db.select().from(s.cronReadings).where(eq(s.cronReadings.runId, first.json.run_id)).orderBy(asc(s.cronReadings.signal));

      const answerId = await answer(db, world, await round(db, world));
      await attempt(db, world, answerId, { status: "failed", createdAt: at(-HOUR) });
      const second = await call(db, "self-check", `Bearer ${SECRET}`, { now: at(HOUR) });

      expect(second.json.run_id).not.toBe(first.json.run_id);
      const after = await db.select().from(s.cronReadings).where(eq(s.cronReadings.runId, first.json.run_id)).orderBy(asc(s.cronReadings.signal));
      expect(after).toEqual(before);
      expect((await readingsOf(db, second.json.run_id, world.userId)).scoring_failed_unsuperseded.isRed).toBe(true);
    }));
});

describe("digest", () => {
  it("retains priced spend and names unpriced models in last week's digest", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const inLastWeek = new Date(WEEK_START.getTime() - HOUR);
      await tokenQuestion(db, world, inLastWeek, 100_000, 0);
      const answerId = await answer(db, world, await round(db, world));
      await attempt(db, world, answerId, { status: "ok", modelId: "unpriced-model-2031-01-01", tokensIn: 300_001, createdAt: inLastWeek });

      const { status, json } = await call(db, "digest");
      expect(status).toBe(200);
      expect((await readingsOf(db, json.run_id, world.userId)).digest_spend_usd).toMatchObject({
        value: 0.4, unpricedModelIds: ["unpriced-model-2031-01-01"],
      });
      expect((await loadStatus(db, world.userId, NOW)).lastWeek).toMatchObject({
        unpricedModelIds: ["unpriced-model-2031-01-01"],
      });
    }));

  it("reports the Tokyo week that ended before the run: rounds, tokens and spend, judged by nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const lastWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * HOUR);
      const inLastWeek = new Date(lastWeekStart.getTime() + 24 * HOUR);
      const completed = await round(db, world, { startedAt: inLastWeek, completedAt: inLastWeek });
      await round(db, world, { startedAt: lastWeekStart });
      await round(db, world, { startedAt: WEEK_START }); // this week: not reported
      await round(db, world, { startedAt: new Date(lastWeekStart.getTime() - 1) }); // the week before
      await feedback(db, completed, { tokensIn: 1_000, tokensOut: 500, createdAt: inLastWeek });
      await tokenQuestion(db, world, inLastWeek, 250_000, 0);
      await tokenQuestion(db, world, WEEK_START, 9_000_000, 9_000_000); // this week

      const { status, json } = await call(db, "digest");
      expect(status).toBe(200);
      expect(json.red).toBe(0);
      const readings = await readingsOf(db, json.run_id, world.userId);
      expect(Object.keys(readings).sort()).toEqual([...s.DIGEST_FIGURES].sort());
      expect(readings.digest_rounds_started.value).toBe(2);
      expect(readings.digest_rounds_completed.value).toBe(1);
      expect(readings.digest_tokens_in.value).toBe(251_000);
      expect(readings.digest_tokens_out.value).toBe(500);
      expect(readings.digest_spend_usd.value).toBeCloseTo(1.004 + 0.01, 6);
      for (const reading of Object.values(readings)) {
        expect(reading).toMatchObject({ threshold: null, isRed: null, subjectIds: [], windowStart: lastWeekStart, windowEnd: WEEK_START });
      }
    }));
});

describe("digest — the near-duplicate guard's week (12 §6, #47)", () => {
  const lastWeekStart = new Date(WEEK_START.getTime() - 7 * 24 * HOUR);
  const inLastWeek = new Date(lastWeekStart.getTime() + 24 * HOUR);

  async function question(db: TestDb, world: World) {
    const [row] = await db
      .insert(s.questions)
      .values({ userId: world.userId, language: "en", roundType: "hr", origin: "generated", body: SENTINEL, generatorPromptVersion: "generate-fixture" })
      .returning({ id: s.questions.id });
    return row.id;
  }

  /** A stored comparison: a near-miss when it is below the threshold, a reuse at or above it. */
  async function check(db: TestDb, world: World, matched: string, similarity: number, createdAt: Date, userId = world.userId) {
    const threshold = 0.9;
    await db.insert(s.nearDuplicateChecks).values({
      userId,
      matchedQuestionId: matched,
      questionId: similarity >= threshold ? null : await question(db, world),
      similarity,
      threshold,
      embeddingModelId: "fixture-embedder",
      createdAt,
    });
  }

  it("reports the week's near-misses, their lowest, median and highest similarity, and the reuses", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const matched = await question(db, world);
      for (const similarity of [0.2, 0.5, 0.6, 0.88]) await check(db, world, matched, similarity, inLastWeek);
      await check(db, world, matched, 0.95, inLastWeek);
      await check(db, world, matched, 0.99, inLastWeek);
      await check(db, world, matched, 0.89, WEEK_START); // this week: not reported
      await check(db, world, matched, 0.1, new Date(lastWeekStart.getTime() - 1)); // the week before
      await check(db, world, matched, 0.01, inLastWeek, await insertUser(db)); // another user's

      const { json } = await call(db, "digest");
      const readings = await readingsOf(db, json.run_id, world.userId);

      expect(readings.digest_near_misses.value).toBe(4);
      expect(readings.digest_near_miss_similarity_min.value).toBeCloseTo(0.2, 9);
      expect(readings.digest_near_miss_similarity_median.value).toBeCloseTo(0.55, 9);
      expect(readings.digest_near_miss_similarity_max.value).toBeCloseTo(0.88, 9);
      expect(readings.digest_near_duplicates_reused.value).toBe(2);
      for (const signal of s.DIGEST_FIGURES.filter((figure) => figure.includes("near_"))) {
        expect(readings[signal]).toMatchObject({ threshold: null, isRed: null, subjectIds: [], windowStart: lastWeekStart, windowEnd: WEEK_START });
      }
    }));

  it("has no similarity reading for a week with no near-miss: null, never zero", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await check(db, world, await question(db, world), 0.97, inLastWeek);

      const { json } = await call(db, "digest");
      const readings = await readingsOf(db, json.run_id, world.userId);

      expect(readings.digest_near_misses.value).toBe(0);
      expect(readings.digest_near_miss_similarity_min.value).toBeNull();
      expect(readings.digest_near_miss_similarity_median.value).toBeNull();
      expect(readings.digest_near_miss_similarity_max.value).toBeNull();
      expect(readings.digest_near_duplicates_reused.value).toBe(1);
      const lastWeek = (await loadStatus(db, world.userId, NOW)).lastWeek!;
      expect(lastWeek.figures).toMatchObject({ digest_near_misses: 0, digest_near_miss_similarity_max: null, digest_near_duplicates_reused: 1 });
    }));

  it("carries no question text into the run, the response or a log line", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await check(db, world, await question(db, world), 0.5, inLastWeek);

      const { text, json } = await call(db, "digest");

      expect(text).not.toContain(SENTINEL);
      expect(JSON.stringify(await readingsOf(db, json.run_id, world.userId))).not.toContain(SENTINEL);
      for (const line of logged) expect(line).not.toContain(SENTINEL);
    }));
});

describe("the status page's read, and Home's line", () => {
  it("names the red checks from the newest run, and nothing when it is clean and fresh", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const answerId = await answer(db, world, await round(db, world));
      await attempt(db, world, answerId, { status: "failed", createdAt: at(-HOUR) });
      await call(db, "self-check");

      const red = await loadStatus(db, world.userId, at(HOUR));
      expect(red.selfCheck).toEqual({ lastRun: NOW, stale: false });
      expect(red.checks.map((check) => check.signal)).toEqual([...s.SELF_CHECK_SIGNALS]);
      expect(statusLine(red)).toBe("1 check is red: Failed scores not retried.");

      await attempt(db, world, answerId, { status: "ok", createdAt: at(HOUR) });
      await call(db, "self-check", `Bearer ${SECRET}`, { now: at(2 * HOUR) });
      expect(statusLine(await loadStatus(db, world.userId, at(3 * HOUR)))).toBeNull();
    }));

  it("says self-check is stale after 48 hours, with the red checks it last found", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await tokenQuestion(db, world, at(-HOUR), 1_000_000, 0);
      await call(db, "self-check");

      expect((await loadStatus(db, world.userId, at(48 * HOUR))).selfCheck.stale).toBe(false);
      const stale = await loadStatus(db, world.userId, at(48 * HOUR + 60_000));
      expect(statusLine(stale)).toBe("Self-check has not run since 2030-01-02 13:00. 1 check is red: Spend this week.");
    }));

  it("shows the digest's week and figures", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await call(db, "digest");

      const status = await loadStatus(db, world.userId, NOW);
      expect(status.digest.lastRun).toEqual(NOW);
      expect(status.lastWeek).toMatchObject({ start: new Date(WEEK_START.getTime() - 7 * 24 * HOUR), end: WEEK_START });
      expect(status.lastWeek?.figures.digest_rounds_started).toBe(0);
    }));
});

// 11 §3.10 for the jobs: text from every corner of the record, and none of it anywhere a run leaves.
describe("no record text reaches a run, a response, a log line or the status read", () => {
  it("with sentinel text in a CV, a transcript, a question, a note and round feedback", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      await cvVersion(db, world, "応募書類 v2", at(-HOUR), { ...CLEAN, spansRejected: 1 }, "ja", `${SENTINEL} の職務経歴`);
      await db.insert(s.roleContexts).values({ userId: world.userId, kind: "posting", companyName: SENTINEL, body: SENTINEL });
      const roundId = await round(db, world, { startedAt: at(-30 * HOUR), completedAt: at(-25 * HOUR) });
      const [spoken] = await db
        .insert(s.answers)
        .values(answerValues(world, roundId, { transcriptRaw: SENTINEL, transcriptCorrected: SENTINEL, promptText: SENTINEL }))
        .returning({ id: s.answers.id });
      await attempt(db, world, spoken.id, { status: "failed", errorClass: "upstream_timeout", createdAt: at(-25 * HOUR) });
      await attempt(db, world, spoken.id, { status: "pending", createdAt: at(-25 * HOUR) });
      await tokenQuestion(db, world, at(-HOUR), 5_000_000, 0, SENTINEL);
      const other = await round(db, world, { startedAt: at(-2 * HOUR), completedAt: at(-HOUR) });
      await feedback(db, other, { whatWorked: SENTINEL, toFix: [SENTINEL], tokensIn: 10, createdAt: at(-HOUR) });

      const responses = [await call(db, "self-check"), await call(db, "digest")];
      expect(responses[0].json.red).toBeGreaterThan(0);

      const stored = await db.execute(sql`select row_to_json(r)::text as row from ${s.cronReadings} r
        union all select row_to_json(r)::text from ${s.cronRuns} r`);
      const everything = [
        ...stored.rows.map((row) => String(row.row)),
        ...responses.map((response) => response.text),
        ...logged,
        JSON.stringify(await loadStatus(db, world.userId, NOW)),
        statusLine(await loadStatus(db, world.userId, NOW)) ?? "",
      ];
      expect(everything.length).toBeGreaterThan(20);
      for (const text of everything) expect(text).not.toContain(SENTINEL);
    }));
});

describe("self-check's daily dump (12 §8, #56)", () => {
  const written: BackupOutcome = { ok: true, key: "backups/2030-01-02T04-00-00.000Z.sql", bytes: 2_048, durationMs: 12 };
  const refused: BackupOutcome = { ok: false, key: "backups/2030-01-02T04-00-00.000Z.sql", errorClass: "s3_AccessDenied", durationMs: 12 };

  async function backupRow(db: TestDb, userId: string, backup?: Backup) {
    const { status, json } = await call(db, "self-check", `Bearer ${SECRET}`, { backup });
    expect(status).toBe(200);
    return (await readingsOf(db, json.run_id, userId)).backup_dump_failed;
  }

  it("runs once per self-check, at the run's instant, and a written dump is quiet", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      const backup = vi.fn<Backup>(async () => written);
      expect(await backupRow(db, world.userId, backup)).toMatchObject({ value: 0, threshold: 0, isRed: false, subjectIds: [] });
      expect(backup).toHaveBeenCalledTimes(1);
      expect(backup).toHaveBeenCalledWith(NOW);
    }));

  it("a failed dump is red on the status page and Home, and the run's other rows still land", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      expect(await backupRow(db, world.userId, async () => refused)).toMatchObject({ value: 1, threshold: 0, isRed: true });

      const status = await loadStatus(db, world.userId, NOW);
      expect(status.checks).toHaveLength(s.SELF_CHECK_SIGNALS.length);
      expect(status.checks.find((check) => check.signal === "backup_dump_failed")).toMatchObject({ value: 1, isRed: true });
      expect(statusLine(status)).toBe("1 check is red: Daily backup failed.");
    }));

  it("no backup key, as everywhere but production, is no reading rather than a pass", () =>
    inRolledBackTransaction(async (db) => {
      const world = await insertWorld(db);
      expect(await backupRow(db, world.userId)).toMatchObject({ value: null, isRed: false });
    }));

  it("a caller without the secret starts no dump", () =>
    inRolledBackTransaction(async (db) => {
      await insertWorld(db);
      const backup = vi.fn<Backup>(async () => written);
      const response = await route(db, "self-check", { backup })(new Request("http://localhost:3000/api/cron/self-check"));
      expect(response.status).toBe(401);
      expect(backup).not.toHaveBeenCalled();
    }));

  it("digest writes no dump", () =>
    inRolledBackTransaction(async (db) => {
      await insertWorld(db);
      const backup = vi.fn<Backup>(async () => written);
      const { status } = await call(db, "digest", `Bearer ${SECRET}`, { backup });
      expect(status).toBe(200);
      expect(backup).not.toHaveBeenCalled();
    }));
});
