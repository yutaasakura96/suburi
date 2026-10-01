import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import * as s from "../../db/schema";
import type { Db } from "./http";
import { roundStatus } from "./status";

/**
 * A round's position and what it is asking are **database facts** (03 §7): the prompt at position n
 * is `round_questions`' row, never chosen again, and where the round is comes from its answers. Read
 * by the handlers and by the round page, so both see one derivation.
 */

type Reader = Pick<Db, "select" | "execute">;

export type RoundRow = typeof s.rounds.$inferSelect;
export type AnswerRow = typeof s.answers.$inferSelect;

export async function getRound(db: Reader, userId: string, roundId: string): Promise<RoundRow | null> {
  const [round] = await db
    .select()
    .from(s.rounds)
    .where(and(eq(s.rounds.id, roundId), eq(s.rounds.userId, userId)));
  return round ?? null;
}

export async function promptAt(db: Reader, roundId: string, position: number) {
  const [row] = await db
    .select({ questionId: s.questions.id, text: s.questions.body, generatorPromptVersion: s.questions.generatorPromptVersion })
    .from(s.roundQuestions)
    .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
    .where(and(eq(s.roundQuestions.roundId, roundId), eq(s.roundQuestions.position, position)));
  return row ?? null;
}

/** Every answer of the round, in the order a round renders: position, then when it was opened. */
export async function roundAnswers(db: Reader, roundId: string): Promise<AnswerRow[]> {
  return db
    .select()
    .from(s.answers)
    .where(eq(s.answers.roundId, roundId))
    .orderBy(asc(s.answers.position), asc(s.answers.createdAt));
}

/**
 * Where the round is. The first position whose bank-question answer is not submitted is being
 * answered — with its open row, if the slot is already open. With every position submitted, a
 * realistic round is waiting for its felt-pressure rating and `complete`, a practice round for
 * `complete` alone. No follow-up yet (#44): a position is one answer.
 */
export type RoundStep =
  | { readonly kind: "answer"; readonly position: number; readonly answer: AnswerRow | null }
  | { readonly kind: "pressure" }
  | { readonly kind: "finish" }
  | { readonly kind: "complete" };

export function roundStep(round: Pick<RoundRow, "length" | "mode" | "completedAt">, answers: readonly AnswerRow[]): RoundStep {
  if (round.completedAt !== null) return { kind: "complete" };
  const questionAnswers = answers.filter((answer) => answer.questionId !== null && answer.retryOfAnswerId === null);
  for (let position = 1; position <= round.length; position += 1) {
    const answer = questionAnswers.find((row) => row.position === position) ?? null;
    if (answer?.transcriptCorrected == null) return { kind: "answer", position, answer };
  }
  return round.mode === "realistic" ? { kind: "pressure" } : { kind: "finish" };
}

/**
 * Starting a round abandons any older open one (04 `rounds`); this is the "newer" half of that.
 * Compared in SQL against the stored `started_at`: a JS `Date` keeps milliseconds and Postgres keeps
 * microseconds, so a round read back into JS would otherwise be older than itself.
 */
export async function newerRoundExists(db: Reader, round: Pick<RoundRow, "id" | "userId">) {
  const [row] = await db
    .select({ id: s.rounds.id })
    .from(s.rounds)
    .where(
      and(
        eq(s.rounds.userId, round.userId),
        ne(s.rounds.id, round.id),
        sql`${s.rounds.startedAt} > (select started_at from rounds where id = ${round.id})`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether an open round is abandoned (07 §5.5), read inside the write's transaction: an abandoned
 * round takes no more writes, so a stale tab can neither answer into it nor complete it (§5.12).
 */
export async function isAbandoned(db: Reader, round: RoundRow) {
  return roundStatus(round, { newerRoundExists: await newerRoundExists(db, round), now: new Date() }) === "abandoned";
}

export type AttemptRow = typeof s.scoringAttempts.$inferSelect;

/** Each answer's latest scoring attempt — the one every score read uses (04 §3). */
export async function latestAttempts(db: Reader, answerIds: readonly string[]): Promise<Map<string, AttemptRow>> {
  if (answerIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(s.scoringAttempts)
    .where(inArray(s.scoringAttempts.answerId, [...answerIds]))
    .orderBy(asc(s.scoringAttempts.answerId), desc(s.scoringAttempts.createdAt));
  const latest = new Map<string, AttemptRow>();
  for (const row of rows) if (!latest.has(row.answerId)) latest.set(row.answerId, row);
  return latest;
}

/** `07` §5.12's `scoring` block: what is in, by each answer's latest attempt. Counts, never a sum of scores. */
export function scoringCounts(attempts: Iterable<AttemptRow>) {
  const counts = { ok: 0, pending: 0, failed: 0 };
  for (const attempt of attempts) counts[attempt.status] += 1;
  return counts;
}

/**
 * Whether this question already has an answer in this language, in either mode, in any round — the
 * question is then seen for good, and no later answer to it can be a first attempt (06, 2026-09-27).
 */
export async function answeredBefore(db: Reader, questionId: string, language: string) {
  const { rows } = await db.execute<{ answered: boolean }>(sql`
    select exists (select 1 from answers where question_id = ${questionId} and language = ${language}) as answered`);
  return rows[0].answered;
}
