import { sql } from "drizzle-orm";
import { bankSupply, type BankCounts, type RoundMode } from "./bank-supply";
import type { Db } from "./http";

type RoundType = "behavioural" | "technical" | "hr" | "ceo";

/**
 * Choosing every bank question a round will ask, **once, at round start** (07 §5.4, 06 2026-09-27).
 * The choice is written to `round_questions` with the round, so a refresh can never re-choose.
 *
 * **Seen** means an answer exists for the question in this language, in either mode (04). Choosing a
 * question does not consume it: only an answer does.
 */
export interface Candidate {
  readonly id: string;
  readonly origin: "set_piece" | "generated";
  readonly seen: boolean;
}

export interface QuestionPlan {
  /** What the bank gives the round, in the order it will be asked. At most `length`. */
  readonly chosen: readonly string[];
  /** How many more the round needs: generated at round start, in parallel with the preflight. */
  readonly shortfall: number;
  /**
   * Questions to fall back on if generation cannot cover the shortfall — every candidate was a
   * near-duplicate, say. **Repeats**, so never first attempts: used last, and said on Setup first.
   */
  readonly reserve: readonly string[];
}

/**
 * The order (07 §5.4):
 *
 * - **Realistic:** at most one **unseen** set piece of the round's type, then unseen generated
 *   questions, then newly generated ones. Seen generated questions are the reserve.
 * - **Practice** prefers seen generated questions and falls back to unseen ones, then new ones, so
 *   practice does not spend the unseen pool; it takes no set piece and has no reserve.
 *
 * Candidates arrive oldest first, and the order is kept within each group, so a choice is
 * reproducible.
 */
export function planQuestions(candidates: readonly Candidate[], mode: RoundMode, length: number): QuestionPlan {
  const ids = (list: readonly Candidate[]) => list.map((candidate) => candidate.id);
  const generated = candidates.filter((candidate) => candidate.origin === "generated");
  const unseen = generated.filter((candidate) => !candidate.seen);
  const seen = generated.filter((candidate) => candidate.seen);

  const ordered =
    mode === "realistic"
      ? [...candidates.filter((candidate) => candidate.origin === "set_piece" && !candidate.seen).slice(0, 1), ...unseen]
      : [...seen, ...unseen];
  const chosen = ids(ordered.slice(0, length));
  return { chosen, shortfall: length - chosen.length, reserve: mode === "realistic" ? ids(seen) : [] };
}

export function countCandidates(candidates: readonly Candidate[]): BankCounts {
  const count = (origin: Candidate["origin"], seen: boolean) =>
    candidates.filter((candidate) => candidate.origin === origin && candidate.seen === seen).length;
  return {
    unseenSetPieces: count("set_piece", false),
    unseenGenerated: count("generated", false),
    seenGenerated: count("generated", true),
  };
}

/** The questions a round of `length` would have to generate — what Setup warns about (10 §2). */
export function shortfallOf(counts: BankCounts, mode: RoundMode, length: number) {
  return Math.max(0, length - bankSupply(counts, mode));
}

/** Every round type's counts in one language: what Setup holds, so its warning needs no request (10 §2). */
export async function loadBankCounts(db: Pick<Db, "execute">, { userId, language }: { userId: string; language: string }) {
  const { rows } = await db.execute<{ round_type: RoundType; origin: Candidate["origin"]; seen: boolean; n: number }>(sql`
    select round_type, origin, seen, count(*)::int as n
    from (
      select q.round_type, q.origin,
        exists (select 1 from answers a where a.question_id = q.id and a.language = q.language) as seen
      from questions q
      where q.user_id = ${userId} and q.language = ${language} and q.retired_at is null
    ) slice
    group by round_type, origin, seen`);
  const of = (roundType: RoundType, origin: Candidate["origin"], seen: boolean) =>
    rows.find((row) => row.round_type === roundType && row.origin === origin && row.seen === seen)?.n ?? 0;
  const counts = (roundType: RoundType): BankCounts => ({
    unseenSetPieces: of(roundType, "set_piece", false),
    unseenGenerated: of(roundType, "generated", false),
    seenGenerated: of(roundType, "generated", true),
  });
  return { behavioural: counts("behavioural"), technical: counts("technical"), hr: counts("hr"), ceo: counts("ceo") };
}

/** The `(user_id, language, round_type) where retired_at is null` slice, each with its seen flag. */
export async function loadCandidates(
  db: Pick<Db, "execute">,
  { userId, language, roundType }: { userId: string; language: string; roundType: string },
): Promise<Candidate[]> {
  const { rows } = await db.execute<{ id: string; origin: "set_piece" | "generated"; seen: boolean }>(sql`
    select q.id, q.origin,
      exists (select 1 from answers a where a.question_id = q.id and a.language = q.language) as seen
    from questions q
    where q.user_id = ${userId} and q.language = ${language} and q.round_type = ${roundType}
      and q.retired_at is null
    order by q.created_at, q.id`);
  return rows;
}
