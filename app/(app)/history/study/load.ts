import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import type { FeedbackItem, TranslatedFeedback } from "@/lib/ai/round-feedback";
import { answersEnglish, carriesEnglishAfter } from "@/lib/round/english-help";
import type { Db } from "@/lib/round/http";
import { encodeCursor, type Cursor } from "@/lib/round/list-rounds";
import type { AnswerRow } from "@/lib/round/state";
import type { RoundLanguage, RoundMode, RoundType } from "../../round/copy";
import { modelAnswerView, type ModelAnswerView } from "../../round/load";

// What the study view reads (10 §16). Server-only, from stored rows: nothing here calls a model,
// writes a row, or reads a score.

/** Rounds a page: each is up to seven questions and their follow-ups, said and modelled. */
export const STUDY_PAGE_ROUNDS = 10;

/** What was said to one prompt, the model answer stored for it, and every time it was answered again. */
export interface StudyAnswer {
  /** The corrected transcript, as it was scored. */
  readonly own: string;
  /** Null when none is stored: its call failed, the round never completed, or it is from before model answers existed. */
  readonly modelAnswer: ModelAnswerView | null;
  /** A practice round's answers given again, in the order they were given: rows beside the first (04 `answers`). */
  readonly again: readonly string[];
}

/**
 * A prompt as asked, and its stored English for the pill (10 §16, #106): a string, or null when it
 * has none. The key only on a Japanese round; an English round's prompts have nothing to show.
 */
export interface StudyPrompt {
  readonly prompt: string;
  readonly promptEn?: string | null;
}

export interface StudyQuestion extends StudyAnswer, StudyPrompt {
  readonly position: number;
  readonly followUp: (StudyPrompt & StudyAnswer) | null;
}

export interface StudyRound {
  readonly id: string;
  readonly complete: boolean;
  readonly roundType: RoundType;
  readonly language: RoundLanguage;
  readonly mode: RoundMode;
  readonly length: number;
  readonly startedAt: string;
  /** The CV version the round's model answers were written from: their legend names it. */
  readonly cvLabel: string;
  /** Only the questions the round's answers made seen, in the order they were asked. */
  readonly questions: readonly StudyQuestion[];
  /** The round's stored `to_fix` (04 `round_feedback`); null when its findings were never written. */
  readonly toFix: readonly FeedbackItem[] | null;
  /** A Japanese round's `to_fix` in English, stored with it; null on an English round, or when none was stored. */
  readonly toFixTranslated: readonly FeedbackItem[] | null;
}

export interface StudyPage {
  readonly rounds: readonly StudyRound[];
  /** Where the next page starts; null on the last. */
  readonly older: string | null;
}

/**
 * One page of the study view: rounds with a submitted answer, newest first, keyset-paged as
 * History's list is (07 §4). Open rounds can have answers without model answers or findings.
 *
 * **Only an answer puts a question here.** A question fixed for a round and never answered is not
 * read at all (04 `round_questions`), so this page cannot make it seen.
 */
