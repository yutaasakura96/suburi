import { type ErrorCode } from "../api/errors";

/**
 * The user-visible sentence for every 07 §3 error code, in both languages.
 *
 * `lib/api/errors.ts` holds the codes and statuses and no user-visible string; this file holds the
 * strings and no status. Two reasons, both from 07 §2: `message` in the envelope is English for the
 * developer and a server string can never be the Japanese one (03 §8), and routing every user-facing
 * string through here means the API does not decide the still-open bilingual chrome rule by accident.
 *
 * **Flat strings, no interpolation.** `rate_limited` and `invalid_request` render with a value
 * beside them — the wait from `Retry-After`, the field marks from `detail` — and the screen renders
 * it, rather than this catalogue splicing it in. That keeps 03 §8's never-log list unreachable from
 * copy: there is no slot for a value to arrive in.
 *
 * **Register**, following the strings already in 10: plain です/ます, one or two short sentences,
 * says what happened and what is still true. 03 §8 — "this app has one user, and that user can
 * read" — so no generic sentence where a specific one exists, and no apology where a fact will do.
 */
export interface ErrorCopy {
  readonly ja: string;
  readonly en: string;
}

const CATALOGUE = {
  unauthenticated: {
    ja: "ログインしていないか、セッションの期限が切れています。",
    en: "You are not signed in, or the session has expired.",
  },
  invalid_request: {
    ja: "入力に誤りがあります。印のついた項目を直してください。",
    en: "Some fields are not valid. Correct the ones marked.",
  },
  not_found: {
    ja: "そのデータは見つかりませんでした。",
    en: "That record was not found.",
  },
  rate_limited: {
    ja: "続けて実行しすぎです。少し待ってからもう一度お試しください。",
    en: "Too many requests in a row. Wait a moment and try again.",
  },
  model_unavailable: {
    ja: "採点モデルに接続できません。復旧するまでラウンドは開始できません。",
    en: "The scoring model is unreachable. A round cannot start until it recovers.",
  },
  question_generation_failed: {
    ja: "質問を生成できませんでした。もう一度お試しください。",
    en: "The question could not be generated. Try again.",
  },
  presign_failed: {
    ja: "録音のアップロード先を用意できませんでした。もう一度お試しください。",
    en: "The upload destination for the recording could not be prepared. Try again.",
  },
  upload_too_large: {
    ja: "音声が大きすぎてアップロードできません。4分以内の録音にしてください。",
    en: "The audio is too large to upload. Keep the recording to four minutes or less.",
  },
  unsupported_content_type: {
    ja: "この音声形式には対応していません。",
    en: "That audio format is not supported.",
  },
  audio_missing: {
    ja: "録音が見つかりません。",
    en: "The recording could not be found.",
  },
  transcription_failed: {
    ja: "文字起こしに失敗しました。録音は残っています。もう一度試すか、回答を入力してください。",
    en: "Transcription failed. The take is kept — retry it, or type your answer instead.",
  },
  transcript_already_final: {
    ja: "この回答の文字起こしは確定済みです。",
    en: "The transcript for this answer is already final.",
  },
  answer_already_submitted: {
    ja: "この回答は提出済みです。",
    en: "This answer has already been submitted.",
  },
  followup_generation_failed: {
    ja: "深掘りの質問を生成できませんでした。回答は保存されています。",
    en: "The follow-up question could not be generated. Your answer is saved.",
  },
  scoring_failed: {
    ja: "採点に失敗しました。回答は保存されています。あとから採点をやり直せます。",
    en: "Scoring failed. Your answer is saved, and it can be scored again later.",
  },
  scoring_not_retryable: {
    ja: "この採点はやり直せません。",
    en: "This score cannot be retried.",
  },
  pressure_not_applicable: {
    ja: "練習ラウンドでは緊張度を記録しません。",
    en: "Felt pressure is not recorded in practice mode.",
  },
  pressure_required: {
    ja: "緊張度を選んでから先へ進んでください。",
    en: "Choose a felt-pressure rating before going on.",
  },
  round_already_complete: {
    ja: "このラウンドは終了しています。",
    en: "This round is already complete.",
  },
  round_not_complete: {
    ja: "まだ回答していない質問があります。",
    en: "This round still has unanswered questions.",
  },
  cv_unchanged: {
    ja: "応募書類に変更がありません。新しいバージョンは作成しませんでした。",
    en: "Nothing in the CV has changed. No new version was created.",
  },
  cv_extraction_failed: {
    ja: "応募書類の読み取りに失敗しました。もう一度お試しください。",
    en: "The CV could not be read. Try again.",
  },
  upstream_s3: {
    ja: "S3との通信に失敗しました。",
    en: "Communication with S3 failed.",
  },
  upstream_openai: {
    ja: "OpenAIとの通信に失敗しました。",
    en: "Communication with OpenAI failed.",
  },
} satisfies Record<string, ErrorCopy>;

/**
 * Typed against `ErrorCode`, so a code added to 07 §3 without copy fails `tsc` here. The reverse
 * direction — a copy key that is not a code — is not a type error, and is what `11` §3.10's test
 * catches at runtime.
 */
export const ERROR_COPY: Record<ErrorCode, ErrorCopy> = CATALOGUE;
