import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { roundAbandoned } from "./http";
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
export type FollowUpRow = typeof s.followUps.$inferSelect;
/** A follow-up that was generated: the row carries the question as asked. */
export type GeneratedFollowUp = FollowUpRow & { readonly status: "generated"; readonly promptText: string };

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

/**
 * Every answer of the round, in the order a round renders: position, the bank question's answers
 * before its follow-up's — they share the position — then when each was opened.
 */
export async function roundAnswers(db: Reader, roundId: string): Promise<AnswerRow[]> {
  return db
    .select()
    .from(s.answers)
    .where(eq(s.answers.roundId, roundId))
    .orderBy(asc(s.answers.position), asc(sql`${s.answers.parentAnswerId} is not null`), asc(s.answers.createdAt));
}

/** The round's follow-ups, generated or missing: one row per parent answer (04 `follow_ups`). */
export async function roundFollowUps(db: Reader, roundId: string): Promise<FollowUpRow[]> {
  const rows = await db
    .select({ followUp: s.followUps })
    .from(s.followUps)
    .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
    .where(eq(s.answers.roundId, roundId));
  return rows.map((row) => row.followUp);
}

/**
 * Where the round is. A position is its bank question and then that answer's one follow-up, which
 * **shares the position** (06, 2026-09-27, confirm 3). The first position with something still to do
 * is where the round is:
 *
 * - the bank question is not submitted: it is being answered, with its open row if the slot is open;
 * - it is submitted and has **no `follow_ups` row yet**: the follow-up is due, and only `submit`
 *   produces it (07 §5.9) — nothing else generates one, and nothing regenerates one;
 * - the row is `generated` and its answer is not submitted: the follow-up is being answered;
 * - the row is `missing`, or the follow-up is answered: the position is done.
 *
 * With every position done, a realistic round is waiting for its felt-pressure rating and `complete`,
 * a practice round for `complete` alone.
 *
 * **Only an original answer to a bank question has a follow-up.** A follow-up's own answer has none,
 * and neither has a practice "answer again" (`retry_of_answer_id`): both are simply never looked at
 * here, which is what keeps "one follow-up per answer" from being a rule a caller has to remember.
 */
export type RoundStep =
  | {
      readonly kind: "answer";
      readonly position: number;
      readonly answer: AnswerRow | null;
      /** Set when the prompt is the follow-up to `parent`; null for the bank question. */
      readonly followUp: { readonly row: GeneratedFollowUp; readonly parent: AnswerRow } | null;
    }
  | { readonly kind: "follow_up_due"; readonly position: number; readonly parent: AnswerRow }
  | { readonly kind: "pressure" }
  | { readonly kind: "finish" }
  | { readonly kind: "complete" };

export function roundStep(
  round: Pick<RoundRow, "length" | "mode" | "completedAt">,
  answers: readonly AnswerRow[],
  followUps: readonly FollowUpRow[],
): RoundStep {
  if (round.completedAt !== null) return { kind: "complete" };
  const originals = answers.filter((answer) => answer.retryOfAnswerId === null);
  for (let position = 1; position <= round.length; position += 1) {
    const question = originals.find((row) => row.questionId !== null && row.position === position) ?? null;
    if (question?.transcriptCorrected == null) return { kind: "answer", position, answer: question, followUp: null };
    const row = followUps.find((followUp) => followUp.parentAnswerId === question.id);
    if (!row) return { kind: "follow_up_due", position, parent: question };
    if (row.status === "missing") continue;
    const answer = originals.find((candidate) => candidate.parentAnswerId === question.id) ?? null;
    if (answer?.transcriptCorrected == null) {
      return { kind: "answer", position, answer, followUp: { row: row as GeneratedFollowUp, parent: question } };
    }
  }
  return round.mode === "realistic" ? { kind: "pressure" } : { kind: "finish" };
}

/**
 * A practice "answer again" that is open and not yet sent (07 §5.6): the newest unsubmitted row with
 * `retry_of_answer_id`. It is no step of the round — `roundStep` never looks at it — but a reload
 * resumes on it, and the slot handler returns it rather than opening a second one.
 */
export function openRetry(answers: readonly AnswerRow[], originalId?: string): AnswerRow | null {
  return answers
    .filter((answer) => answer.retryOfAnswerId !== null && answer.transcriptCorrected === null)
    .filter((answer) => originalId === undefined || answer.retryOfAnswerId === originalId)
    .reduce<AnswerRow | null>((newest, answer) => (newest === null || answer.createdAt > newest.createdAt ? answer : newest), null);
}

/** `state` in the round's read (07 §5.5): derived from which of the answer's columns are filled, never stored. */
export function answerState(answer: Pick<AnswerRow, "audioS3Key" | "transcriptRaw" | "transcriptCorrected">) {
  if (answer.transcriptCorrected !== null) return "submitted";
  if (answer.transcriptRaw !== null) return "transcribed";
  return answer.audioS3Key !== null ? "uploaded" : "open";
}

/** `roundStep` from the stored rows, for a handler inside its transaction or a page outside one. */
export async function readRoundStep(db: Reader, round: RoundRow): Promise<RoundStep> {
  return roundStep(round, await roundAnswers(db, round.id), await roundFollowUps(db, round.id));
}

/** How many of the round's bank questions are submitted when it stands at `step`, for the header. */
export function questionsSubmitted(round: Pick<RoundRow, "length">, step: RoundStep) {
  if (step.kind === "follow_up_due") return step.position;
  if (step.kind !== "answer") return round.length;
  return step.followUp ? step.position : step.position - 1;
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

export async function lockRoundUser(db: Reader, userId: string) {
  await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, userId)).for("no key update");
}

export async function roundWriteRefusal(db: Reader, roundId: string, userId: string): Promise<Response | null> {
  await lockRoundUser(db, userId);
  const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId)).for("update");
  if (round.completedAt !== null) return apiError("round_already_complete", "The round is already complete.", { round_id: roundId });
  return (await isAbandoned(db, round)) ? roundAbandoned(roundId) : null;
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

/** No score landed and none can land in the round: its feedback is refused as `no_scores` (07 §5.12). */
export function noScores(counts: ReturnType<typeof scoringCounts>) {
  return counts.ok === 0 && counts.pending === 0;
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
