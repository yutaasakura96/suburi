import { ROUND_COPY } from "../../round/copy";
import { HISTORY_COPY } from "../copy";

// The study view's chrome (10 §16). An app-level screen, so it is written in English (10 §0), in the
// words screen 8 and History already use for the same things. Data keeps its own language: a
// Japanese round's questions, answers, model answers, findings and its 応募書類 stamp are shown as
// stored.

const feedback = ROUND_COPY.en;

export const STUDY_COPY = {
  title: "Study — Suburi",
  heading: "Study",
  purpose: "Every question you answered, with what you said, its available model answer and what to fix. Newest first.",
  /** The way back to History's rail; the way here is the rail's own link (`HISTORY_COPY.study`). */
  rounds: "Rounds in History",

  empty: "No answered question yet. A question appears here after you submit an answer.",
  start: HISTORY_COPY.start,

  roundType: HISTORY_COPY.roundType,
  meta: HISTORY_COPY.meta,
  date: HISTORY_COPY.date,
  feedbackLink: HISTORY_COPY.feedbackLink,
  historyLink: "Scores and recordings",
  roundName: (roundType: Parameters<typeof HISTORY_COPY.roundType>[0], startedAt: string) =>
    `${HISTORY_COPY.roundType(roundType)}, ${HISTORY_COPY.date(startedAt)}`,

  question: feedback.questionOf,
  followUp: HISTORY_COPY.followUp,
  followUpMissing: HISTORY_COPY.followUpMissing,
  ownAnswer: feedback.ownAnswer,
  modelAnswer: feedback.modelAnswer,
  followUpOwnAnswer: feedback.followUpOwnAnswer,
  followUpModelAnswer: feedback.followUpModelAnswer,
  /** A practice answer given again: beside the first, never in place of it. Numbered from the second, as screen 8's pager is. */
  answeredAgain: (n: number) => (n > 1 ? `Answered again ${n}` : "Answered again"),
  modelAnswerMarked: feedback.modelAnswerMarked,
  modelAnswerUnmarked: feedback.modelAnswerUnmarked,
  modelAnswerNotWritten: "No model answer is available for this question.",

  toFix: feedback.toFix,
  noFindings: "No fixes are available for this round.",

  pages: "Pages",
  newest: "Newest rounds",
  older: HISTORY_COPY.older,

  footer: [
    "Answered questions from completed and unfinished rounds appear here. Unanswered questions stay in History.",
    "A model answer is not a score, and nothing here compares it with what you said.",
  ],
} as const;
