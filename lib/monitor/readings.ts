import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";
import type { BackupOutcome } from "../backup/run";
import { type TokenTotals, spendUsd } from "./spend";
import {
  ANY,
  PENDING_SCORE_MAX_HOURS,
  ROUND_FEEDBACK_MAX_HOURS,
  UNCLAIMED_RUN_MAX_CODE_POINTS,
  hoursBefore,
  isRed,
  spendThresholdUsd,
} from "./thresholds";
import { type Week, previousWeek, weekToDate } from "./week";

// Relative imports: the integration tests load this file outside Next's path aliases.

/**
 * What `self-check` and `digest` read, one user at a time (12 §6, 04 cron_readings). Every query is
 * scoped by `user_id`, and every age and week is measured from the run's own `now`, never the
 * database clock, so a run's readings all describe one instant.
 *
 * **Counts and ids only.** No query here selects a text column of the record (12 §7).
 */

type Db = Pick<NodePgDatabase, "select" | "execute">;

type SelfCheckSignal = (typeof s.SELF_CHECK_SIGNALS)[number];
type DigestFigure = (typeof s.DIGEST_FIGURES)[number];

export interface Reading {
  readonly signal: SelfCheckSignal | DigestFigure;
  /** Null is no reading, never zero. */
  readonly value: number | null;
  /** Null exactly when the reading is a digest figure: reported, not judged. */
  readonly threshold: number | null;
  readonly isRed: boolean | null;
  /** The rows that tripped the signal. Empty when it is not red. */
  readonly subjectIds: readonly string[];
  readonly unpricedModelIds: readonly (string | null)[];
  readonly window: Week | null;
}

function judged(signal: SelfCheckSignal, value: number | null, threshold: number, subjectIds: readonly string[], window: Week | null = null, unpricedModelIds: readonly (string | null)[] = []): Reading {
  const red = isRed(value, threshold) || unpricedModelIds.length > 0;
  return { signal, value, threshold, isRed: red, subjectIds: red ? subjectIds : [], unpricedModelIds, window };
}

function counted(signal: SelfCheckSignal, ids: readonly string[]): Reading {
  return judged(signal, ids.length, ANY, ids);
}

async function pendingScores(db: Db, userId: string, now: Date) {
  const rows = await db
    .select({ id: s.scoringAttempts.id })
    .from(s.scoringAttempts)
    .where(
      and(
        eq(s.scoringAttempts.userId, userId),
        eq(s.scoringAttempts.status, "pending"),
        lt(s.scoringAttempts.createdAt, hoursBefore(now, PENDING_SCORE_MAX_HOURS)),
      ),
    );
  return rows.map((row) => row.id);
}

/** `failed`, and no later `ok` attempt for the same answer — a retry that worked supersedes it. */
async function unsupersededFailures(db: Db, userId: string, now: Date) {
  const result = await db.execute<{ id: string }>(sql`
    select failed.id from ${s.scoringAttempts} failed
    where failed.user_id = ${userId} and failed.status = 'failed' and failed.created_at <= ${now}
      and not exists (
        select 1 from ${s.scoringAttempts} later
        where later.answer_id = failed.answer_id and later.status = 'ok'
          and later.created_at > failed.created_at and later.created_at <= ${now}
      )`);
  return result.rows.map((row) => row.id);
}

async function roundsWithoutFeedback(db: Db, userId: string, now: Date) {
  const result = await db.execute<{ id: string }>(sql`
    select r.id from ${s.rounds} r
    where r.user_id = ${userId} and r.completed_at < ${hoursBefore(now, ROUND_FEEDBACK_MAX_HOURS)}
      and not exists (select 1 from ${s.roundFeedback} f where f.round_id = r.id)`);
  return result.rows.map((row) => row.id);
}

/**
 * Every stored token pair in the window, by model, each row counted in the week of its own
 * `created_at` with no round attribution (06, 2026-09-29). Transcription, speech, embeddings and CV
 * extraction store no tokens and are not here.
 */
async function tokenTotals(db: Db, userId: string, window: Week): Promise<TokenTotals[]> {
  const result = await db.execute<{ model_id: string | null; tokens_in: string; tokens_out: string }>(sql`
    select model_id, coalesce(sum(tokens_in), 0) as tokens_in, coalesce(sum(tokens_out), 0) as tokens_out
    from (
      select generator_model_id as model_id, tokens_in, tokens_out, created_at
        from ${s.questions} where user_id = ${userId}
      union all
      select model_id, tokens_in, tokens_out, created_at
        from ${s.scoringAttempts} where user_id = ${userId}
      union all
      select f.model_id, f.tokens_in, f.tokens_out, f.created_at
        from ${s.roundFeedback} f join ${s.rounds} r on r.id = f.round_id where r.user_id = ${userId}
      union all
      select model_id, tokens_in, tokens_out, created_at
        from ${s.followUps} where user_id = ${userId}
      union all
      select model_id, tokens_in, tokens_out, created_at
        from ${s.modelAnswers} where user_id = ${userId}
    ) token_rows
    where created_at >= ${window.start} and created_at < ${window.end}
      and (tokens_in is not null or tokens_out is not null)
    group by model_id`);
  return result.rows.map((row) => ({
    modelId: row.model_id,
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
  }));
}

async function roundCount(db: Db, userId: string, column: typeof s.rounds.startedAt | typeof s.rounds.completedAt, window: Week) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.rounds)
    .where(and(eq(s.rounds.userId, userId), gte(column, window.start), lt(column, window.end)));
  return row.n;
}

