import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import type { FeedbackItem, TranslatedFeedback } from "@/lib/ai/round-feedback";
import { underlineSegments } from "@/lib/cv/segments";
import { characterLength, sliceQuote, type Span } from "@/lib/cv/spans";
import { feedbackAnswers } from "@/lib/round/complete";
import type { Db } from "@/lib/round/http";
import { rewritePercent } from "@/lib/round/measures";
import type { TranslatedModelAnswer } from "@/lib/round/model-answers";
import { scoringReads, type ScoringRead } from "@/lib/round/read-round";
import { loadBankCounts } from "@/lib/round/select-questions";
import {
  latestAttempts,
  newerRoundExists,
  noScores,
  openRetry,
  promptAt,
  questionsSubmitted,
  roundAnswers,
  roundFollowUps,
  roundStep,
  scoringCounts,
  type AnswerRow,
  type RoundRow,
} from "@/lib/round/state";
import { roundStatus } from "@/lib/round/status";
import type { Rubric } from "@/lib/rubric/types";
import { tokyoDate } from "../cv/load";
import type { RoundLanguage, RoundMode, RoundType } from "./copy";

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
 * Screen 2's facts: what a round in this language would be scored against, if it can be, and the
 * language's bank counts per round type, which the bank-exhausted warning reads.
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
  return {
    cv: cv ? { label: cv.label, date: tokyoDate(cv.createdAt) } : null,
    rubricLabel: rubric?.label ?? null,
    bank: await loadBankCounts(db, { userId, language }),
  };
}

