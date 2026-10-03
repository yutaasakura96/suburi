import { and, desc, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import type { FeedbackItem } from "@/lib/ai/round-feedback";
import type { Db } from "@/lib/round/http";
import { rewritePercent } from "@/lib/round/measures";
import {
  latestAttempts,
  newerRoundExists,
  noScores,
  promptAt,
  questionsSubmitted,
  roundAnswers,
  roundFollowUps,
  roundStep,
  scoringCounts,
  type RoundRow,
} from "@/lib/round/state";
import { roundStatus } from "@/lib/round/status";
import type { Rubric } from "@/lib/rubric/types";
import { tokyoDate } from "../cv/load";
import type { RoundLanguage, RoundType } from "./copy";

// What the round screens read (10 §2–§8). Server-only; only what a screen shows leaves it.

/** Screen 2's facts: what an English round would be scored against, if it can be. */
export async function setupFacts(db: Db, userId: string, language: RoundLanguage) {
  const [cv] = await db
    .select({ label: s.cvVersions.versionLabel, createdAt: s.cvVersions.createdAt })
    .from(s.cvVersions)
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)))
    .orderBy(desc(s.cvVersions.createdAt))
    .limit(1);
  const [rubric] = await db
    .select({ label: s.rubricVersions.versionLabel })
    .from(s.rubricVersions)
    .where(eq(s.rubricVersions.language, language))
    .orderBy(desc(s.rubricVersions.createdAt))
    .limit(1);
  return {
    cv: cv ? { label: cv.label, date: tokyoDate(cv.createdAt) } : null,
    rubricLabel: rubric?.label ?? null,
  };
}

async function stampLabels(db: Db, round: RoundRow) {
  const [[cv], [rubric]] = await Promise.all([
    db.select({ label: s.cvVersions.versionLabel }).from(s.cvVersions).where(eq(s.cvVersions.id, round.cvVersionId)),
    db
      .select({ label: s.rubricVersions.versionLabel, language: s.rubricVersions.language, dimensions: s.rubricVersions.dimensions })
      .from(s.rubricVersions)
      .where(eq(s.rubricVersions.id, round.rubricVersionId)),
  ]);
  return { cvLabel: cv.label, rubric: { versionLabel: rubric.label, language: rubric.language, dimensions: rubric.dimensions } as Rubric };
}

export interface RoundFrame {
  readonly round: {
    readonly id: string;
    readonly roundType: RoundType;
    readonly language: RoundLanguage;
    readonly length: number;
    readonly capSeconds: number;
  };
  readonly cvLabel: string;
  readonly rubricLabel: string;
  /** Each position's generator prompt version, for the stamp — the versions only, never a later question. */
  readonly generatorVersions: readonly string[];
  /** The prompt version of each follow-up the round has generated so far, for the round's stamp. */
  readonly followUpVersions: readonly string[];
  /**
   * Where the round is when the page loads. A reload lands on the same prompt — the question fixed in
   * `round_questions`, or the follow-up stored in `follow_ups`, never one generated again — and on
   * the transcript when the take was already transcribed.
   */
  readonly start:
    | {
        readonly kind: "question";
        readonly position: number;
        readonly text: string;
        /** Set when the prompt is a follow-up: its prompt version, the stamp its answer will carry. */
        readonly followUpVersion: string | null;
        readonly transcript: {
          readonly answerId: string;
          readonly raw: string;
          readonly durationMs: number | null;
          readonly wpm: number | null;
        } | null;
      }
    /**
     * The answer at this position is submitted and its follow-up is not stored yet: the page loaded
     * between the two. `submit`, sent again with the same text, is what writes it (07 §5.9), so the
     * stored correction goes back to its owner for that one call.
     */
    | {
        readonly kind: "follow_up_due";
        readonly position: number;
        readonly text: string;
        readonly answerId: string;
        readonly corrected: string;
      }
    | { readonly kind: "pressure" }
    /** `answered` is how many questions were submitted before the round was abandoned, for the header. */
    | { readonly kind: "abandoned"; readonly answered: number };
}

/** `null` for another user's round, or no round: the page is a 404. `"complete"` sends it to feedback. */
export async function roundFrame(db: Db, userId: string, round: RoundRow): Promise<RoundFrame | "complete"> {
  const [answers, followUps] = await Promise.all([roundAnswers(db, round.id), roundFollowUps(db, round.id)]);
  const step = roundStep(round, answers, followUps);
  if (step.kind === "complete") return "complete";
  const [{ cvLabel, rubric }, versions] = await Promise.all([
    stampLabels(db, round),
    db
      .select({ version: s.questions.generatorPromptVersion })
      .from(s.roundQuestions)
      .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
      .where(eq(s.roundQuestions.roundId, round.id))
      .orderBy(s.roundQuestions.position),
  ]);
  const frame = {
    round: {
      id: round.id,
      roundType: round.roundType as RoundType,
      language: round.language as RoundLanguage,
      length: round.length,
      capSeconds: round.perAnswerCapSeconds,
    },
    cvLabel,
    rubricLabel: rubric.versionLabel,
    generatorVersions: versions.map((row) => row.version),
    followUpVersions: [...new Set(followUps.filter((row) => row.status === "generated").map((row) => row.promptVersion))],
  };
  // Abandoned is derived (04 `rounds`): a newer round started, or this one was not started today.
  const status = roundStatus(round, { newerRoundExists: await newerRoundExists(db, round), now: new Date() });
  if (status === "abandoned") {
    return { ...frame, start: { kind: "abandoned", answered: questionsSubmitted(round, step) } };
  }
  if (step.kind === "follow_up_due") {
    const { parent } = step;
    return {
      ...frame,
      start: {
        kind: "follow_up_due",
        position: step.position,
        text: parent.promptText,
        answerId: parent.id,
        corrected: parent.transcriptCorrected ?? "",
      },
    };
  }
  if (step.kind !== "answer") return { ...frame, start: { kind: "pressure" } };

  const open = step.answer;
  return {
    ...frame,
    start: {
      kind: "question",
      position: step.position,
      text: step.followUp ? step.followUp.row.promptText : ((await promptAt(db, round.id, step.position))?.text ?? ""),
      followUpVersion: step.followUp?.row.promptVersion ?? null,
      transcript:
        open?.transcriptRaw != null
          ? { answerId: open.id, raw: open.transcriptRaw, durationMs: open.audioDurationMs, wpm: open.wordsPerMinute }
          : null,
    },
  };
}