const CV_COUNTERS = [
  ["cv_spans_rejected", "spansRejected", ANY],
  ["cv_claims_split", "claimsSplit", ANY],
  ["cv_claims_duplicated", "claimsDuplicated", ANY],
  ["cv_unclaimed_run_max", "unclaimedRunMax", UNCLAIMED_RUN_MAX_CODE_POINTS],
  ["cv_quotes_outside_window", "quotesOutsideWindow", ANY],
] as const;

/**
 * The five CV rows read the **current** version in each language (06, #55): a bad reading is red for
 * as long as rounds are scored against the version it describes. A null counter is skipped; if every
 * current version's is null, there is no reading.
 */
async function cvCounterReadings(db: Db, userId: string, now: Date): Promise<Reading[]> {
  const current = [];
  for (const language of s.LANGUAGES) {
    const [version] = await db
      .select({
        id: s.cvVersions.id,
        spansRejected: s.cvVersions.spansRejected,
        claimsSplit: s.cvVersions.claimsSplit,
        claimsDuplicated: s.cvVersions.claimsDuplicated,
        unclaimedRunMax: s.cvVersions.unclaimedRunMax,
        quotesOutsideWindow: s.cvVersions.quotesOutsideWindow,
      })
      .from(s.cvVersions)
      .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language), lte(s.cvVersions.createdAt, now)))
      .orderBy(desc(s.cvVersions.createdAt))
      .limit(1);
    current.push(version);
  }
  const versions = current.filter((version) => version !== undefined);

  return CV_COUNTERS.map(([signal, key, threshold]) => {
    const read = versions.flatMap((version) => (version[key] === null ? [] : [{ id: version.id, value: version[key] }]));
    const value = read.length === 0 ? null : Math.max(...read.map((version) => version.value));
    const tripped = read.filter((version) => isRed(version.value, threshold)).map((version) => version.id);
    return judged(signal, value, threshold, tripped);
  });
}

/**
 * The daily dump's row (12 §6, §8): 1 when this run's dump failed, 0 when it was written. No dump
 * configured, which is everywhere but production (12 §2), is no reading. A dump that never ran because
 * `self-check` never ran is the staleness line's to say (10 §14).
 */
export function backupReading(outcome: BackupOutcome | null): Reading {
  return judged("backup_dump_failed", outcome === null ? null : outcome.ok ? 0 : 1, ANY, []);
}

/** The first nine `self-check` rows of 12 §6, in its order; the run adds `backupReading` last. */
export async function selfCheckReadings(db: Db, userId: string, now: Date): Promise<Reading[]> {
  const week = weekToDate(now);
  // One query at a time, so a run can read through a single connection.
  const pending = await pendingScores(db, userId, now);
  const failed = await unsupersededFailures(db, userId, now);
  const totals = await tokenTotals(db, userId, week);
  const spend = spendUsd(totals);
  const roundsStarted = await roundCount(db, userId, s.rounds.startedAt, week);
  const cv = await cvCounterReadings(db, userId, now);
  const missingFeedback = await roundsWithoutFeedback(db, userId, now);
  return [
    counted("scoring_pending_over_24h", pending),
    counted("scoring_failed_unsuperseded", failed),
    judged("spend_week_to_date_usd", spend.usd, spendThresholdUsd(roundsStarted), [], week, spend.unpricedModelIds),
    ...cv,
    counted("round_feedback_missing_over_24h", missingFeedback),
  ];
}

function figure(signal: DigestFigure, value: number | null, window: Week, unpricedModelIds: readonly (string | null)[] = []): Reading {
  return { signal, value, threshold: null, isRed: null, subjectIds: [], unpricedModelIds, window };
}

/**
 * The near-duplicate guard's week, from `near_duplicate_checks` (04): the questions that went into the
 * bank beside a neighbour, how close they came, and the candidates mapped to an existing question.
 * **A similarity with no near-miss behind it is no reading**, not zero.
 */
async function nearDuplicateFigures(db: Db, userId: string, week: Week): Promise<Reading[]> {
  const result = await db.execute<{ near_misses: number; lowest: number | null; median: number | null; highest: number | null; reused: number }>(sql`
    select
      count(*) filter (where question_id is not null)::int as near_misses,
      min(similarity) filter (where question_id is not null) as lowest,
      percentile_cont(0.5) within group (order by similarity) filter (where question_id is not null) as median,
      max(similarity) filter (where question_id is not null) as highest,
      count(*) filter (where question_id is null)::int as reused
    from ${s.nearDuplicateChecks}
    where user_id = ${userId} and created_at >= ${week.start} and created_at < ${week.end}`);
  const [row] = result.rows;
  return [
    figure("digest_near_misses", row.near_misses, week),
    figure("digest_near_miss_similarity_min", row.lowest, week),
    figure("digest_near_miss_similarity_median", row.median, week),
    figure("digest_near_miss_similarity_max", row.highest, week),
    figure("digest_near_duplicates_reused", row.reused, week),
  ];
}

/** The Asia/Tokyo week that ended before `now`: rounds, tokens, spend and the near-duplicate guard. */
export async function digestReadings(db: Db, userId: string, now: Date): Promise<Reading[]> {
  const week = previousWeek(now);
  const started = await roundCount(db, userId, s.rounds.startedAt, week);
  const completed = await roundCount(db, userId, s.rounds.completedAt, week);
  const totals = await tokenTotals(db, userId, week);
  const spend = spendUsd(totals);
  const sum = (pick: (row: TokenTotals) => number) => totals.reduce((n, row) => n + pick(row), 0);
  return [
    figure("digest_rounds_started", started, week),
    figure("digest_rounds_completed", completed, week),
    figure("digest_tokens_in", sum((row) => row.tokensIn), week),
    figure("digest_tokens_out", sum((row) => row.tokensOut), week),
    figure("digest_spend_usd", spend.usd, week, spend.unpricedModelIds),
    ...(await nearDuplicateFigures(db, userId, week)),
  ];
}