/** Every saved posting, newest first (10 §2). A posting is the user's, not a language's. */
export async function savedPostings(db: Db, userId: string): Promise<PostingOption[]> {
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
  return postings.map((posting) => ({
    id: posting.id,
    companyName: posting.companyName ?? "",
    roleTitle: posting.roleTitle ?? "",
    sourceFilename: posting.sourceFilename,
    date: tokyoDate(posting.createdAt),
  }));
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

/**
 * A submitted answer as practice's per-answer frame shows it (10 §15): what was asked, the answer's
 * figures, and its scoring as the round's read carries it (07 §5.5) — the frame polls that read while
 * the score is pending, so the page and the poll hand it one shape.
 */
export interface AnsweredView {
  readonly answerId: string;
  readonly position: number;
  readonly text: string;
  /** Set when the answer is to a follow-up: the stamp it carries, and what the header's step names. */
  readonly followUpVersion: string | null;
  /** True for an answer given again: a row beside the first, at the same position. */
  readonly again: boolean;
  /** The corrected text, back to its owner: its flags are spans into it, and a repeated `submit` sends it. */
  readonly corrected: string;
  readonly durationMs: number | null;
  readonly wpm: number | null;
  readonly rewrite: number | null;
  readonly scoring: ScoringRead;
}

/** What the per-answer frame leads to: where the round stands, from stored rows. */
export type NextView =
  | { readonly kind: "follow_up"; readonly position: number; readonly text: string; readonly promptVersion: string }
  | { readonly kind: "question"; readonly position: number; readonly text: string }
  | { readonly kind: "feedback" }
  /** The follow-up is not stored yet: `submit`, sent again with the same text, writes it (07 §5.9). */
  | { readonly kind: "follow_up_due" };

export interface RoundFrame {
  readonly round: {
    readonly id: string;
    readonly roundType: RoundType;
    readonly language: RoundLanguage;
    readonly mode: RoundMode;
    readonly length: number;
    readonly capSeconds: number;
  };
  readonly cvLabel: string;
  readonly rubricLabel: string;
  /** The rubric's dimensions in its own order, named in the round's language: the per-answer frame's rows. */
  readonly dimensions: readonly { readonly key: string; readonly label: string }[];
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
        /** Set when the prompt is being answered again (practice): the answer the new one stands beside. */
        readonly again: string | null;
        readonly transcript: {
          readonly answerId: string;
          readonly raw: string;
          readonly durationMs: number | null;
          readonly wpm: number | null;
        } | null;
        /**
         * The slot is open and its take is not transcribed: the page loaded between the two. The round
         * resumes at `transcribe` (07 §5.5) — or at the upload, when the take never reached S3.
         */
        readonly openAnswerId: string | null;
        readonly uploadConfirmed: boolean;
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
    /** Practice's per-answer frame, for the answer sent last (10 §15). */
    | { readonly kind: "answered"; readonly answer: AnsweredView; readonly next: NextView }
    | { readonly kind: "pressure" }
    /**
     * `answered` is how many questions were submitted before the round was abandoned, for the header;
     * `byDay` when no newer round did it — the Asia/Tokyo day it started on ended (06, 2026-09-28).
     */
    | { readonly kind: "abandoned"; readonly answered: number; readonly byDay: boolean };
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
      mode: round.mode,
      length: round.length,
      capSeconds: round.perAnswerCapSeconds,
    },
    cvLabel,
    rubricLabel: rubric.versionLabel,
    dimensions: rubric.dimensions.map((dimension) => ({
      key: dimension.key as string,
      label: round.language === "ja" ? dimension.label_ja : dimension.label_en,
    })),
    generatorVersions: versions.map((row) => row.version),
    followUpVersions: [...new Set(followUps.filter((row) => row.status === "generated").map((row) => row.promptVersion))],
  };
  // Abandoned is derived (04 `rounds`): a newer round started, or this one was not started today.
  const newer = await newerRoundExists(db, round);
  const status = roundStatus(round, { newerRoundExists: newer, now: new Date() });
  if (status === "abandoned") {
    return { ...frame, start: { kind: "abandoned", answered: questionsSubmitted(round, step), byDay: !newer } };
  }
  // The stamp a follow-up's answer carries: the version of the `follow_ups` row it answers.
  const followUpVersionOf = (answer: AnswerRow) =>
    followUps.find((row) => row.parentAnswerId === answer.parentAnswerId)?.promptVersion ?? null;
  const transcriptOf = (answer: AnswerRow | null) =>
    answer?.transcriptRaw != null
      ? { answerId: answer.id, raw: answer.transcriptRaw, durationMs: answer.audioDurationMs, wpm: answer.wordsPerMinute }
      : null;

  if (round.mode === "practice") {
    // 10 §15's resume order: an open answer-again, then the open answer to the current prompt, then
    // the per-answer frame of the answer sent last.
    const again = openRetry(answers);
    if (again) {
      return {
        ...frame,
        start: {
          kind: "question",
          position: again.position,
          text: again.promptText,
          followUpVersion: followUpVersionOf(again),
          again: again.retryOfAnswerId,
          transcript: transcriptOf(again),
        },
      };
    }
    const last = answers
      .filter((answer) => answer.transcriptCorrected !== null)
      .reduce<AnswerRow | null>((newest, answer) => (newest === null || answer.createdAt > newest.createdAt ? answer : newest), null);
    if (last && !(step.kind === "answer" && step.answer)) {
      const next: NextView =
        step.kind === "follow_up_due"
          ? { kind: "follow_up_due" }
          : step.kind !== "answer"
            ? { kind: "feedback" }
            : step.followUp
              ? { kind: "follow_up", position: step.position, text: step.followUp.row.promptText, promptVersion: step.followUp.row.promptVersion }
              : { kind: "question", position: step.position, text: (await promptAt(db, round.id, step.position))?.text ?? "" };
      const scoring = (await scoringReads(db, round, [last], { scores: true })).get(last.id);
      if (!scoring) throw new Error("a submitted answer with no scoring attempt");
      return {
        ...frame,
        start: {
          kind: "answered",
          answer: {
            answerId: last.id,
            position: last.position,
            text: last.promptText,
            followUpVersion: followUpVersionOf(last),
            again: last.retryOfAnswerId !== null,
            corrected: last.transcriptCorrected ?? "",
            durationMs: last.audioDurationMs,
            wpm: last.wordsPerMinute,
            rewrite: last.rewriteMagnitude === null ? null : rewritePercent(last.rewriteMagnitude),
            scoring,
          },
          next,
        },
      };
    }
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
      openAnswerId: open && open.transcriptRaw === null ? open.id : null,
      uploadConfirmed: open?.audioUploadedAt !== null && open?.audioUploadedAt !== undefined,
    },
  };
}

