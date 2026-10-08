// The round screens' chrome (10 §0): Setup is app-level and English; the in-round screens (§3–§8)
// are in the round's language, Japanese throughout a Japanese round and English throughout an English
// one. Every Japanese string here is in docs/checklists/native-read-round.md (05 §6).

import type { DueDefaults } from "../../../lib/progress/due";

export type RoundType = "behavioural" | "technical" | "hr" | "ceo";
export type RoundLanguage = "ja" | "en";
export type RoundMode = "realistic" | "practice";

/** Data, not chrome: a round type is named in English on the app-level screens (10 §0). */
export const ROUND_TYPE_NAMES: Record<RoundType, string> = {
  behavioural: "Behavioural",
  technical: "Technical",
  hr: "HR",
  ceo: "CEO / final",
};

export const ROUND_TYPES: readonly RoundType[] = ["behavioural", "technical", "hr", "ceo"];
export const ROUND_LANGUAGES: readonly RoundLanguage[] = ["ja", "en"];
export const ROUND_LENGTHS = [3, 5, 7] as const;

/** `m:ss`, the record screens' clock (10 §4). */
export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A duration as whole minutes and seconds, for screen 8's figures (10 §8). */
function minutesAndSeconds(durationMs: number) {
  return { minutes: Math.floor(durationMs / 60_000), seconds: Math.floor((durationMs % 60_000) / 1000) };
}

const grouped = new Intl.NumberFormat("en-US");
function present(parts: readonly (string | null)[]) {
  return parts.filter((part) => part !== null);
}

/** A language as Setup names it (10 §0: app-level, English). */
export const LANGUAGE_NAMES: Record<RoundLanguage, string> = { ja: "Japanese", en: "English" };

export const SETUP_COPY = {
  heading: "Start a round",
  roundType: "Round type",
  language: "Language",
  length: "Length",
  lengthOption: (n: number) => `${n} questions`,
  mode: "Mode",
  modes: { realistic: "Realistic", practice: "Practice" } as Record<RoundMode, string>,
  // 10 §2: both modes explained at once, the chosen one in the darker ink.
  modesExplained: {
    realistic: "Realistic — one take. Up to 4 minutes per answer. The feedback comes together after the round.",
    practice: "Practice — re-takes, no time limit, each answer's scores once it is scored. Not counted in progress.",
  } as Record<RoundMode, string>,
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
  // A practice round draws on every generated question, seen or not (07 §5.4), so its count is not
  // "unseen", and nothing in it counts in progress for a repeat to be the exception to.
  bankExhausted: (typeName: string, language: RoundLanguage, mode: RoundMode, supply: number, length: number) => {
    const kind = mode === "realistic" ? "unseen " : "";
    const have = supply === 0 ? `There are no ${kind}` : supply === 1 ? `There is 1 ${kind}` : `There are ${supply} ${kind}`;
    const start = `${have}${typeName} ${supply === 1 ? "question" : "questions"} in ${LANGUAGE_NAMES[language]}${
      mode === "practice" ? " to practise on" : ""
    }, and this round asks ${length}. The rest are written when it starts, which can take up to half a minute.`;
    return mode === "practice"
      ? start
      : `${start} If a new question turns out to match one you have already answered, it is asked as a repeat: scored, but not counted in progress.`;
  },
  startingGenerating: "Writing new questions for this round. This can take up to half a minute.",
  // 10 §2's rationale: the interval arithmetic the defaults came from, and nothing beyond it.
  whyDefaults: "Why these defaults",
  defaultsReason: (defaults: Pick<DueDefaults, "roundType" | "language" | "reason">) => {
    const pair = `${ROUND_TYPE_NAMES[defaults.roundType]} in ${LANGUAGE_NAMES[defaults.language]}`;
    const { reason } = defaults;
    if (reason.kind === "nothing") return "No realistic round has been completed yet, so nothing is due. These are the starting defaults.";
    if (reason.kind === "never") return `${pair} has not been practised in a realistic round yet. The defaults come from that.`;
    const when = reason.days === 0 ? "today" : `${reason.days} ${reason.days === 1 ? "day" : "days"} ago`;
    return `${pair} was last practised ${when}, the longest gap of any. The defaults come from that.`;
  },
  defaultsOverridable: "A suggestion. All four can be changed.",
  scoredAgainst: "Scored against",
  start: "Start this round",
  starting: "Fixing the questions for this round.",
  commits: "Starting fixes the questions and scores every answer against this CV version and rubric.",
  // 10 §2: derived, never written — length × (1 + follow-ups) × the per-answer cap, one follow-up
  // per question.
  estimate: (length: number, capMinutes: number) =>
    `${length} questions + ${length} follow-ups · up to about ${length * 2 * capMinutes} min`,
  rubricStamp: (label: string) => `Rubric ${label}`,
  noCv: (language: RoundLanguage) =>
    language === "ja"
      ? "A Japanese round is scored against the Japanese CV, and there is none yet."
      : "An English round is scored against an English CV, and there is none yet.",
  noCvLink: "Save one on the CV screen",
  noRubric: (language: RoundLanguage) =>
    `No ${LANGUAGE_NAMES[language]} rubric is seeded yet, so nothing could score this round.`,
} as const;

