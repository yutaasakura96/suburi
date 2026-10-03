// The round screens' chrome (10 §0): Setup is app-level and English; the in-round screens (§3–§8)
// are in the round's language. Only English exists until the Japanese round (#43) adds `ja`, and
// with it the native read every Japanese string needs (05 §6).

export type RoundType = "behavioural" | "technical" | "hr" | "ceo";
export type RoundLanguage = "en";

/** Data, not chrome: a round type is named in English on the app-level screens (10 §0). */
export const ROUND_TYPE_NAMES: Record<RoundType, string> = {
  behavioural: "Behavioural",
  technical: "Technical",
  hr: "HR",
  ceo: "CEO / final",
};

export const ROUND_TYPES: readonly RoundType[] = ["behavioural", "technical", "hr", "ceo"];
export const ROUND_LENGTHS = [3, 5, 7] as const;

/** `m:ss`, the record screens' clock (10 §4). */
export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Words, as the server counts them for pace (lib/round/measures.ts). */
export function wordCount(text: string) {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

const grouped = new Intl.NumberFormat("en-US");

export const SETUP_COPY = {
  heading: "Start a round",
  roundType: "Round type",
  language: "Language",
  english: "English",
  englishOnly: "English rounds only, until Japanese rounds are built.",
  length: "Length",
  lengthOption: (n: number) => `${n} questions`,
  mode: "Mode",
  realistic: "Realistic",
  realisticExplained: "Realistic — one take. Up to 4 minutes per answer. The feedback comes together after the round.",
  roleContext: "Role context",
  roleContextRequired: "Required. The two are equal.",
  posting: "Posting",
  postingNone: "Pitch the round at a role you are applying for",
  postingPasted: "Pasted text",
  general: "General practice",
  generalDetail: "Counted separately in progress",
  savedPostings: "Saved postings",
  addPosting: "Add a posting",
  company: "Company",
  roleTitle: "Role title",
  postingText: "Posting text",
  importFile: "Import from a file",
  imported: "Check the imported text and fix anything wrong. What you save is what the questions are written from.",
  importNoText: "No text could be read from this file. A scanned file has none — paste the text instead.",
  importUnreadable: "This file could not be opened. It may be damaged or password-protected — paste the text instead.",
  postingCount: (chars: number, max: number) => `${grouped.format(chars)} / ${grouped.format(max)} characters`,
  savePosting: "Save this posting",
  savePostingCommits: "Saving fixes this posting as it is. It cannot be edited afterwards — a changed posting is saved as a new one.",
  savingPosting: "Saving the posting.",
  cancel: "Cancel",
  chooseRoleContext: "Choose a role context to start.",
  // 10 §2, PRD §6: said before the round starts, from counts the page already holds.
  bankExhausted: (typeName: string, unseen: number, length: number) =>
    `${unseen === 0 ? "There are no unseen" : unseen === 1 ? "There is 1 unseen" : `There are ${unseen} unseen`} ${typeName} ${
      unseen === 1 ? "question" : "questions"
    } in English, and this round asks ${length}. The rest are written when it starts, which can take up to half a minute. If a new question turns out to match one you have already answered, it is asked as a repeat: scored, but not counted in progress.`,
  startingGenerating: "Writing new questions for this round. This can take up to half a minute.",
  scoredAgainst: "Scored against",
  start: "Start this round",
  starting: "Fixing the questions for this round.",
  commits: "Starting fixes the questions and scores every answer against this CV version and rubric.",
  // 10 §2: derived, never written — length × (1 + follow-ups) × the per-answer cap. No follow-up yet (#44).
  estimate: (length: number, capMinutes: number) =>
    `${length} questions · up to about ${length * capMinutes} min`,
  rubricStamp: (label: string) => `Rubric ${label}`,
  noCv: "An English round is scored against an English CV, and there is none yet.",
  noCvLink: "Save one on the CV screen",
  noRubric: "No English rubric is seeded yet, so nothing could score this round.",
} as const;

export interface PressureOption {
  readonly value: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
}

export const ROUND_COPY = {
  en: {
    languageName: "English",
    realistic: "Realistic",
    meta: (length: number) => `English · Realistic · ${length} questions`,
    step: (position: number, of: number) => `Question ${position} / ${of}`,

    // 10 §3–§5, the footer every record frame carries but the transcript one.
    withheld: "The feedback comes together when the round ends. Nothing is shown along the way.",
    goesOn:
      "The round goes on. You can correct the full text on the next screen. Neither the audio nor the uncorrected transcript is ever discarded.",

    startRecording: "Start recording",
    cap: (seconds: number) => `Up to ${Math.round(seconds / 60)} min`,
    oneTake: "One take. There is no re-recording.",
    correctAfter: "You can correct the transcript once you stop.",

    recording: "Recording",
    stop: "Stop and transcribe",
    autoStop: (seconds: number) =>
      `Stops by itself at ${Math.round(seconds / 60)} minutes. What was recorded up to then is kept.`,
    transcribing: "Uploading the take and transcribing it.",
    micUnavailable: "The microphone is not available. Nothing was recorded, and the question stays unseen.",
    recordingFailed: "The recording failed. Nothing was recorded, and the question stays unseen.",
    uploadFailed: "The take could not be uploaded. It is still in this tab; try again.",
    tryAgain: "Try again",

    rawTranscript: "Raw transcript — uncorrected",
    takeFigures: (durationMs: number, wpm: number, words: number) =>
      `${clock(durationMs)} · ~${Math.round(wpm)} wpm · ${words} words`,
    correct: "Correct the transcript",
    correctCaption: "Correct it to what you said, then send. The amount rewritten is recorded but never scored.",

    yourAnswer: "Your answer — edit freely",
    wordsChange: (from: number, to: number) => `${from} words → ${to} words`,
    rawKept: "Raw — kept, never replaced",
    rewrite: "Rewrite",
    rewriteOf: "of the characters changed from the uncorrected transcript",
    rewriteNotes: [
      "Recorded only. It does not tell a misrecognition from a restart.",
      "Not used in scoring or in progress. Kept to review recognition accuracy later.",
    ],
    send: "Send this answer",
    sendCaption: "Sending scores this answer while you go on. Nothing about it is shown until the round ends.",
    sending: "Sending.",
    emptyAnswer: "The answer is empty. Keep what you said, corrected.",

    beforeFeedback: "Before the feedback",
    pressureQuestion: "How tense did this round feel?",
    pressureAsk: "Pick the closest one. Asked once, before the feedback.",
    pressureOptions: [
      { value: 1, label: "Not tense at all" },
      { value: 2, label: "A little aware of it" },
      { value: 3, label: "Fairly tense" },
      { value: 4, label: "Very tense" },
      { value: 5, label: "My mind went blank" },
    ] as readonly PressureOption[],
    whatThisIsNot: "What this is not",
    pressureNotes: [
      "Not a score. The number you pick does not change the feedback.",
      "Not on the progress charts. Nothing to raise or lower.",
      "Asked once per round, not per answer.",
    ],
    pickOne: "Pick one to go on to the feedback.",
    willRecord: (value: number) => `Records pressure ${value} for this round.`,
    toFeedback: "Go to the feedback",
    completing: "Recording the rating and writing the feedback.",

    abandoned: "This round was left when a newer one started. It stays as it is.",
    home: "Home",

    // 10 §8
    questionOf: (position: number, of: number) => `Question ${position} / ${of}`,
    question: (position: number) => `Question ${position}`,
    answerFigures: (durationMs: number | null, wpm: number | null, rewrite: number | null) =>
      [
        durationMs === null ? null : `${Math.floor(durationMs / 60_000)} min ${Math.floor((durationMs % 60_000) / 1000)} s`,
        wpm === null ? null : `~${Math.round(wpm)} wpm`,
        rewrite === null ? null : `rewrite ${rewrite}%`,
      ]
        .filter((part) => part !== null)
        .join(" · "),
    notScored: "Not scored",
    notScoredYet: "Not scored yet",
    toFix: (n: number) => `To fix ${n}`,
    whatWorked: "What worked 1",
    findingsNotReady:
      "The findings for this round are not ready. The round is complete, its rating is recorded, and every score above is kept.",
    findingsUnavailable:
      "No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded.",
    retryFindings: "Write the findings",
    retryingFindings: "Writing the findings.",
    pressureRecorded: (value: number) => `Pressure ${value} recorded before the feedback`,
    rubricStamp: (label: string) => `Rubric ${label}`,
  },
} as const;

export type RoundCopy = (typeof ROUND_COPY)["en"];