/** A run of a model answer: its text, and whether the round's CV version backs it (04 `model_answers`). */
export interface ModelAnswerSegment {
  readonly text: string;
  readonly unsupported: boolean;
}

/**
 * One stored model answer (10 §8), as runs **sliced from the stored body by its stored spans**. A
 * Japanese round's carries the same answer in English, stored with it, for the pill.
 */
export interface ModelAnswerView {
  readonly segments: readonly ModelAnswerSegment[];
  readonly translated: readonly ModelAnswerSegment[] | null;
}

function modelAnswerSegments(body: string, spans: readonly Span[]): ModelAnswerSegment[] {
  return underlineSegments(body, { start: 0, end: characterLength(body) }, spans).map((segment) => ({
    text: segment.text,
    unsupported: segment.claim,
  }));
}

export interface FeedbackAnswerView {
  readonly position: number;
  readonly followUpAnswer: boolean;
  /** 0 for the first answer to the question; n for the nth answer given again (practice, 10 §15). */
  readonly again: number;
  readonly prompt: string;
  /** What the user said: the corrected transcript, as it was scored. */
  readonly own: string;
  /** Null when none is stored: a call that failed or has not landed yet, or a round from before model answers existed. */
  readonly modelAnswer: ModelAnswerView | null;
  readonly durationMs: number | null;
  readonly wpm: number | null;
  readonly rewrite: number | null;
  /** `ok` has a value per dimension; `failed` reads as not scored; `pending` as not scored yet. */
  readonly status: "ok" | "pending" | "failed";
  /** A dimension is named in the language the feedback is read in (PRD §4), so both names travel. */
  readonly scores: readonly { readonly key: string; readonly labels: Record<RoundLanguage, string>; readonly value: number | null }[];
  /** The language the scorer read the answer in, when it is not the round's (PRD §7); otherwise null. */
  readonly answeredIn: "ja" | "en" | null;
  /**
   * The answer's one follow-up (10 §8): asked, with how its own answer's scoring stands — its scores
   * are History's, not this screen's — or **missing**, the hole a failed generation left. Null for an
   * answer with no `follow_ups` row: a round from before follow-ups existed.
   */
  readonly followUp:
    | {
        readonly kind: "asked";
        readonly text: string;
        readonly status: "ok" | "pending" | "failed";
        /** The follow-up's own answer and its model answer, as the question's are above. */
        readonly own: string | null;
        readonly modelAnswer: ModelAnswerView | null;
      }
    | { readonly kind: "missing" }
    | null;
}

/**
 * 10 §8's `Checked against your CV` region. Every quote is **sliced from stored text by span**: an
 * unsupported one from the answer's corrected text (04 `answer_flags`), an unused one from the CV
 * version's body (04 `cv_claims`). No model's wording reaches this screen as a quote.
 */
export interface GroundingView {
  readonly cvLabel: string;
  /** In answer order, then by where the span sits in the answer. */
  readonly unsupported: readonly { readonly position: number; readonly quote: string }[];
  readonly untouched: readonly string[];
}

export interface FeedbackFindings {
  readonly toFix: readonly FeedbackItem[];
  readonly whatWorked: string;
}