export interface PressureOption {
  readonly value: 1 | 2 | 3 | 4 | 5;
  readonly label: string;
}

const EN_MODES: Record<RoundMode, string> = { realistic: "Realistic", practice: "Practice" };
// 05 §6: the mode words are bare, never `練習モード`.
const JA_MODES: Record<RoundMode, string> = { realistic: "実戦", practice: "練習" };

const en = {
  /** The browser tab, while the round runs and on its feedback. */
  title: "Round — Suburi",
  feedbackTitle: "Round feedback — Suburi",
  roundTypes: ROUND_TYPE_NAMES,
  meta: (mode: RoundMode, length: number) => `English · ${EN_MODES[mode]} · ${length} questions`,
  step: (position: number, of: number) => `Question ${position} / ${of}`,
  // A follow-up shares its question's position (06, 2026-09-27): the same step, named as a follow-up.
  followUpStep: (position: number, of: number) => `Question ${position} / ${of} · follow-up`,
  // 10 §15: a prompt answered again keeps its step, and says so.
  stepAgain: (step: string) => `${step} · again`,
  // 05 §5.9: the round's stamps, joined.
  rubricStamp: (label: string) => `Rubric ${label}`,
  stamps: (parts: readonly string[]) => parts.join(" · "),

  // 10 §3–§5, the footer every record frame carries but the transcript one.
  withheld: "The feedback comes together when the round ends. Nothing is shown along the way.",
  goesOn:
    "The round goes on. You can correct the full text on the next screen. Neither the audio nor the uncorrected transcript is ever discarded.",

  // 10 §15: a practice round promises the opposite of `withheld`, on the same footer.
  practiceShown: "Each answer's scores appear once it is scored. The round's feedback comes at the end.",
  // 10 §3, realistic only: the speaker line, and what it becomes when the browser will not play
  // sound unasked (a reload). A failed synthesis shows the catalogue's `speech_failed` instead.
  spoken: "Read aloud. The text stays on screen.",
  playQuestion: "Hear the question",

  startRecording: "Start recording",
  cap: (seconds: number) => `Up to ${Math.round(seconds / 60)} min`,
  oneTake: "One take. There is no re-recording.",
  correctAfter: "You can correct the transcript once you stop.",

  recording: "Recording",
  stop: "Stop and transcribe",
  autoStop: (seconds: number) =>
    `Stops by itself at ${Math.round(seconds / 60)} minutes. What was recorded up to then is kept.`,
  // 10 §3–5, between the take and its transcript: the wait line's sentence for each of the two calls.
  uploadingTake: "Uploading your recording.",
  transcribingTake: "Transcribing your answer.",
  // 05 §5.10: under every wait line.
  keepWaiting: "Please wait. This screen moves on by itself.",
  // 03 §8: a denied microphone gets the browser-level fix, inline.
  micDenied:
    "The microphone is blocked for this site. Allow it from the icon in the address bar, then start recording again. Nothing was recorded, and the question stays unseen.",
  micUnavailable: "The microphone is not available. Nothing was recorded, and the question stays unseen.",
  recordingFailed: "The recording failed. Nothing was recorded, and the question stays unseen.",
  // 03 §5, §8: a take that did not reach S3 is held in the browser, and says where.
  uploadHeld: "The take could not be uploaded. It is held on this device. Do not close this tab.",
  uploadFailed: "The take could not be uploaded. It is still in this tab; try again.",
  // 06, 2026-10-05: a take the slot route refused is said once, with why and what to do instead.
  uploadRefused: {
    upload_too_large: "This recording is too large to be uploaded. Type your answer instead.",
    unsupported_content_type: "This recording is in an audio format that cannot be uploaded. Type your answer instead.",
  },
  // 07 §5.8: the typing fallback, when transcription cannot succeed.
  typeInstead: "Type the answer instead",
  typedAnswer: "Your answer — typed, not spoken",
  typedCaption: (takeKept: boolean) =>
    `A typed answer is recorded as typed. It has no duration and no pace, and it is not counted in progress.${takeKept ? " The take is kept." : ""}`,
  saveTyped: "Save the typed answer",
  savingTyped: "Saving the typed answer.",
  tryAgain: "Try again",
  unreachable: "The request did not reach the server, or its answer did not come back. Try again.",

  // 10 §15, practice's record frames: no clock, and a take that can be recorded again until it is transcribed.
  retakeUntilTranscribed: "You can record again until the take is transcribed.",
  stopRecording: "Stop recording",
  takeHeld: "Take recorded — not transcribed yet",
  transcribeTake: "Transcribe this take",
  transcribeTakeCaption: "Once it is transcribed, the take is final and cannot be recorded again.",
  recordAgain: "Record again",
  recordAgainCaption: "Recording again replaces this take.",

  rawTranscript: "Raw transcript — uncorrected",
  // `units` is the transcript's length as its pace counts it (lib/round/measures.ts): words here.
  takeFigures: (durationMs: number, pace: number, units: number) =>
    `${clock(durationMs)} · ~${Math.round(pace)} wpm · ${units} words`,
  correct: "Correct the transcript",
  correctCaption: "Correct it to what you said, then send. The amount rewritten is recorded but never scored.",

  yourAnswer: "Your answer — edit freely",
  unitsChange: (from: number, to: number) => `${from} words → ${to} words`,
  rawKept: "Raw — kept, never replaced",
  rewrite: "Rewrite",
  rewriteOf: "of the characters changed from the uncorrected transcript",
  rewriteNotes: [
    "Recorded only. It does not tell a misrecognition from a restart.",
    "Not used in scoring or in progress. Kept to review recognition accuracy later.",
  ],
  send: "Send this answer",
  // 10 §6: a question's answer makes one follow-up; a follow-up's own answer makes none.
  sendCaptionFollowUp: "Sending writes one follow-up question from the text you just corrected.",
  sendCaption: "Sending scores this answer while you go on. Nothing about it is shown until the round ends.",
  // 10 §15: practice shows the scores, so its caption cannot promise silence.
  sendCaptionShown: "Sending scores this answer. Its scores appear on the next screen once it is scored.",
  sendingForFollowUp: "Sending. The follow-up question is being written.",
  sending: "Sending.",
  followUpNotStored: "Your answer is saved. Its follow-up question had not been written when this page loaded.",
  goOn: "Go on",
  goOnCaption: "The answer above is saved and scored as it is. It cannot be changed.",
  emptyAnswer: "The answer is empty. Keep what you said, corrected.",
  takeSummary: (durationMs: number, pace: number) => `${clock(durationMs)} · ~${Math.round(pace)} wpm`,

  // 10 §15, practice's per-answer frame.
  next: "Next",
  scoringPending: "This answer is being scored. Its scores appear here once it is scored; you can go on without waiting.",
  scoringFailed: "This answer could not be scored. It is kept as it is.",
  unsupportedHere: (quote: string, cvLabel: string) => `Unsupported — nothing in ${cvLabel} backs “${quote}”.`,
  answerFollowUp: "Answer the follow-up",
  nextQuestion: "Go to the next question",
  finishCaption: "Closes the round and writes its feedback. Practice asks for no pressure rating.",
  answerAgain: "Answer again",
  answerAgainCaption: "A new answer beside this one, scored on its own, with no follow-up. This one stays as it is.",
  backToScores: "Back to the scores",

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
  // 10 §7, while the round closes: before anything is read, while a score is pending, and after.
  completing: "Recording the rating and writing the feedback.",
  scoringAnswers: (done: number, total: number) => `Scoring your answers: ${done} of ${total} done.`,
  scoringFinished: "Scoring is finished. Writing the feedback.",

  abandoned: "This round was left when a newer one started. It stays as it is.",
  abandonedByDay: "This round was not finished on the day it started, so it was left. It stays as it is.",
  home: "Home",

  // 10 §8
  questionOf: (position: number, of: number) => `Question ${position} / ${of}`,
  question: (position: number) => `Question ${position}`,
  // 10 §15: the pager's page for the nth time a question was answered again.
  questionAgain: (position: number, n: number) => `Question ${position} · again${n > 1 ? ` ${n}` : ""}`,
  answers: "Answers",
  answerFigures: (durationMs: number | null, pace: number | null, rewrite: number | null) => {
    const time = durationMs === null ? null : minutesAndSeconds(durationMs);
    return present([
      time === null ? null : `${time.minutes} min ${time.seconds} s`,
      pace === null ? null : `~${Math.round(pace)} wpm`,
      rewrite === null ? null : `rewrite ${rewrite}%`,
    ]).join(" · ");
  },
  notScored: "Not scored",
  notScoredYet: "Not scored yet",
  followUp: "└ Follow-up",
  followUpScored: (dimensions: number) => `Scored on ${dimensions} dimensions. Not counted in progress.`,
  followUpNotScoredYet: "Not scored yet. Not counted in progress.",
  followUpNotScored: "Not scored. Not counted in progress.",
  followUpMissing: "The follow-up was not generated. It is recorded as a gap.",
  toFix: (n: number) => `To fix ${n}`,
  whatWorked: "What worked 1",
  // `rated` is false for a practice round, which records no rating to mention (10 §15).
  findingsNotReady: (rated: boolean): string =>
    rated
      ? "The findings for this round are not ready. The round is complete, its rating is recorded, and every score above is kept."
      : "The findings for this round are not ready. The round is complete, and every score above is kept.",
  findingsUnavailable: (rated: boolean): string =>
    rated
      ? "No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded."
      : "No answer in this round could be scored, so there are no findings for this round. The round is complete.",
  // 10 §8, `Checked against your CV`. Every quote is the stored text, sliced by span.
  grounding: "Checked against your CV",
  unsupported: (position: number, quote: string, cvLabel: string) =>
    `Unsupported (Question ${position}) — nothing in ${cvLabel} backs “${quote}”.`,
  nothingUnsupported: (cvLabel: string) => `Unsupported — nothing flagged against ${cvLabel}.`,
  unused: (quotes: readonly string[]) => `Unused — ${quotes.map((quote) => `“${quote}”`).join(" ")}`,
  nothingUnused: "Unused — nothing picked for this round.",
  wrongLanguage: (answered: RoundLanguage) => `This answer was given in ${LANGUAGE_NAMES[answered]}. It is kept out of your English progress.`,
  retryFindings: "Write the findings",
  retryingFindings: "Writing the findings.",
  // 10 §8, under the pager: what was said, and the model answer stored for it. An underline is a
  // stored span of the stored model answer (04 `model_answers`).
  ownAnswer: "Your answer",
  modelAnswer: "Model answer",
  followUpOwnAnswer: "Your answer to the follow-up",
  followUpModelAnswer: "Model answer to the follow-up",
  modelAnswerMarked: (cvLabel: string) =>
    `Written from ${cvLabel} and what you said. An underline marks what ${cvLabel} does not back.`,
  modelAnswerUnmarked: (cvLabel: string) =>
    `Written from ${cvLabel} and what you said. Nothing in it is underlined as going beyond ${cvLabel}.`,
  modelAnswerNotWritten: "No model answer is written for this question yet.",
  writeModelAnswers: "Write the model answers",
  writingModelAnswers: "Writing the model answers.",
  pressureRecorded: (value: number) => `Pressure ${value} recorded before the feedback`,
};

