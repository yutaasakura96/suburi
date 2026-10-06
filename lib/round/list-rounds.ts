import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { authenticate, failedFields, guarded, isUuid, type Db, type RoundDeps } from "./http";
import { latestAttempts, scoringCounts } from "./state";
import { roundStatus, type RoundStatus } from "./status";

/**
 * `GET /api/rounds` (07 §5.13): History's list. `started_at desc`, always, and keyset-paginated, so a
 * round started mid-scroll never causes a skipped or repeated row (07 §4).
 *
 * **Every row carries its stamps** — History is where a change of stamp has to be legible per row —
 * and its **derived** status: nothing about abandonment is stored (04 `rounds`).
 */

export const ROUNDS_PAGE_DEFAULT = 20;
export const ROUNDS_PAGE_MAX = 100;

export interface RoundListItem {
  readonly id: string;
  readonly round_type: (typeof s.ROUND_TYPES)[number];
  readonly language: (typeof s.LANGUAGES)[number];
  readonly mode: (typeof s.MODES)[number];
  readonly length: number;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly status: RoundStatus;
  /** Submitted answers, follow-ups' included. */
  readonly answers: number;
  /** By each submitted answer's latest attempt. Counts, never a sum of scores. */
  readonly scoring: { readonly ok: number; readonly pending: number; readonly failed: number };
  readonly stamps: {
    readonly cv_version_label: string;
    readonly rubric_version_label: string;
    /** Every model behind the round's displayed scores: more than one after a retry made under a new model. */
    readonly scoring_model_ids: readonly string[];
  };
}

export interface RoundListPage {
  readonly items: readonly RoundListItem[];
  readonly next_cursor: string | null;
}

export interface RoundListQuery {
  readonly limit: number;
  readonly cursor: Cursor | null;
  readonly language?: (typeof s.LANGUAGES)[number];
  readonly roundType?: (typeof s.ROUND_TYPES)[number];
  readonly mode?: (typeof s.MODES)[number];
}

/** `{ s: started_at, i: id }`: where the previous page ended. `s` keeps Postgres's microseconds. */
interface Cursor {
  readonly s: string;
  readonly i: string;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

/** `null` for anything this server did not mint: the cursor is opaque, and a wrong one is a 400. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { s: startedAt, i: id } = parsed as Record<string, unknown>;
    if (typeof startedAt !== "string" || !TIMESTAMP.test(startedAt) || startedAt.startsWith("0000-")) return null;
    const instant = Date.parse(startedAt);
    if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 19) !== startedAt.slice(0, 19)) return null;
    if (typeof id !== "string" || !isUuid(id)) return null;
    return { s: startedAt, i: id };
  } catch {
    return null;
  }
}

/** One page of the user's rounds, newest first, each with its derived status as of `now`. */
export async function listRounds(db: Db, userId: string, query: RoundListQuery, now: Date): Promise<RoundListPage> {
  const rows = await db
    .select({
      round: s.rounds,
      cvLabel: s.cvVersions.versionLabel,
      rubricLabel: s.rubricVersions.versionLabel,
      // Compared in SQL: a JS `Date` drops the microseconds Postgres keeps (`newerRoundExists`).
      newerRoundExists: sql<boolean>`exists (select 1 from rounds newer where newer.user_id = ${s.rounds.userId} and newer.started_at > ${s.rounds.startedAt})`,
      startedAtExact: sql<string>`to_char(${s.rounds.startedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(s.rounds)
    .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.rounds.cvVersionId))
    .innerJoin(s.rubricVersions, eq(s.rubricVersions.id, s.rounds.rubricVersionId))
    .where(
      and(
        eq(s.rounds.userId, userId),
        query.language ? eq(s.rounds.language, query.language) : undefined,
        query.roundType ? eq(s.rounds.roundType, query.roundType) : undefined,
        query.mode ? eq(s.rounds.mode, query.mode) : undefined,
        query.cursor
          ? sql`(${s.rounds.startedAt}, ${s.rounds.id}) < (${query.cursor.s}::timestamptz, ${query.cursor.i}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(s.rounds.startedAt), desc(s.rounds.id))
    // One past the page says whether another follows, without a count.
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const answers =
    page.length === 0
      ? []
      : await db
          .select({ id: s.answers.id, roundId: s.answers.roundId })
          .from(s.answers)
          .where(and(inArray(s.answers.roundId, page.map((row) => row.round.id)), isNotNull(s.answers.transcriptCorrected)));
  const attempts = await latestAttempts(db, answers.map((answer) => answer.id));

  return {
    items: page.map(({ round, cvLabel, rubricLabel, newerRoundExists }) => {
      const own = answers.filter((answer) => answer.roundId === round.id);
      const latest = own.flatMap((answer) => attempts.get(answer.id) ?? []);
      return {
        id: round.id,
        round_type: round.roundType,
        language: round.language,
        mode: round.mode,
        length: round.length,
        started_at: round.startedAt.toISOString(),
        completed_at: round.completedAt?.toISOString() ?? null,
        status: roundStatus(round, { newerRoundExists, now }),
        answers: own.length,
        scoring: scoringCounts(latest),
        stamps: {
          cv_version_label: cvLabel,
          rubric_version_label: rubricLabel,
          scoring_model_ids: [...new Set(latest.filter((attempt) => attempt.status === "ok").map((attempt) => attempt.modelId))].sort(),
        },
      };
    }),
    next_cursor: rows.length > query.limit && last ? encodeCursor({ s: last.startedAtExact, i: last.round.id }) : null,
  };
}

// A closed set of named parameters, never a query language (07 §4). Strict: an unknown parameter is a
// 400, not ignored — a silently dropped filter on a measurement list is a wrong answer that looks right.
const querySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(ROUNDS_PAGE_MAX).default(ROUNDS_PAGE_DEFAULT),
  cursor: z.string().optional(),
  language: z.enum(s.LANGUAGES).optional(),
  round_type: z.enum(s.ROUND_TYPES).optional(),
  mode: z.enum(s.MODES).optional(),
});

function invalid(fields: readonly string[]) {
  return apiError("invalid_request", "The query failed validation.", { fields });
}

export function createGetRounds(deps: RoundDeps) {
  return guarded("rounds_list_failed", async function GET(request: Request): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;

    const params = new URL(request.url).searchParams;
    // A parameter sent twice has no single value to honour.
    const repeated = [...new Set(params.keys())].filter((key) => params.getAll(key).length > 1);
    if (repeated.length > 0) return invalid(repeated);
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return invalid(failedFields(parsed.error, "query"));
    const cursor = parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === null) return invalid(["cursor"]);

    return Response.json(
      await listRounds(
        deps.db,
        session.userId,
        {
          limit: parsed.data.limit,
          cursor,
          language: parsed.data.language,
          roundType: parsed.data.round_type,
          mode: parsed.data.mode,
        },
        new Date(),
      ),
    );
  });
}
