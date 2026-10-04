import { asc, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Db } from "@/lib/round/http";
import { rewritePercent } from "@/lib/round/measures";
import {
  latestAttempts,
  newerRoundExists,
  roundAnswers,
  roundFollowUps,
  type AnswerRow,
  type AttemptRow,
  type RoundRow,
} from "@/lib/round/state";
import { roundStatus } from "@/lib/round/status";
import type { Rubric } from "@/lib/rubric/types";
import type { RoundLanguage, RoundType } from "../round/copy";
import type { HistoryStatus, RoundMode } from "./copy";

// What History's detail reads (10 §10). Server-only, from stored rows: nothing here calls a model.

/**
 * How one answer's score stands, by its latest attempt. `values` are in the rubric's order, one per
 * dimension, and there is no field for anything that combines them (04 §6).
 */
export type RowScoring =
  | { readonly state: "ok"; readonly values: readonly (number | null)[] }
  /** Spent its retries: History creates a new attempt, then runs it (07 §5.11). */
  | { readonly state: "failed" }
  /** Never finished: History runs this same attempt (07 §5.10). */
  | { readonly state: "pending"; readonly attemptId: string }
  /** A realistic round still in progress shows no score, flag or hint (US-8). */
  | { readonly state: "withheld" }
  | { readonly state: "not_submitted" };

export type HistoryRow =
  | {
      readonly kind: "answer";
      /** What was asked: a bank question, or its follow-up. */
      readonly asked: "question" | "follow_up";
      /** A practice "answer again": a row of its own, beside the answer it retries (04 `answers`). */
      readonly retry: boolean;
      readonly answerId: string;
      readonly position: number;
      readonly prompt: string;
      readonly durationMs: number | null;
      readonly pace: number | null;
      readonly rewrite: number | null;
      /** Never discarded in favour of the correction: both travel (PRD §9). */
      readonly raw: string | null;
      readonly corrected: string | null;
      readonly scoring: RowScoring;
    }
  /** The hole a failed generation left: a `follow_ups` row whose status is `missing` (04). */
  | { readonly kind: "follow_up_missing"; readonly position: number }
  /** A follow-up that was asked and never answered: the round was left on it. */
  | { readonly kind: "follow_up_unanswered"; readonly position: number; readonly prompt: string }
  /**
   * A position the round never reached. **It carries no question text**: only an answer makes a
   * question seen (04 `round_questions`), and showing it here would make it seen without one.
   */
  | { readonly kind: "question_unanswered"; readonly position: number };

export interface HistoryDetail {
  readonly round: {
    readonly id: string;
    readonly roundType: RoundType;
    readonly language: RoundLanguage;
    readonly mode: RoundMode;
    readonly length: number;
    readonly startedAt: string;
    readonly status: HistoryStatus;
  };
  readonly roleContext: {
    readonly kind: "posting" | "researched" | "general";
    readonly companyName: string | null;
    readonly roleTitle: string | null;
  };
  readonly feltPressure: number | null;
  /** The rubric version's dimensions, in its order; named in the language the feedback is read in (PRD §4). */
  readonly dimensions: readonly { readonly key: string; readonly labels: Record<RoundLanguage, string> }[];
  readonly rows: readonly HistoryRow[];
  /** Every stamp the round's scores carry (refusal #5), from the attempts that produced them. */
  readonly stamps: {
    readonly rubricLabel: string;
    readonly cvLabel: string;
    readonly generatorVersions: readonly string[];
    readonly scoringModels: readonly string[];
  };
  /** The round has stored feedback, read on screen 8. */
  readonly hasFeedback: boolean;
  /** A Japanese round whose feedback was stored with its English translation: 10 §10's pill. */
  readonly translated: boolean;
}

