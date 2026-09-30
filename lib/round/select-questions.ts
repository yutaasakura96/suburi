import { sql } from "drizzle-orm";
import type { Db } from "./http";

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

/**
 * The order, without generation (#47 adds it):
 *
 * - **Realistic:** at most one **unseen** set piece of the round's type, then unseen generated
 *   questions. Where those cannot fill the round, #47 generates new ones; until it exists, seen
 *   generated questions fill the rest — "unseen first" (07 §5.4 step 2) — and none of them can be a
 *   first attempt, because the first-attempt rule is computed from answers, not from this choice.
 * - **Practice** prefers seen generated questions and falls back to unseen ones, so practice does not
 *   spend the unseen pool; it takes no set piece.
 *
 * `null` when the bank cannot fill the round at all. Candidates arrive oldest first, and the order is
 * kept within each group, so a choice is reproducible.
 */
export function chooseQuestions(candidates: readonly Candidate[], mode: "realistic" | "practice", length: number) {
  const generated = candidates.filter((candidate) => candidate.origin === "generated");
  const unseen = generated.filter((candidate) => !candidate.seen);
  const seen = generated.filter((candidate) => candidate.seen);

  const ordered =
    mode === "realistic"
      ? [...candidates.filter((candidate) => candidate.origin === "set_piece" && !candidate.seen).slice(0, 1), ...unseen, ...seen]
      : [...seen, ...unseen];
  if (ordered.length < length) return null;
  return ordered.slice(0, length).map((candidate) => candidate.id);
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
