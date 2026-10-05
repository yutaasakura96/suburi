import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { RATE_LIMITED_ROUTES } from "../../db/schema";

// Relative imports: the integration tests load this file outside Next's path aliases.

/**
 * The one per-session limiter every ⚡ route opts into (07 §1 rule 5, 06 "Phase 6 — #18").
 *
 * **A fixed window per `(session, route)` in Postgres**, not memory: serverless instances share
 * nothing else. One `insert … on conflict do update` restarts a lapsed window or increments the
 * count, so two instances racing on the same bucket are serialised by the row, and neither can slip
 * under the limit. The window is the database's clock, never the function's.
 *
 * **Call it right after the session check and before the body is parsed**, on every ⚡ route: every
 * authenticated request counts, a refused one included.
 */

export type RateLimitedRoute = (typeof RATE_LIMITED_ROUTES)[number];

/** Per route, in code rather than rows: changing one is a reviewed change (04 §2). */
export const RATE_LIMITS: Record<RateLimitedRoute, { limit: number; windowSeconds: number }> = {
  "cv-versions": { limit: 6, windowSeconds: 600 },
  // The round routes, from the round's own shape (07 §1 rule 5): a 7-question round opens one round,
  // makes 14 `transcribe` and 14 `submit` calls over roughly 40 minutes, and one `complete`. Each
  // bound leaves room for retries and a second round in the same window, and no more.
  rounds: { limit: 6, windowSeconds: 600 },
  transcribe: { limit: 30, windowSeconds: 600 },
  submit: { limit: 30, windowSeconds: 600 },
  complete: { limit: 6, windowSeconds: 600 },
  feedback: { limit: 6, windowSeconds: 600 },
  // The model answers' retry (07 §5.19): one call writes every one the round still lacks.
  "model-answers": { limit: 6, windowSeconds: 600 },
  // One request per prompt asked in realistic mode: 14 in the longest round with follow-ups, and a
  // reload asks again. Two such rounds with reloads to spare, like `transcribe` and `submit`.
  speech: { limit: 30, windowSeconds: 600 },
  // History's retry (07 §5.10–§5.11), one answer at a time: a 7-question round has 14 answers, so
  // retrying every one of them takes 14 of each call. The same bound as `submit`, for the same shape.
  "scoring-attempts": { limit: 30, windowSeconds: 600 },
  "scoring-run": { limit: 30, windowSeconds: 600 },
};

export interface RateLimitKey {
  readonly userId: string;
  readonly sessionId: string;
  readonly route: RateLimitedRoute;
}

/** Counts this request. `null` when it is allowed; otherwise the seconds left in the window. */
export async function takeRateLimit(
  db: Pick<NodePgDatabase, "execute">,
  { userId, sessionId, route }: RateLimitKey,
): Promise<number | null> {
  const { limit, windowSeconds } = RATE_LIMITS[route];
  const window = sql`make_interval(secs => ${windowSeconds})`;
  const lapsed = sql`rate_limit_windows.window_started_at <= now() - ${window}`;

  const { rows } = await db.execute<{ count: number; remaining: number }>(sql`
    insert into rate_limit_windows (user_id, session_id, route, window_started_at, count)
    values (${userId}, ${sessionId}, ${route}, now(), 1)
    on conflict (session_id, route) do update set
      window_started_at = case when ${lapsed} then now() else rate_limit_windows.window_started_at end,
      count = case when ${lapsed} then 1 else rate_limit_windows.count + 1 end,
      updated_at = now()
    returning count,
      extract(epoch from window_started_at + ${window} - now())::float8 as remaining
  `);

  const [{ count, remaining }] = rows;
  if (count <= limit) return null;
  return remaining;
}
