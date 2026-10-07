import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema";
import { tokyoDate } from "../monitor/week";
import type { FirstAttemptPoint } from "./series";

type Reader = Pick<NodePgDatabase, "select">;

export type ProgressLanguage = (typeof s.LANGUAGES)[number];
export type ProgressRoundType = (typeof s.ROUND_TYPES)[number];
/** US-2: rounds run under General practice are grouped apart from rounds pitched at a role. */
export type ProgressContext = "role" | "general";

export interface FirstAttempt {
  readonly language: ProgressLanguage;
  readonly roundType: ProgressRoundType;
  readonly context: ProgressContext;
  readonly point: FirstAttemptPoint;
}

/**
 * The attempt whose scores an answer displays, per answer id: its first attempt, or the newest
 * deliberate re-score of it (`is_superseding`). **A held-out re-score never becomes one** (04
 * `held_out_rescores`): it is a later row with `is_superseding = false`, and is passed over here.
 */
function displayedAttempts<T extends { readonly answerId: string; readonly isSuperseding: boolean }>(oldestFirst: readonly T[]) {
  const displayed = new Map<string, T>();
  for (const attempt of oldestFirst) {
    if (!displayed.has(attempt.answerId) || attempt.isSuperseding) displayed.set(attempt.answerId, attempt);
  }
  return displayed;
}

/**
 * Every first attempt Progress plots (10 §9), oldest first — **the only place the exclusions are
 * decided**, so the screen's footer, Home's count and the plots cannot disagree. Excluded:
 *
 * - practice rounds, retries, follow-ups and questions practised first — none is a first attempt
 *   (04 `answers`), and the mode and the retry are checked again here rather than trusted;
 * - abandoned rounds, and a round still open: only a completed round is read (PRD §7, US-8);
 * - typed answers: `transcript_raw` set with no transcriber (07 §5.8);
 * - pending and failed scores: no measurement, never a zero (11 §3.5);
 * - answers given in the wrong language, by the scorer's own reading (`answered_language`).
 */
export async function firstAttempts(db: Reader, userId: string): Promise<FirstAttempt[]> {
  const answers = await db
    .select({
      id: s.answers.id,
      language: s.answers.language,
      position: s.answers.position,
      createdAt: s.answers.createdAt,
      roundType: s.rounds.roundType,
      contextKind: s.roleContexts.kind,
      origin: s.questions.origin,
    })
    .from(s.answers)
    .innerJoin(s.rounds, eq(s.rounds.id, s.answers.roundId))
    .innerJoin(s.roleContexts, eq(s.roleContexts.id, s.rounds.roleContextId))
    .innerJoin(s.questions, eq(s.questions.id, s.answers.questionId))
    .where(
      and(
        eq(s.answers.userId, userId),
        s.answers.isFirstAttempt,
        eq(s.rounds.mode, "realistic"),
        isNull(s.answers.retryOfAnswerId),
        isNotNull(s.rounds.completedAt),
        sql`not (${s.answers.transcriptRaw} is not null and ${s.answers.transcriberModelId} is null)`,
      ),
    )
    .orderBy(asc(s.answers.createdAt), asc(s.answers.id));
  if (answers.length === 0) return [];

  const attempts = displayedAttempts(
    await db
      .select({
        id: s.scoringAttempts.id,
        answerId: s.scoringAttempts.answerId,
        status: s.scoringAttempts.status,
        isSuperseding: s.scoringAttempts.isSuperseding,
        answeredLanguage: s.scoringAttempts.answeredLanguage,
        cvVersionId: s.scoringAttempts.cvVersionId,
        cvLabel: s.cvVersions.versionLabel,
        rubricVersionId: s.scoringAttempts.rubricVersionId,
        rubricLabel: s.rubricVersions.versionLabel,
        generatorPromptVersion: s.scoringAttempts.generatorPromptVersion,
        modelId: s.scoringAttempts.modelId,
        scoringPromptVersion: s.scoringAttempts.scoringPromptVersion,
      })
      .from(s.scoringAttempts)
      .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.scoringAttempts.cvVersionId))
      .innerJoin(s.rubricVersions, eq(s.rubricVersions.id, s.scoringAttempts.rubricVersionId))
      .where(inArray(s.scoringAttempts.answerId, answers.map((answer) => answer.id)))
      .orderBy(asc(s.scoringAttempts.createdAt), asc(s.scoringAttempts.id)),
  );

  const plotted = answers.flatMap((answer) => {
    const attempt = attempts.get(answer.id);
    if (!attempt || attempt.status !== "ok") return [];
    // Null is an attempt from before the scorer returned a language, and is not a mismatch (04).
    if (attempt.answeredLanguage !== null && attempt.answeredLanguage !== answer.language) return [];
    return [{ answer, attempt }];
  });
  if (plotted.length === 0) return [];

  const scoreRows = await db
    .select({ attemptId: s.scores.scoringAttemptId, dimension: s.scores.dimension, value: s.scores.value })
    .from(s.scores)
    .where(inArray(s.scores.scoringAttemptId, plotted.map(({ attempt }) => attempt.id)));
  const scoresOf = new Map<string, Record<string, number>>();
  for (const row of scoreRows) {
    const scores = scoresOf.get(row.attemptId) ?? {};
    scores[row.dimension] = row.value;
    scoresOf.set(row.attemptId, scores);
  }

  return plotted.map(({ answer, attempt }) => ({
    language: answer.language,
    roundType: answer.roundType,
    context: answer.contextKind === "general" ? "general" : "role",
    point: {
      answerId: answer.id,
      date: tokyoDate(answer.createdAt),
      position: answer.position,
      stamps: {
        cvVersionId: attempt.cvVersionId,
        cvLabel: attempt.cvLabel,
        rubricVersionId: attempt.rubricVersionId,
        rubricLabel: attempt.rubricLabel,
        generatorPromptVersion: attempt.generatorPromptVersion,
        origin: answer.origin,
        modelId: attempt.modelId,
        scoringPromptVersion: attempt.scoringPromptVersion,
      },
      scores: scoresOf.get(attempt.id) ?? {},
    },
  }));
}

/** One panel's series: a language, within a round type, within one of the two context groups. */
export function seriesOf(
  all: readonly FirstAttempt[],
  where: { readonly language: ProgressLanguage; readonly roundType: ProgressRoundType; readonly context: ProgressContext },
): FirstAttemptPoint[] {
  return all
    .filter((entry) => entry.language === where.language && entry.roundType === where.roundType && entry.context === where.context)
    .map((entry) => entry.point);
}

/** The count each language is measured against thirty by (PRD §1): every first attempt Progress plots. */
export function firstAttemptCounts(all: readonly FirstAttempt[]): Record<ProgressLanguage, number> {
  return {
    ja: all.filter((entry) => entry.language === "ja").length,
    en: all.filter((entry) => entry.language === "en").length,
  };
}
