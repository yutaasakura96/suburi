import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { z } from "zod";
import { apiError, rateLimited, unauthenticated, type ErrorDetail } from "../api/errors";
import { takeRateLimit, type RateLimitedRoute } from "../api/rate-limit";
import { sessionOf, type SessionReader } from "../auth/session";

// Relative imports: the integration tests load these files outside Next's path aliases.

/**
 * What every round route shares (07 §1): the session re-check, the per-session limiter on ⚡ routes,
 * Zod at the boundary, and **`write_failed`** — the one answer to a database failure mid-write
 * (06, 2026-09-28).
 *
 * **Nothing in a log line or an envelope carries record text** (12 §7): no transcript, corrected
 * text, question or model output. Ids, counts, durations and error classes only.
 */

export type Db = NodePgDatabase;

export interface RoundDeps {
  readonly auth: SessionReader;
  readonly db: Db;
  /** One transaction: everything the call writes lands together or not at all. */
  readonly transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>;
}

export function log(level: "info" | "error", fields: Record<string, string | number | boolean | null>) {
  console[level](JSON.stringify(fields));
}

/** Only `pg_<SQLSTATE>` leaves a failed write: drizzle's message carries the query's parameters. */
export function pgErrorClass(error: unknown) {
  const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: unknown };
  return typeof pg.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code) ? `pg_${pg.code}` : "unexpected";
}

/**
 * `500 write_failed` (07 §3): the write was one transaction, so nothing is half-written, and the round
 * resumes at the same call. `detail` carries ids and the SQLSTATE only.
 */
export function writeFailed(event: string, error: unknown, ids: Record<string, string>): Response {
  const errorClass = pgErrorClass(error);
  log("error", { event, ...ids, error_class: errorClass });
  return apiError("write_failed", "A database write failed; nothing was written.", { ...ids, error_class: errorClass });
}

/** The id a route was called with, as its failure's `detail` — when it is one (a malformed id is a 404). */
type Ids = Record<string, string>;
export const roundIdOf = (_request: Request, roundId: string): Ids => (isUuid(roundId) ? { round_id: roundId } : {});
export const answerIdOf = (_request: Request, answerId: string): Ids => (isUuid(answerId) ? { answer_id: answerId } : {});
export const attemptIdOf = (_request: Request, attemptId: string): Ids => (isUuid(attemptId) ? { attempt_id: attemptId } : {});
const noId = (): Ids => ({});

/**
 * Every round route's outermost line: **never a bare `500`** (07 §2). A handler turns the failures it
 * expects into their own envelopes, and its writes into `write_failed` where the transaction is.
 * Whatever still throws — the session read, the limiter's upsert, a read between two writes — is a
 * database call the route did not finish, and leaves the same way: the envelope, ids and the error
 * class, and a round that resumes at the same call.
 */
export function guarded<A extends [Request, ...string[]]>(
  event: string,
  handler: (...args: A) => Promise<Response>,
  ids: (...args: A) => Ids = noId,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return writeFailed(event, error, ids(...args));
    }
  };
}

/** `409 round_abandoned` (07 §3): a newer round started, or this one is from an earlier day. */
export function roundAbandoned(roundId: string): Response {
  return apiError("round_abandoned", "The round is abandoned; it takes no more writes.", { round_id: roundId });
}

/** The session, or the 401 — and on a ⚡ route, the request counted before the body is read. */
export async function authenticate(
  deps: Pick<RoundDeps, "auth" | "db">,
  request: Request,
  route?: RateLimitedRoute,
): Promise<{ userId: string; sessionId: string } | Response> {
  const session = await sessionOf(deps.auth, request.headers);
  if (!session) return unauthenticated();
  if (route) {
    const wait = await takeRateLimit(deps.db, { ...session, route });
    if (wait !== null) return rateLimited("Too many requests on this route in this window.", wait);
  }
  return session;
}

/** Zod at the boundary. A 400 names the failing fields, never their values (07 §2). */
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return apiError("invalid_request", "The request body is not JSON.", { fields: ["body"] });
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;
  return apiError("invalid_request", "The request failed validation.", { fields: failedFields(parsed.error, "body") });
}

/**
 * The fields a failed parse names. An unknown key (a strict schema) is named by the key itself:
 * `cv_version_id` sent to `POST /api/rounds` is the answer the caller needs, not `body`.
 */
export function failedFields(error: z.ZodError, root: string) {
  return [
    ...new Set(
      error.issues.flatMap((issue) => {
        const at = issue.path.join(".");
        if (issue.code === "unrecognized_keys") return issue.keys.map((key) => (at ? `${at}.${key}` : key));
        return [at || root];
      }),
    ),
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres refuses a malformed uuid with an error rather than no rows; an id from a URL is a 404. */
export function isUuid(value: string) {
  return UUID.test(value);
}

export function notFound(what: string, detail: ErrorDetail = {}) {
  return apiError("not_found", `No ${what} with that id for this user.`, detail);
}
