import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";
import { isStale } from "./thresholds";

// Relative imports: the integration tests load this file outside Next's path aliases.

type Db = Pick<NodePgDatabase, "select">;

export type SelfCheckSignal = (typeof s.SELF_CHECK_SIGNALS)[number];
export type DigestFigure = (typeof s.DIGEST_FIGURES)[number];

export interface CheckReading {
  readonly signal: SelfCheckSignal;
  /** Null is no reading — no run yet, or a CV counter with nothing to read. */
  readonly value: number | null;
  readonly threshold: number | null;
  readonly isRed: boolean;
  readonly unpricedModelIds: readonly (string | null)[];
}

/** What the status page and Home's status line read (10 §1, §14). Counts only, never ids or text. */
export interface Status {
  readonly selfCheck: { readonly lastRun: Date | null; readonly stale: boolean };
  readonly digest: { readonly lastRun: Date | null };
  /** All nine `self-check` rows, in 12 §6's order, from the newest run. */
  readonly checks: readonly CheckReading[];
  readonly lastWeek: {
    readonly start: Date;
    readonly end: Date;
    readonly figures: Readonly<Record<DigestFigure, number | null>>;
    readonly unpricedModelIds: readonly (string | null)[];
  } | null;
}

async function newestRun(db: Db, job: (typeof s.CRON_JOBS)[number]) {
  const [run] = await db
    .select({ id: s.cronRuns.id, createdAt: s.cronRuns.createdAt })
    .from(s.cronRuns)
    .where(eq(s.cronRuns.job, job))
    .orderBy(desc(s.cronRuns.createdAt))
    .limit(1);
  return run ?? null;
}

async function readingsOf(db: Db, runId: string, userId: string) {
  return db
    .select({
      signal: s.cronReadings.signal,
      value: s.cronReadings.value,
      threshold: s.cronReadings.threshold,
      isRed: s.cronReadings.isRed,
      unpricedModelIds: s.cronReadings.unpricedModelIds,
      windowStart: s.cronReadings.windowStart,
      windowEnd: s.cronReadings.windowEnd,
    })
    .from(s.cronReadings)
    .where(and(eq(s.cronReadings.runId, runId), eq(s.cronReadings.userId, userId)));
}

/** The newest run of each job, and this user's readings from it. A run is when the job last ran. */
export async function loadStatus(db: Db, userId: string, now: Date): Promise<Status> {
  const selfCheckRun = await newestRun(db, "self-check");
  const digestRun = await newestRun(db, "digest");
  const checkRows = selfCheckRun ? await readingsOf(db, selfCheckRun.id, userId) : [];
  const digestRows = digestRun ? await readingsOf(db, digestRun.id, userId) : [];

  const checks = s.SELF_CHECK_SIGNALS.map((signal) => {
    const row = checkRows.find((reading) => reading.signal === signal);
    return { signal, value: row?.value ?? null, threshold: row?.threshold ?? null, isRed: row?.isRed === true, unpricedModelIds: row?.unpricedModelIds ?? [] };
  });

  const window = digestRows.find((row) => row.windowStart !== null && row.windowEnd !== null);
  const lastWeek = window
    ? {
        start: window.windowStart as Date,
        end: window.windowEnd as Date,
        figures: Object.fromEntries(
          s.DIGEST_FIGURES.map((figure) => [figure, digestRows.find((row) => row.signal === figure)?.value ?? null]),
        ) as Record<DigestFigure, number | null>,
        unpricedModelIds: digestRows.find((row) => row.signal === "digest_spend_usd")?.unpricedModelIds ?? [],
      }
    : null;

  const lastSelfCheck = selfCheckRun?.createdAt ?? null;
  return {
    selfCheck: { lastRun: lastSelfCheck, stale: isStale(lastSelfCheck, now) },
    digest: { lastRun: digestRun?.createdAt ?? null },
    checks,
    lastWeek,
  };
}
