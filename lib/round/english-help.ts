import { newestEnglish, questionEnglish } from "../questions/translations";
import type { Db } from "./http";
import type { AnswerRow, FollowUpRow, RoundRow } from "./state";

// English help in what a round's routes read (07 §5.4, §5.5, §5.9; 06, 2026-10-14, Q106-2, Q106-3).

/**
 * Whether this round's prompts carry their English: **a Japanese practice round's, and no other.** A
 * realistic round shows no English before its feedback whatever the user's setting says, and an
 * English round has none to show.
 */
export function carriesEnglish(round: Pick<RoundRow, "language" | "mode">) {
  return round.language === "ja" && round.mode === "practice";
}

/**
 * Where a prompt's English is stored (Q106-4): a bank question's is its newest `question_translations`
 * row, and a follow-up's is the `prompt_text_translated` of its own `follow_ups` row.
 */
export type EnglishSource =
  | { readonly questionId: string | null }
  | { readonly followUp: Pick<FollowUpRow, "promptTextTranslated"> | null | undefined };

/** The English of the prompt an answer answered: its question's, or the follow-up row it answers. */
export function answerEnglishSource(
  answer: Pick<AnswerRow, "questionId" | "parentAnswerId">,
  followUps: readonly FollowUpRow[],
): EnglishSource {
  if (answer.questionId !== null) return { questionId: answer.questionId };
  return { followUp: followUps.find((row) => row.parentAnswerId === answer.parentAnswerId) };
}

/** The stored English, or null when the prompt has none. */
export async function storedEnglish(db: Pick<Db, "selectDistinctOn">, source: EnglishSource): Promise<string | null> {
  if ("followUp" in source) return source.followUp?.promptTextTranslated ?? null;
  return source.questionId === null ? null : questionEnglish(db, source.questionId);
}

/**
 * The `text_en` a prompt carries, as the fields to spread into it: **none at all** — not `null`,
 * absent — on a round that does not carry English, so no English can reach a realistic round's
 * screens whatever the client does. Otherwise its stored English, or `null`. Read on every request,
 * never cached on the round.
 */
export async function promptEnglish(
  db: Pick<Db, "selectDistinctOn">,
  round: Pick<RoundRow, "language" | "mode">,
  source: EnglishSource,
): Promise<{ text_en?: string | null }> {
  if (!carriesEnglish(round)) return {};
  return { text_en: await storedEnglish(db, source) };
}

/**
 * Whether a round's prompts carry their English **after it** — screen 8 and Study (10 §8, §16; Q106-3):
 * a Japanese round's, in either mode. The round is over, so a realistic round's English begins here.
 */
export function carriesEnglishAfter(round: Pick<RoundRow, "language">) {
  return round.language === "ja";
}

/**
 * The stored English of every prompt these answers answered, read in one query: a bank question's
 * newest `question_translations` row, a follow-up's own row's (Q106-4). Returns a lookup by answer,
 * null where the prompt has none. Reads only; nothing is generated for a prompt without English.
 */
export async function answersEnglish(
  db: Pick<Db, "selectDistinctOn">,
  answers: readonly Pick<AnswerRow, "questionId" | "parentAnswerId">[],
  followUps: readonly FollowUpRow[],
): Promise<(answer: Pick<AnswerRow, "questionId" | "parentAnswerId">) => string | null> {
  const questionIds = [...new Set(answers.flatMap((answer) => (answer.questionId === null ? [] : [answer.questionId])))];
  const english = await newestEnglish(db, questionIds);
  return (answer) => {
    const source = answerEnglishSource(answer, followUps);
    if ("followUp" in source) return source.followUp?.promptTextTranslated ?? null;
    return source.questionId === null ? null : (english.get(source.questionId) ?? null);
  };
}