export async function historyDetail(db: Db, round: RoundRow, now: Date): Promise<HistoryDetail> {
  const [answers, followUps, [cv], [rubricRow], [context], [feedback], newer] = await Promise.all([
    roundAnswers(db, round.id),
    roundFollowUps(db, round.id),
    db.select({ label: s.cvVersions.versionLabel }).from(s.cvVersions).where(eq(s.cvVersions.id, round.cvVersionId)),
    db.select().from(s.rubricVersions).where(eq(s.rubricVersions.id, round.rubricVersionId)),
    db
      .select({ kind: s.roleContexts.kind, companyName: s.roleContexts.companyName, roleTitle: s.roleContexts.roleTitle })
      .from(s.roleContexts)
      .where(eq(s.roleContexts.id, round.roleContextId)),
    db
      .select({ translated: s.roundFeedback.bodyTranslated })
      .from(s.roundFeedback)
      .where(eq(s.roundFeedback.roundId, round.id)),
    newerRoundExists(db, round),
  ]);
  const status = roundStatus(round, { newerRoundExists: newer, now });
  // US-8: nothing a score would say leaves the server while a realistic round is still being answered.
  const withheld = round.mode === "realistic" && status === "in_progress";
  const dimensions = rubricRow.dimensions as Rubric["dimensions"];

  const submitted = answers.filter((answer) => answer.transcriptCorrected !== null);
  const attempts = withheld ? new Map<string, AttemptRow>() : await latestAttempts(db, submitted.map((answer) => answer.id));
  const okIds = [...attempts.values()].filter((attempt) => attempt.status === "ok").map((attempt) => attempt.id);
  const scoreRows =
    okIds.length === 0
      ? []
      : await db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, okIds)).orderBy(asc(s.scores.dimension));

  function scoringOf(answer: AnswerRow): RowScoring {
    if (answer.transcriptCorrected === null) return { state: "not_submitted" };
    if (withheld) return { state: "withheld" };
    const attempt = attempts.get(answer.id);
    // A submitted answer always has an attempt: `submit` writes both in one transaction (07 §5.9).
    if (!attempt || attempt.status === "failed") return { state: "failed" };
    if (attempt.status === "pending") return { state: "pending", attemptId: attempt.id };
    return {
      state: "ok",
      values: dimensions.map(
        (dimension) => scoreRows.find((row) => row.scoringAttemptId === attempt.id && row.dimension === dimension.key)?.value ?? null,
      ),
    };
  }

  function answerRow(answer: AnswerRow, retry: boolean): HistoryRow {
    return {
      kind: "answer",
      asked: answer.questionId === null ? "follow_up" : "question",
      retry,
      answerId: answer.id,
      position: answer.position,
      prompt: answer.promptText,
      durationMs: answer.audioDurationMs,
      pace: answer.wordsPerMinute,
      rewrite: answer.rewriteMagnitude === null ? null : rewritePercent(answer.rewriteMagnitude),
      raw: answer.transcriptRaw,
      corrected: answer.transcriptCorrected,
      scoring: scoringOf(answer),
    };
  }

  /** An answer, then every "answer again" made of it, in the order they were made. */
  function withRetries(original: AnswerRow): HistoryRow[] {
    return [answerRow(original, false), ...answers.filter((row) => row.retryOfAnswerId === original.id).map((row) => answerRow(row, true))];
  }

  // A position is its bank question, then that answer's one follow-up, which shares it (04 `answers`).
  const originals = answers.filter((answer) => answer.retryOfAnswerId === null);
  const rows: HistoryRow[] = [];
  for (let position = 1; position <= round.length; position += 1) {
    const question = originals.find((answer) => answer.questionId !== null && answer.position === position);
    if (!question) {
      rows.push({ kind: "question_unanswered", position });
      continue;
    }
    rows.push(...withRetries(question));
    const followUp = followUps.find((row) => row.parentAnswerId === question.id);
    if (!followUp) continue;
    if (followUp.status === "missing" || followUp.promptText === null) {
      rows.push({ kind: "follow_up_missing", position });
      continue;
    }
    const answer = originals.find((candidate) => candidate.parentAnswerId === question.id);
    if (answer) rows.push(...withRetries(answer));
    else rows.push({ kind: "follow_up_unanswered", position, prompt: followUp.promptText });
  }

  const displayed = [...attempts.values()];
  const distinct = (values: readonly string[]) => [...new Set(values)].sort();
  return {
    round: {
      id: round.id,
      roundType: round.roundType,
      language: round.language,
      mode: round.mode,
      length: round.length,
      startedAt: round.startedAt.toISOString(),
      status,
    },
    roleContext: context,
    feltPressure: round.feltPressure,
    dimensions: dimensions.map((dimension) => ({ key: dimension.key, labels: { ja: dimension.label_ja, en: dimension.label_en } })),
    rows,
    stamps: {
      rubricLabel: rubricRow.versionLabel,
      cvLabel: cv.label,
      generatorVersions: distinct(displayed.map((attempt) => attempt.generatorPromptVersion)),
      scoringModels: distinct(displayed.map((attempt) => attempt.modelId)),
    },
    hasFeedback: feedback !== undefined,
    translated: round.language === "ja" && feedback?.translated != null,
  };
}