export interface FeedbackAnswerView {
  readonly position: number;
  readonly prompt: string;
  readonly durationMs: number | null;
  readonly wpm: number | null;
  readonly rewrite: number | null;
  /** `ok` has a value per dimension; `failed` reads as not scored; `pending` as not scored yet. */
  readonly status: "ok" | "pending" | "failed";
  readonly scores: readonly { readonly label: string; readonly value: number | null }[];
  /**
   * The answer's one follow-up (10 §8): asked, with how its own answer's scoring stands — its scores
   * are History's, not this screen's — or **missing**, the hole a failed generation left. Null for an
   * answer with no `follow_ups` row: a round from before follow-ups existed.
   */
  readonly followUp:
    | { readonly kind: "asked"; readonly text: string; readonly status: "ok" | "pending" | "failed" }
    | { readonly kind: "missing" }
    | null;
}

export interface FeedbackScreen {
  readonly round: { readonly id: string; readonly roundType: RoundType; readonly length: number; readonly date: string };
  readonly feltPressure: number | null;
  readonly stamps: string;
  readonly answers: readonly FeedbackAnswerView[];
  readonly findings: { readonly toFix: readonly FeedbackItem[]; readonly whatWorked: string } | null;
  /** No answer scored and none is pending: `feedback` refuses as `no_scores`, so no retry is offered (07 §5.12). */
  readonly findingsUnavailable: boolean;
}

/** Screen 8, from stored rows only: nothing here calls a model or waits (10 §8). */
export async function feedbackScreen(db: Db, round: RoundRow): Promise<FeedbackScreen> {
  const [{ cvLabel, rubric }, answers, followUps, [findings]] = await Promise.all([
    stampLabels(db, round),
    roundAnswers(db, round.id),
    roundFollowUps(db, round.id),
    db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, round.id)),
  ]);
  const answered = answers.filter((answer) => answer.transcriptCorrected !== null);
  // The pager is one bank question per position; its follow-up hangs off it as a row.
  const submitted = answered.filter((answer) => answer.questionId !== null);
  // Every submitted answer's attempt, follow-ups' included: the same set `complete` reads (07 §5.12).
  const attempts = await latestAttempts(db, answered.map((answer) => answer.id));
  const followUpOf = (answerId: string): FeedbackAnswerView["followUp"] => {
    const row = followUps.find((followUp) => followUp.parentAnswerId === answerId);
    if (!row) return null;
    if (row.status === "missing" || row.promptText === null) return { kind: "missing" };
    const own = answered.find((answer) => answer.parentAnswerId === answerId);
    return { kind: "asked", text: row.promptText, status: (own && attempts.get(own.id)?.status) ?? "pending" };
  };
  const okIds = [...attempts.values()].filter((attempt) => attempt.status === "ok").map((attempt) => attempt.id);
  const scoreRows = okIds.length === 0 ? [] : await db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, okIds));
  const generatorVersions = submitted.length
    ? await db
        .selectDistinct({ version: s.questions.generatorPromptVersion })
        .from(s.questions)
        .where(inArray(s.questions.id, submitted.map((answer) => answer.questionId!)))
    : [];

  return {
    round: { id: round.id, roundType: round.roundType as RoundType, length: round.length, date: tokyoDate(round.startedAt) },
    feltPressure: round.feltPressure,
    // 05 §5.9: every stamp the round's scores carry, joined by a middle dot. A follow-up's answer
    // carries the follow-up prompt's version as its stamp 3 (04).
    stamps: [
      `Rubric ${rubric.versionLabel}`,
      ...[
        ...new Set([
          ...generatorVersions.map((row) => row.version),
          ...followUps.filter((row) => answered.some((answer) => answer.parentAnswerId === row.parentAnswerId)).map((row) => row.promptVersion),
        ]),
      ].sort(),
      cvLabel,
    ].join(" · "),
    answers: submitted.map((answer) => {
      const attempt = attempts.get(answer.id);
      const status = attempt?.status ?? "pending";
      return {
        position: answer.position,
        prompt: answer.promptText,
        durationMs: answer.audioDurationMs,
        wpm: answer.wordsPerMinute,
        rewrite: answer.rewriteMagnitude === null ? null : rewritePercent(answer.rewriteMagnitude),
        status,
        scores: rubric.dimensions.map((dimension) => ({
          label: dimension.label_en,
          value:
            status === "ok"
              ? (scoreRows.find((row) => row.scoringAttemptId === attempt!.id && row.dimension === dimension.key)?.value ?? null)
              : null,
        })),
        followUp: followUpOf(answer.id),
      };
    }),
    findings: findings ? { toFix: findings.toFix as FeedbackItem[], whatWorked: findings.whatWorked } : null,
    findingsUnavailable: !findings && noScores(scoringCounts(attempts.values())),
  };
}
