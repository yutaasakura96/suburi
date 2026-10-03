// The round screens' chrome (10 §0): Setup is app-level and English; the in-round screens (§3–§8)
// are in the round's language, Japanese throughout a Japanese round and English throughout an English
// one. Every Japanese string here is in docs/checklists/native-read-round.md (05 §6).

export type RoundType = "behavioural" | "technical" | "hr" | "ceo";
export type RoundLanguage = "ja" | "en";

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
  realistic: "Realistic",
  realisticExplained: "Realistic — one take. Up to 4 minutes per answer. The feedback comes together after the round.",
  roleContext: "Role context",
  general: "General practice",
  generalDetail: "Counted separately in progress",
  scoredAgainst: "Scored against",
  start: "Start this round",
  starting: "Fixing the questions for this round.",
  commits: "Starting fixes the questions and scores every answer against this CV version and rubric.",
  // 10 §2: derived, never written — length × (1 + follow-ups) × the per-answer cap. No follow-up yet (#44).
  estimate: (length: number, capMinutes: number) =>
    `${length} questions · up to about ${length * capMinutes} min`,
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

const en = {
  /** The browser tab, while the round runs and on its feedback. */
  title: "Round — Suburi",
  feedbackTitle: "Round feedback — Suburi",
  roundTypes: ROUND_TYPE_NAMES,
  meta: (length: number) => `English · Realistic · ${length} questions`,
  step: (position: number, of: number) => `Question ${position} / ${of}`,
  // 05 §5.9: the round's stamps, joined.
  rubricStamp: (label: string) => `Rubric ${label}`,
  stamps: (parts: readonly string[]) => parts.join(" · "),

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
  unreachable: "The request did not reach the server, or its answer did not come back. Try again.",

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
  sendCaption: "Sending scores this answer while you go on. Nothing about it is shown until the round ends.",
  sending: "Sending.",
  emptyAnswer: "The answer is empty. Keep what you said, corrected.",
  takeSummary: (durationMs: number, pace: number) => `${clock(durationMs)} · ~${Math.round(pace)} wpm`,

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
  toFix: (n: number) => `To fix ${n}`,
  whatWorked: "What worked 1",
  findingsNotReady:
    "The findings for this round are not ready. The round is complete, its rating is recorded, and every score above is kept.",
  findingsUnavailable:
    "No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded.",
  retryFindings: "Write the findings",
  retryingFindings: "Writing the findings.",
  pressureRecorded: (value: number) => `Pressure ${value} recorded before the feedback`,
};

export type RoundCopy = typeof en;

// 10 §3–§8 quotes most of these; the rest were written for #43. The artboards' Latin section labels
// are Japanese here (10 §0), and a list inside Japanese text is joined by nakaguro, unspaced (05 §6).
const ja: RoundCopy = {
  title: "ラウンド — Suburi",
  feedbackTitle: "講評 — Suburi",
  roundTypes: { behavioural: "行動面接", technical: "技術面接", hr: "HR", ceo: "CEO・最終" },
  meta: (length) => `日本語・実戦・${length}問`,
  step: (position, of) => `第${position}問 / ${of}問`,
  rubricStamp: (label) => `評価基準 ${label}`,
  stamps: (parts) => parts.join("・"),

  withheld: "講評はラウンドが終わってからまとめて出ます。途中では何も出ません。",
  goesOn: "この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。",

  startRecording: "録音を開始",
  cap: (seconds) => `最長 ${Math.round(seconds / 60)}分`,
  oneTake: "一発勝負です。録り直しはできません。",
  correctAfter: "止めたあとに文字起こしを直せます。",

  recording: "録音中",
  stop: "停止して文字起こし",
  autoStop: (seconds) => `${Math.round(seconds / 60)}分で自動的に止まります。そこまでの録音は残ります。`,
  transcribing: "録音をアップロードして、文字起こしをしています。",
  micUnavailable: "マイクを使えません。何も録音されておらず、この質問は未回答のままです。",
  recordingFailed: "録音に失敗しました。何も録音されておらず、この質問は未回答のままです。",
  uploadFailed: "録音をアップロードできませんでした。録音はこのタブに残っています。もう一度お試しください。",
  tryAgain: "もう一度試す",
  unreachable: "サーバーに届かなかったか、応答が戻りませんでした。もう一度お試しください。",

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
  sendCaption: "送ると、先へ進む間にこの回答を採点します。結果はラウンドが終わるまで出ません。",
  sending: "送っています。",
  emptyAnswer: "回答が空です。話した内容を、直した形で残してください。",
  takeSummary: (durationMs, pace) => `${clock(durationMs)}・約${Math.round(pace)}字/分`,

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
  willRecord: (value) => `緊張度 ${value} をこのラウンドに記録します。`,
  toFeedback: "講評に進む",
  completing: "緊張度を記録して、講評をまとめています。",

  abandoned: "新しいラウンドが始まったため、このラウンドは中断されました。記録はそのまま残ります。",
  home: "ホームへ",

  questionOf: (position, of) => `第${position}問 / ${of}問`,
  question: (position) => `第${position}問`,
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
  toFix: (n) => `直すところ ${n}件`,
  whatWorked: "良かったところ 1件",
  findingsNotReady:
    "このラウンドの講評はまだできていません。ラウンドは終了し、緊張度は記録され、上の採点はすべて残っています。",
  findingsUnavailable:
    "このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了し、緊張度は記録されています。",
  retryFindings: "講評をまとめる",
  retryingFindings: "講評をまとめています。",
  pressureRecorded: (value) => `緊張度 ${value} を講評前に記録`,
};

export const ROUND_COPY: Record<RoundLanguage, RoundCopy> = { en, ja };

/**
 * 10 §8's pill, on a Japanese round's feedback only: each side names the language it switches the
 * feedback to, in that language. An English round's feedback is English and has no pill (PRD §4).
 */
export const FEEDBACK_READING: Record<RoundLanguage, string> = { ja: "日本語", en: "English" };