export async function studyPage(db: Db, userId: string, cursor: Cursor | null): Promise<StudyPage> {
  const rows = await db
    .select({
      round: s.rounds,
      cvLabel: s.cvVersions.versionLabel,
      // Kept in SQL: a JS `Date` drops the microseconds Postgres keeps (`listRounds`).
      startedAtExact: sql<string>`to_char(${s.rounds.startedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(s.rounds)
    .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.rounds.cvVersionId))
    .where(
      and(
        eq(s.rounds.userId, userId),
        exists(
          db.select({ id: s.answers.id }).from(s.answers).where(and(
            eq(s.answers.roundId, s.rounds.id),
            isNotNull(s.answers.transcriptCorrected),
            isNotNull(s.answers.questionId),
            isNull(s.answers.retryOfAnswerId),
          )),
        ),
        cursor ? sql`(${s.rounds.startedAt}, ${s.rounds.id}) < (${cursor.s}::timestamptz, ${cursor.i}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(s.rounds.startedAt), desc(s.rounds.id))
    // One past the page says whether another follows, without a count.
    .limit(STUDY_PAGE_ROUNDS + 1);
  const page = rows.slice(0, STUDY_PAGE_ROUNDS);
  const last = page.at(-1);
  const older = rows.length > STUDY_PAGE_ROUNDS && last ? encodeCursor({ s: last.startedAtExact, i: last.round.id }) : null;
  if (page.length === 0) return { rounds: [], older };

  const roundIds = page.map((row) => row.round.id);
  const [answers, feedback] = await Promise.all([
    db
      .select()
      .from(s.answers)
      .where(and(inArray(s.answers.roundId, roundIds), isNotNull(s.answers.transcriptCorrected)))
      .orderBy(asc(s.answers.position), asc(s.answers.createdAt)),
    db.select().from(s.roundFeedback).where(inArray(s.roundFeedback.roundId, roundIds)),
  ]);
  const answerIds = answers.map((answer) => answer.id);
  // English help after the round (10 §16): only a Japanese round's prompts carry their English.
  const withheld = new Set(page.filter(({ round }) => round.language === "ja" && round.mode === "realistic" && round.completedAt === null).map(({ round }) => round.id));
  const japanese = new Set(page.filter(({ round }) => carriesEnglishAfter(round) && !withheld.has(round.id)).map(({ round }) => round.id));
  const japaneseAnswers = answers.filter((answer) => japanese.has(answer.roundId));
  const [modelAnswers, followUps] = await Promise.all([
    db.select().from(s.modelAnswers).where(inArray(s.modelAnswers.answerId, answerIds)),
    japaneseAnswers.length === 0
      ? []
      : db.select().from(s.followUps).where(inArray(s.followUps.parentAnswerId, japaneseAnswers.map((answer) => answer.id))),
  ]);
  const englishOf = await answersEnglish(db, japaneseAnswers, followUps);
  const english = (answer: AnswerRow) => (japanese.has(answer.roundId) ? { promptEn: englishOf(answer) } : {});

  /** An answer, with every "answer again" made of it. A retry reads its original's model answer and has none of its own. */
  function said(answer: AnswerRow): StudyAnswer {
    const modelAnswer = modelAnswers.find((row) => row.answerId === answer.id);
    const modelView = modelAnswer ? modelAnswerView(modelAnswer) : null;
    return {
      own: answer.transcriptCorrected ?? "",
      modelAnswer: modelView && withheld.has(answer.roundId) ? { ...modelView, translated: null } : modelView,
      again: answers.filter((row) => row.retryOfAnswerId === answer.id).map((row) => row.transcriptCorrected ?? ""),
    };
  }

  function followUpOf(question: AnswerRow): StudyQuestion["followUp"] {
    const answer = answers.find((candidate) => candidate.parentAnswerId === question.id && candidate.retryOfAnswerId === null);
    return answer ? { prompt: answer.promptText, ...english(answer), ...said(answer) } : null;
  }

  return {
    rounds: page.map(({ round, cvLabel }) => {
      const stored = feedback.find((row) => row.roundId === round.id);
      const translated = (stored?.bodyTranslated ?? null) as TranslatedFeedback | null;
      return {
        id: round.id,
        complete: round.completedAt !== null,
        roundType: round.roundType,
        language: round.language,
        mode: round.mode,
        length: round.length,
        startedAt: round.startedAt.toISOString(),
        cvLabel,
        questions: answers
          .filter((answer) => answer.roundId === round.id && answer.questionId !== null && answer.retryOfAnswerId === null)
          .map((answer) => ({
            position: answer.position,
            prompt: answer.promptText,
            ...english(answer),
            ...said(answer),
            followUp: followUpOf(answer),
          })),
        toFix: stored ? (stored.toFix as FeedbackItem[]) : null,
        toFixTranslated: withheld.has(round.id) ? null : (translated?.to_fix ?? null),
      };
    }),
    older,
  };
}
