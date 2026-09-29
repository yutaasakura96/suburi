import { createHash, timingSafeEqual } from "node:crypto";
import { apiError } from "../api/errors";
import { type CronJob, type CronJobDeps, runCronJob } from "./run";

// Relative imports: the integration tests load this file outside Next's path aliases.

export interface CronRouteDeps extends CronJobDeps {
  /** `CRON_SECRET`, or undefined where it is not set — everywhere but production (12 §2). */
  readonly secret: string | undefined;
  readonly now?: () => Date;
}

function log(level: "info" | "error", fields: Record<string, string | number>) {
  console[level](JSON.stringify(fields));
}

function pgErrorClass(error: unknown) {
  const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: unknown };
  return typeof pg.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code) ? `pg_${pg.code}` : "unexpected";
}

// Hashed first so the comparison is constant-time whatever the header's length.
function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` (verified 2026-09-30, 06). An unset secret
 * refuses everything: it must never mean "anyone may run it".
 */
export function isCronAuthorised(secret: string | undefined, authorization: string | null) {
  if (!secret || authorization === null) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}

/**
 * `GET /api/cron/self-check` and `GET /api/cron/digest` (07 §5.17, §5.18). No session: Vercel Cron
 * sends none, so the secret is checked first and nothing is read without it. The response and the log
 * line carry the run id, counts and the duration only (12 §7).
 */
export function createCronRoute(job: CronJob, deps: CronRouteDeps) {
  return async function GET(request: Request): Promise<Response> {
    if (!isCronAuthorised(deps.secret, request.headers.get("authorization"))) {
      log("info", { event: "cron_unauthorised", job });
      return apiError("unauthenticated", "Missing or wrong cron secret.");
    }

    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let summary;
    try {
      summary = await runCronJob(deps, job, (deps.now ?? (() => new Date()))());
    } catch (error) {
      // drizzle's message carries the query's params, so the original never leaves this function.
      const errorClass = pgErrorClass(error);
      log("error", { event: "cron_run_failed", job, error_class: errorClass, duration_ms: elapsed() });
      throw new Error(`Cron ${job} failed: ${errorClass}`);
    }

    log("info", {
      event: "cron_run",
      job,
      run_id: summary.runId,
      readings: summary.readings,
      red: summary.red,
      duration_ms: elapsed(),
    });
    return Response.json({
      run_id: summary.runId,
      job,
      created_at: summary.createdAt.toISOString(),
      red: summary.red,
      readings: summary.readings,
    });
  };
}
