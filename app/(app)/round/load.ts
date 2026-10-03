import { and, desc, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import type { FeedbackItem } from "@/lib/ai/round-feedback";
import type { Db } from "@/lib/round/http";
import { rewritePercent } from "@/lib/round/measures";
import { loadBankCounts } from "@/lib/round/select-questions";
import { latestAttempts, newerRoundExists, noScores, promptAt, roundAnswers, roundStep, scoringCounts, type RoundRow } from "@/lib/round/state";
import { roundStatus } from "@/lib/round/status";
import type { Rubric } from "@/lib/rubric/types";
import { tokyoDate } from "../cv/load";
import type { RoundLanguage, RoundType } from "./copy";

// What the round screens read (10 §2–§8). Server-only; only what a screen shows leaves it.

/** A saved posting as the picker names it (10 §2). Its text stays on the server. */
export interface PostingOption {
  readonly id: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly sourceFilename: string | null;
  readonly date: string;
}

/**
 * Screen 2's facts: what an English round would be scored against, if it can be; every saved
 * posting, newest first; and the bank's counts per round type, which the bank-exhausted warning reads.
 */
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
  const postings = await db
    .select({
      id: s.roleContexts.id,
      companyName: s.roleContexts.companyName,
      roleTitle: s.roleContexts.roleTitle,
      sourceFilename: s.roleContexts.sourceFilename,
      createdAt: s.roleContexts.createdAt,
    })
    .from(s.roleContexts)
    .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "posting")))
    .orderBy(desc(s.roleContexts.createdAt), desc(s.roleContexts.id));
  return {
    cv: cv ? { label: cv.label, date: tokyoDate(cv.createdAt) } : null,
    rubricLabel: rubric?.label ?? null,
    postings: postings.map(
      (posting): PostingOption => ({
        id: posting.id,
        companyName: posting.companyName ?? "",
        roleTitle: posting.roleTitle ?? "",
        sourceFilename: posting.sourceFilename,
        date: tokyoDate(posting.createdAt),
      }),
    ),
    bank: await loadBankCounts(db, { userId, language }),
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
  /**
   * Where the round is when the page loads. A reload lands on the same question (`round_questions`),
   * and on the transcript when the take was already transcribed.
   */
  readonly start:
    | {
        readonly kind: "question";
        readonly position: number;
        readonly text: string;
        readonly transcript: {
          readonly answerId: string;
          readonly raw: string;
          readonly durationMs: number | null;
          readonly wpm: number | null;
        } | null;
      }
    | { readonly kind: "pressure" }
    /** `answered` is how many questions were submitted before the round was abandoned, for the header. */
    | { readonly kind: "abandoned"; readonly answered: number };
}

/** `null` for another user's round, or no round: the page is a 404. `"complete"` sends it to feedback. */
export async function roundFrame(db: Db, userId: string, round: RoundRow): Promise<RoundFrame | "complete"> {
  const answers = await roundAnswers(db, round.id);
  const step = roundStep(round, answers);
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
  };
  // Abandoned is derived (04 `rounds`): a newer round started, or this one was not started today.
  const status = roundStatus(round, { newerRoundExists: await newerRoundExists(db, round), now: new Date() });
  if (status === "abandoned") {
    return { ...frame, start: { kind: "abandoned", answered: step.kind === "answer" ? step.position - 1 : round.length } };
  }
  if (step.kind !== "answer") return { ...frame, start: { kind: "pressure" } };

  const prompt = await promptAt(db, round.id, step.position);
  const open = step.answer;
  return {
    ...frame,
    start: {
      kind: "question",
      position: step.position,
      text: prompt?.text ?? "",
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
  const [{ cvLabel, rubric }, answers, [findings]] = await Promise.all([
    stampLabels(db, round),
    roundAnswers(db, round.id),
    db.select().from(s.roundFeedback).where(eq(s.roundFeedback.roundId, round.id)),
  ]);
  const submitted = answers.filter((answer) => answer.transcriptCorrected !== null && answer.questionId !== null);
  const attempts = await latestAttempts(db, submitted.map((answer) => answer.id));
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
    // 05 §5.9: every stamp the round's scores carry, joined by a middle dot.
    stamps: [`Rubric ${rubric.versionLabel}`, ...generatorVersions.map((row) => row.version).sort(), cvLabel].join(" · "),
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
      };
    }),
    findings: findings ? { toFix: findings.toFix as FeedbackItem[], whatWorked: findings.whatWorked } : null,
    findingsUnavailable: !findings && noScores(scoringCounts(attempts.values())),
  };
}