export type RoundCopy = typeof en;

// 10 §3–§8 quotes most of these; the rest were written for #43. The artboards' Latin section labels
// are Japanese here (10 §0), and a list inside Japanese text is joined by nakaguro, unspaced (05 §6).
const ja: RoundCopy = {
  title: "ラウンド — Suburi",
  feedbackTitle: "講評 — Suburi",
  roundTypes: { behavioural: "行動面接", technical: "技術面接", hr: "人事面接", ceo: "最終面接" },
  meta: (mode, length) => `日本語・${JA_MODES[mode]}・${length}問`,
  step: (position, of) => `第${position}問 / ${of}問`,
  followUpStep: (position, of) => `第${position}問 / ${of}問・深掘り`,
  stepAgain: (step) => `${step}・再回答`,
  rubricStamp: (label) => `評価基準 ${label}`,
  stamps: (parts) => parts.join("・"),

  withheld: "講評はラウンドが終わってからまとめて出ます。途中では何も出ません。",
  goesOn: "この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。",

  practiceShown: "回答ごとの採点は、済みしだい出ます。講評はラウンドの最後にまとめて出ます。",
  spoken: "読み上げました。文字は残します。",
  playQuestion: "質問を聞く",

  startRecording: "録音を開始",
  cap: (seconds) => `最長 ${Math.round(seconds / 60)}分`,
  oneTake: "一発勝負です。録り直しはできません。",
  correctAfter: "止めたあとに文字起こしを直せます。",

  recording: "録音中",
  stop: "停止して文字起こし",
  autoStop: (seconds) => `${Math.round(seconds / 60)}分で自動的に止まります。そこまでの録音は残ります。`,
  uploadingTake: "録音をアップロードしています。",
  transcribingTake: "回答を文字起こししています。",
  keepWaiting: "このままお待ちください。終わると自動で次へ進みます。",
  micDenied:
    "このサイトではマイクがブロックされています。アドレスバーのアイコンからマイクを許可して、もう一度録音を開始してください。何も録音されておらず、この質問は未回答のままです。",
  micUnavailable: "マイクを使えません。何も録音されておらず、この質問は未回答のままです。",
  recordingFailed: "録音に失敗しました。何も録音されておらず、この質問は未回答のままです。",
  uploadHeld: "録音をアップロードできませんでした。録音はこの端末に保存されています。このタブを閉じないでください。",
  uploadFailed: "録音をアップロードできませんでした。録音はこのタブに残っています。もう一度お試しください。",
  uploadRefused: {
    upload_too_large: "この録音はサイズが大きすぎるため、アップロードできません。回答を入力してください。",
    unsupported_content_type: "この録音は対応していない音声形式のため、アップロードできません。回答を入力してください。",
  },
  typeInstead: "回答を入力する",
  typedAnswer: "あなたの回答 — 音声ではなく入力",
  typedCaption: (takeKept) =>
    `入力した回答は、入力したものとして記録します。時間と話す速さは記録せず、進捗にも入れません。${takeKept ? "録音は残ります。" : ""}`,
  saveTyped: "入力した回答を保存する",
  savingTyped: "入力した回答を保存しています。",
  tryAgain: "もう一度試す",
  unreachable: "サーバーに届かなかったか、応答が戻りませんでした。もう一度お試しください。",

  retakeUntilTranscribed: "文字起こしをするまでは、録り直せます。",
  stopRecording: "録音を停止",
  takeHeld: "録音済み — 文字起こし前",
  transcribeTake: "この録音を文字起こしする",
  transcribeTakeCaption: "文字起こしをすると、この録音で確定します。録り直しはできなくなります。",
  recordAgain: "録り直す",
  recordAgainCaption: "録り直すと、いまの録音は置き換わります。",

  rawTranscript: "文字起こし — 未修正",
  takeFigures: (durationMs, pace, units) => `${clock(durationMs)}・約${Math.round(pace)}字/分・${units}字`,
  correct: "文字起こしを直す",
  correctCaption: "言った通りに直してから送ります。書き直しの量は記録しますが、評価には使いません。",

  yourAnswer: "あなたの回答 — 自由に直せます",
  unitsChange: (from, to) => `${from}字 → ${to}字`,
  rawKept: "未修正の文字起こし — 置き換えずに残します",
  rewrite: "書き直し",
  rewriteOf: "の文字が、未修正の文字起こしから変わりました",
  rewriteNotes: [
    "記録するだけです。誤認識と言い直しの区別はしません。",
    "評価にも進捗にも使いません。あとで認識精度を見直すために残します。",
  ],
  send: "この回答を送る",
  sendCaptionFollowUp: "送ると、いま直した文から深掘りが1問つくられます。",
  sendCaption: "送ると、先へ進む間にこの回答を採点します。結果はラウンドが終わるまで出ません。",
  sendCaptionShown: "送ると、この回答を採点します。採点が済むと、次の画面に出ます。",
  sendingForFollowUp: "送っています。深掘りの質問をつくっています。",
  sending: "送っています。",
  followUpNotStored: "回答は保存されています。このページを開いた時点では、深掘りの質問がまだつくられていませんでした。",
  goOn: "先へ進む",
  goOnCaption: "上の回答はこのまま保存され、採点されます。あとから変えることはできません。",
  emptyAnswer: "回答が空です。話した内容を、直した形で残してください。",
  takeSummary: (durationMs, pace) => `${clock(durationMs)}・約${Math.round(pace)}字/分`,

  next: "このあと",
  scoringPending: "この回答を採点しています。済むとここに出ます。待たずに先へ進めます。",
  scoringFailed: "この回答は採点できませんでした。回答はそのまま残っています。",
  unsupportedHere: (quote, cvLabel) => `裏づけなし —「${quote}」に対応する記述が${cvLabel}にない。`,
  answerFollowUp: "深掘りに答える",
  nextQuestion: "次の質問へ進む",
  finishCaption: "ラウンドを終えて、講評をまとめます。練習では緊張度を聞きません。",
  answerAgain: "もう一度答える",
  answerAgainCaption: "新しい回答として、この回答の横に残します。別に採点し、深掘りはつきません。この回答はそのまま残ります。",
  backToScores: "採点に戻る",

  beforeFeedback: "講評の前に",
  pressureQuestion: "いまのラウンド、どのくらい緊張しましたか。",
  pressureAsk: "近いものを1つ選んでください。講評の前に一度だけ聞きます。",
  pressureOptions: [
    { value: 1, label: "まったく緊張しなかった" },
    { value: 2, label: "少し意識した" },
    { value: 3, label: "それなりに緊張した" },
    { value: 4, label: "かなり緊張した" },
    { value: 5, label: "頭が真っ白になった" },
  ],
  whatThisIsNot: "緊張度について",
  pressureNotes: [
    "採点ではありません。選んだ数字で講評は変わりません。",
    "進捗グラフには出ません。上げるものでも下げるものでもありません。",
    "回答ごとではなく、ラウンドごとに1回だけ聞きます。",
  ],
  pickOne: "1つ選ぶと講評に進めます。",
  willRecord: (value) => `緊張度${value}をこのラウンドに記録します。`,
  toFeedback: "講評に進む",
  completing: "緊張度を記録して、講評をまとめています。",
  scoringAnswers: (done, total) => `回答を採点しています。${total}件中${done}件が終わりました。`,
  scoringFinished: "採点が終わりました。講評をまとめています。",

  abandoned: "新しいラウンドが始まったため、このラウンドは中断されました。記録はそのまま残ります。",
  abandonedByDay: "始めた日のうちに終わらなかったため、このラウンドは中断されました。記録はそのまま残ります。",
  home: "ホームへ",

  questionOf: (position, of) => `第${position}問 / ${of}問`,
  question: (position) => `第${position}問`,
  questionAgain: (position, n) => `第${position}問・再回答${n > 1 ? n : ""}`,
  answers: "回答",
  answerFigures: (durationMs, pace, rewrite) => {
    const time = durationMs === null ? null : minutesAndSeconds(durationMs);
    return present([
      time === null ? null : `${time.minutes}分${time.seconds}秒`,
      pace === null ? null : `約${Math.round(pace)}字/分`,
      rewrite === null ? null : `書き直し ${rewrite}%`,
    ]).join("・");
  },
  notScored: "未採点",
  notScoredYet: "採点中",
  followUp: "└ 深掘り",
  followUpScored: (dimensions) => `${dimensions}項目を採点。進捗には入れません。`,
  followUpNotScoredYet: "採点中。進捗には入れません。",
  followUpNotScored: "未採点。進捗には入れません。",
  followUpMissing: "深掘りが生成されませんでした。空欄として記録しています。",
  toFix: (n) => `直すところ ${n}件`,
  whatWorked: "良かったところ 1件",
  findingsNotReady: (rated) =>
    rated
      ? "このラウンドの講評はまだできていません。ラウンドは終了し、緊張度は記録され、上の採点はすべて残っています。"
      : "このラウンドの講評はまだできていません。ラウンドは終了し、上の採点はすべて残っています。",
  findingsUnavailable: (rated) =>
    rated
      ? "このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了し、緊張度は記録されています。"
      : "このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了しています。",
  grounding: "応募書類との照合",
  unsupported: (position, quote, cvLabel) => `裏づけなし（第${position}問）—「${quote}」に対応する記述が${cvLabel}にない。`,
  nothingUnsupported: (cvLabel) => `裏づけなし — ${cvLabel}に照らして該当なし。`,
  unused: (quotes) => `未使用 —${quotes.map((quote) => `「${quote}」`).join("")}`,
  nothingUnused: "未使用 — この回で挙げる記載事項はなし。",
  // A Japanese round's other language is English (PRD §7).
  wrongLanguage: () => "英語での回答です。日本語の進捗には入れません。",
  retryFindings: "講評をまとめる",
  retryingFindings: "講評をまとめています。",
  ownAnswer: "あなたの回答",
  modelAnswer: "模範回答",
  followUpOwnAnswer: "深掘りへの回答",
  followUpModelAnswer: "深掘りへの模範回答",
  modelAnswerMarked: (cvLabel) =>
    `${cvLabel}とあなたの回答をもとに作成しています。下線は、${cvLabel}に裏づけのない内容です。`,
  modelAnswerUnmarked: (cvLabel) =>
    `${cvLabel}とあなたの回答をもとに作成しています。${cvLabel}に裏づけのない内容として下線を付けた箇所はありません。`,
  modelAnswerNotWritten: "この質問の模範回答はまだ作成されていません。",
  writeModelAnswers: "模範回答を作成する",
  writingModelAnswers: "模範回答を作成しています。",
  pressureRecorded: (value) => `緊張度${value}を講評前に記録`,
};

export const ROUND_COPY: Record<RoundLanguage, RoundCopy> = { en, ja };

/**
 * 10 §8's pill, on a Japanese round's feedback only: each side names the language it switches the
 * feedback to, in that language. An English round's feedback is English and has no pill (PRD §4).
 */
export const FEEDBACK_READING: Record<RoundLanguage, string> = { ja: "日本語", en: "English" };
