import { tokyoDate } from "../../../lib/monitor/week";
import { clock, LANGUAGE_NAMES, ROUND_TYPE_NAMES, type RoundLanguage, type RoundType } from "../round/copy";

// History's chrome (10 §10). An app-level screen, so it is written in English, one fixed app language
// (10 §0): the artboard's Japanese strings are layout, and each is replaced here. Data keeps its own
// language — a Japanese round's questions, its 応募書類 stamp and its dimension names are shown as
// stored.

export type RoundMode = "practice" | "realistic";
/** `in_progress`, `abandoned` or `complete`: derived, never stored (04 `rounds`). */
export type HistoryStatus = "in_progress" | "abandoned" | "complete";

const MODE_NAMES: Record<RoundMode, string> = { realistic: "Realistic", practice: "Practice" };

/**
 * The rail's status line (10 §10), or null for a complete round with every score in. One line per
 * entry: an open round says which kind of open it is, and only a complete round says it is unscored —
 * its unscored answers are retried from its own rows either way.
 */
export function statusLine(round: {
  readonly status: HistoryStatus;
  readonly scoring: { readonly pending: number; readonly failed: number };
}): { readonly kind: "resume" | "abandoned" | "unscored"; readonly text: string } | null {
  if (round.status === "in_progress") return { kind: "resume", text: HISTORY_COPY.inProgress };
  if (round.status === "abandoned") return { kind: "abandoned", text: HISTORY_COPY.abandoned };
  if (round.scoring.pending + round.scoring.failed > 0) return { kind: "unscored", text: HISTORY_COPY.unscored };
  return null;
}

export const HISTORY_COPY = {
  title: "History — Suburi",
  rounds: "Rounds",
  roundType: (roundType: RoundType) => ROUND_TYPE_NAMES[roundType],
  meta: (language: RoundLanguage, mode: RoundMode, length: number) =>
    `${LANGUAGE_NAMES[language]} · ${MODE_NAMES[mode]} · ${length} questions`,
  /** The day a round started, in Asia/Tokyo: the user's local day (06, 2026-09-28). */
  date: (startedAt: string | Date) => tokyoDate(new Date(startedAt)),

  // The two status lines 10 §10 designs in, and the open round History offers to resume.
  unscored: "Unscored — retry scoring",
  abandoned: "Abandoned — not counted in progress",
  inProgress: "In progress — resume",
  resume: "Resume this round",

  older: "Older rounds",
  loadingOlder: "Loading older rounds.",
  empty: "No rounds yet. A round is listed here from the moment it starts.",
  start: "Start a round",

  readOnly: "Read-only",
  feedbackLink: "Round feedback",
  roleContext: (kind: "posting" | "researched" | "general", companyName: string | null, roleTitle: string | null) => {
    if (kind === "general") return "General practice";
    const named = [companyName, roleTitle].filter((part) => part !== null && part !== "").join(", ");
    const label = kind === "posting" ? "Posting" : "Researched";
    return named === "" ? label : `${label}: ${named}`;
  },
  pressure: (value: number) => `Pressure ${value} recorded before the feedback`,

  time: "Time",
  question: (position: number) => `Q${position}`,
  followUp: "└ Follow-up",
  answeredAgain: "└ Answered again",
  followUpMissing: "The follow-up was not generated. It is recorded as a gap.",
  notAnswered: "Not answered",
  notSubmitted: "Not submitted",
  notScored: "Not scored",
  notScoredYet: "Not scored yet",
  withheld: "Scores are held until the round ends.",
  retryScoring: "Retry scoring",
  retryScoringFor: (name: string) => `Retry scoring for ${name}`,
  scoringNow: "Scoring this answer.",
  duration: (durationMs: number | null) => (durationMs === null ? "—" : clock(durationMs)),

  /** A row, named for a control that has no visible text. */
  rowName: (position: number, asked: "question" | "follow_up", retry: boolean) =>
    `${asked === "follow_up" ? `the follow-up to Q${position}` : `Q${position}`}${retry ? ", answered again" : ""}`,
  open: (label: string) => `Open the recording and transcript for ${label}`,
  close: (label: string) => `Close the recording and transcript for ${label}`,
  recording: "Recording",
  openingAudio: "Opening the recording.",
  audioUnplayable: "The recording could not be played.",
  rawTranscript: "Raw transcript — uncorrected",
  corrected: "Corrected answer",
  noTranscript: "None was stored.",
  // The pace is in the language's own unit (04 `answers`): words a minute in English, characters in Japanese.
  figures: (language: RoundLanguage, pace: number | null, rewrite: number | null) =>
    [
      pace === null ? null : `~${Math.round(pace)} ${language === "ja" ? "characters/min" : "wpm"}`,
      rewrite === null ? null : `rewrite ${rewrite}%`,
    ]
      .filter((part) => part !== null)
      .join(" · "),

  footer: [
    "Follow-ups are not counted in progress. Only each answer's 1–5 on each dimension is kept.",
    "The audio and the uncorrected transcript open from each row.",
  ],
  rubricStamp: (label: string) => `Rubric ${label}`,
} as const;