export interface FeedbackScreen {
  readonly round: {
    readonly id: string;
    readonly roundType: RoundType;
    readonly mode: RoundMode;
    readonly language: RoundLanguage;
    readonly length: number;
    readonly date: string;
  };
  readonly feltPressure: number | null;
  /** 05 §5.9: every stamp the round's scores carry — the screen joins them in the round's language. */
  readonly stamps: { readonly rubricLabel: string; readonly generatorVersions: readonly string[]; readonly cvLabel: string };
  readonly answers: readonly FeedbackAnswerView[];
  readonly findings: FeedbackFindings | null;
  /** A Japanese round's findings in English, stored with them (04 `body_translated`): 10 §8's toggle. */
  readonly translated: FeedbackFindings | null;
  /** Null when no answer of the round went through the CV check: a round scored before it existed. */
  readonly grounding: GroundingView | null;
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
  // The pager is one bank question per position, its follow-up hanging off it as a row — and, in a
  // practice round, a page for each time that question was answered again, straight after it.
  const submitted = answered.filter((answer) => answer.questionId !== null || answer.retryOfAnswerId !== null);
  const againOf = (answer: AnswerRow) =>
    answer.retryOfAnswerId === null
      ? 0
      : submitted.filter((other) => other.retryOfAnswerId === answer.retryOfAnswerId).indexOf(answer) + 1;
  // Every submitted answer's attempt, follow-ups' included: the same set `complete` reads (07 §5.12).
  const [attempts, modelAnswerRows] = await Promise.all([
    latestAttempts(db, answered.map((answer) => answer.id)),
    answered.length === 0
      ? []
      : db.select().from(s.modelAnswers).where(inArray(s.modelAnswers.answerId, answered.map((answer) => answer.id))),
  ]);
  const modelAnswerOf = (answerId: string): ModelAnswerView | null => {
    const row = modelAnswerRows.find((candidate) => candidate.answerId === answerId);
    if (!row) return null;
    const translated = row.bodyTranslated as TranslatedModelAnswer | null;
    return {
      segments: modelAnswerSegments(row.body, row.unsupportedSpans),
      translated: translated ? modelAnswerSegments(translated.body, translated.unsupported_spans) : null,
    };
  };
  const followUpOf = (answerId: string): FeedbackAnswerView["followUp"] => {
    const row = followUps.find((followUp) => followUp.parentAnswerId === answerId);
    if (!row) return null;
    if (row.status === "missing" || row.promptText === null) return { kind: "missing" };
    const own = answered.find((answer) => answer.parentAnswerId === answerId && answer.retryOfAnswerId === null);
    return {
      kind: "asked",
      text: row.promptText,
      status: (own && attempts.get(own.id)?.status) ?? "pending",
      own: own?.transcriptCorrected ?? null,
      modelAnswer: own ? modelAnswerOf(own.id) : null,
    };
  };
  const okIds = [...attempts.values()].filter((attempt) => attempt.status === "ok").map((attempt) => attempt.id);
  const scoreRows = okIds.length === 0 ? [] : await db.select().from(s.scores).where(inArray(s.scores.scoringAttemptId, okIds));
  // The round-level regions read what the feedback call read: the answers given again only when no
  // other answer scored (07 §5.12).
  const roundLevelAnswers = feedbackAnswers(answered, attempts);
  const roundLevel = roundLevelAnswers.flatMap((answer) => attempts.get(answer.id) ?? []);
  // An attempt that went through the CV check says which language it read (04 `scoring_attempts`).
  const grounded = roundLevel.some((attempt) => attempt.status === "ok" && attempt.answeredLanguage !== null);
  const untouchedIds = findings?.untouchedClaimIds ?? [];
  const [flagRows, untouchedClaims] = await Promise.all([
    grounded
      ? db
          .select()
          .from(s.answerFlags)
          .where(inArray(s.answerFlags.scoringAttemptId, okIds))
          .orderBy(asc(s.answerFlags.spanStart))
      : [],
    untouchedIds.length === 0
      ? []
      : db
          .select({ id: s.cvClaims.id, start: s.cvClaims.spanStart, end: s.cvClaims.spanEnd, body: s.cvVersions.body })
          .from(s.cvClaims)
          .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.cvClaims.cvVersionId))
          .where(and(inArray(s.cvClaims.id, untouchedIds), eq(s.cvClaims.cvVersionId, round.cvVersionId))),
  ]);
  const bankAnswers = submitted.filter((answer) => answer.questionId !== null);
  const generatorVersions = bankAnswers.length
    ? await db
        .selectDistinct({ version: s.questions.generatorPromptVersion })
        .from(s.questions)
        .where(inArray(s.questions.id, bankAnswers.map((answer) => answer.questionId!)))
    : [];

  const translated = (findings?.bodyTranslated ?? null) as TranslatedFeedback | null;

  return {
    round: {
      id: round.id,
      roundType: round.roundType as RoundType,
      mode: round.mode,
      language: round.language as RoundLanguage,
      length: round.length,
      date: tokyoDate(round.startedAt),
    },
    feltPressure: round.feltPressure,
    // 05 §5.9: every stamp the round's scores carry. A follow-up's answer carries the follow-up
    // prompt's version as its stamp 3 (04).
    stamps: {
      rubricLabel: rubric.versionLabel,
      generatorVersions: [
        ...new Set([
          ...generatorVersions.map((row) => row.version),
          ...followUps.filter((row) => answered.some((answer) => answer.parentAnswerId === row.parentAnswerId)).map((row) => row.promptVersion),
        ]),
      ].sort(),
      cvLabel,
    },
    answers: submitted.map((answer) => {
      const attempt = attempts.get(answer.id);
      const status = attempt?.status ?? "pending";
      return {
        position: answer.position,
        followUpAnswer: answer.questionId === null,
        again: againOf(answer),
        prompt: answer.promptText,
        own: answer.transcriptCorrected ?? "",
        // An answer given again is the same question, and reads the model answer its original has.
        modelAnswer: modelAnswerOf(answer.retryOfAnswerId ?? answer.id),
        durationMs: answer.audioDurationMs,
        wpm: answer.wordsPerMinute,
        rewrite: answer.rewriteMagnitude === null ? null : rewritePercent(answer.rewriteMagnitude),
        status,
        scores: rubric.dimensions.map((dimension) => ({
          key: dimension.key,
          labels: { ja: dimension.label_ja, en: dimension.label_en },
          value:
            status === "ok"
              ? (scoreRows.find((row) => row.scoringAttemptId === attempt!.id && row.dimension === dimension.key)?.value ?? null)
              : null,
        })),
        answeredIn:
          status === "ok" && attempt!.answeredLanguage !== null && attempt!.answeredLanguage !== round.language
            ? attempt!.answeredLanguage
            : null,
        followUp: followUpOf(answer.id),
      };
    }),
    findings: findings ? { toFix: findings.toFix as FeedbackItem[], whatWorked: findings.whatWorked } : null,
    translated: translated ? { toFix: translated.to_fix, whatWorked: translated.what_worked } : null,
    grounding: grounded
      ? {
          cvLabel,
          unsupported: roundLevelAnswers.filter((answer) => answer.questionId !== null || answer.retryOfAnswerId !== null).flatMap((answer) =>
            flagRows
              .filter((flag) => flag.scoringAttemptId === attempts.get(answer.id)?.id)
              .map((flag) => ({
                position: answer.position,
                quote: sliceQuote(answer.transcriptCorrected ?? "", { start: flag.spanStart, end: flag.spanEnd }),
              })),
          ),
          // In the order the feedback call picked them.
          untouched: untouchedIds.flatMap((id) => {
            const claim = untouchedClaims.find((row) => row.id === id);
            return claim ? [sliceQuote(claim.body, claim)] : [];
          }),
        }
      : null,
    findingsUnavailable: !findings && noScores(scoringCounts(roundLevel)),
  };
}
