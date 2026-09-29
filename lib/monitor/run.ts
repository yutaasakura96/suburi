import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";
import { type Reading, digestReadings, selfCheckReadings } from "./readings";

// Relative imports: the integration tests load this file outside Next's path aliases.

type Db = Pick<NodePgDatabase, "select" | "insert" | "execute">;

export type CronJob = (typeof s.CRON_JOBS)[number];

export interface CronJobDeps {
  readonly db: Db;
  /** All-or-nothing: a run and its readings land together or not at all. */
  readonly transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>;
}

export interface CronRunSummary {
  readonly runId: string;
  readonly job: CronJob;
  readonly createdAt: Date;
  readonly readings: number;
  readonly red: number;
}

const READ = { "self-check": selfCheckReadings, digest: digestReadings } as const;

/**
 * Runs one 12 §6 job and **appends** it: one `cron_runs` row, dated `now`, with every user's readings
 * (04). Nothing is updated. Everything is read before the transaction opens, and a failure writes
 * nothing, so the newest run gets old and the status page says so (10 §14).
 */
export async function runCronJob(deps: CronJobDeps, job: CronJob, now: Date): Promise<CronRunSummary> {
  const users = await deps.db.select({ id: s.users.id }).from(s.users);
  const perUser: { userId: string; readings: Reading[] }[] = [];
  for (const { id } of users) perUser.push({ userId: id, readings: await READ[job](deps.db, id, now) });

  const runId = await deps.transaction(async (tx) => {
    const [run] = await tx.insert(s.cronRuns).values({ job, createdAt: now }).returning({ id: s.cronRuns.id });
    const rows = perUser.flatMap(({ userId, readings }) => readings.map((reading) => toRow(run.id, userId, reading)));
    if (rows.length > 0) await tx.insert(s.cronReadings).values(rows);
    return run.id;
  });

  const all = perUser.flatMap(({ readings }) => readings);
  return {
    runId,
    job,
    createdAt: now,
    readings: all.length,
    red: all.filter((reading) => reading.isRed === true).length,
  };
}

function toRow(runId: string, userId: string, reading: Reading): typeof s.cronReadings.$inferInsert {
  return {
    runId,
    userId,
    signal: reading.signal,
    value: reading.value,
    threshold: reading.threshold,
    isRed: reading.isRed,
    subjectIds: [...reading.subjectIds],
    unpricedModelIds: [...reading.unpricedModelIds],
    windowStart: reading.window?.start ?? null,
    windowEnd: reading.window?.end ?? null,
  };
}
