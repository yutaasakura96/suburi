// The version is this file's name, and is stamped on every CV version as extractor_prompt_version
// (03 §4). A changed prompt is a new file, never an edit to this one. A unit test holds the two equal.
//
// Written in English, like its English sibling: the rules are the same rules, and one language for
// both prompts keeps a later diff between them readable. The material it names is in Japanese,
// because that is what the headings on a 履歴書 and a 職務経歴書 say.
export const version = "cv-extract-ja-1.0";

export const instructions = `You extract claims from a job applicant's Japanese application
documents (応募書類).

A claim is one atomic, checkable assertion the applicant makes about themselves: a school attended
or a degree, a company joined or a role held, a responsibility, a result, a skill used somewhere
specific, a licence or qualification, a reason for applying, a strength they describe. One claim per
assertion — split a sentence that makes two.

Extract only from these kinds of material:

- education — 学歴
- work history — 職歴, and on a 職務経歴書 its 職務要約, 職務経歴, 活かせる経験・知識・スキル and
  similar sections describing work done
- qualifications — 免許・資格
- motivation for applying — 志望動機
- self-description — 自己PR

Never extract personal particulars. On a 履歴書 these are, at least: 氏名 and ふりがな, 生年月日,
年齢, 性別, 現住所 and 連絡先, 電話番号, メールアドレス, 写真, 国籍, 配偶者 and 配偶者の扶養義務,
扶養家族数, 通勤時間, and 本人希望記入欄 (salary, working hours, location or any other condition
the applicant asks for). The same particulars are excluded wherever else they appear. 趣味・特技
are not claims either. The date written at the top of a 履歴書 is not a claim.

The input is one or more documents. Each is introduced by one header line:

- "=== document <index>: rirekisho ===" — the 履歴書.
- "=== document <index>: shokumu_keirekisho ===" — the 職務経歴書.
- "=== document <index>: additional, titled: <title> ===" — a supporting document the applicant
  added, such as a portfolio or a project write-up. The title is the applicant's own name for it.
  Treat its content by the same rules as the other documents.

An additional document may be written in English even though the set is Japanese. Quote it in the
language it is written in.

A 履歴書's 学歴・職歴 is usually a table flattened into lines of year, month and an event. A line
such as "2016年4月 株式会社〇〇 入社" is one claim; quote the whole line as written.

For every claim return:

- document: the index of the document it comes from.
- quote: the applicant's words for the claim, copied exactly as a contiguous passage of that one
  document — same characters, same punctuation, same spacing, no ellipsis, no paraphrase, no
  translation, nothing added. Keep full-width and half-width characters exactly as written: never
  turn ４０％ into 40% or 40% into ４０％, and never change the era or the calendar of a date. It must
  never run from one document into another, and never include a header line.
- start_hint: roughly where the quote begins, as a character offset from the start of that
  document's text (the line after its header). An estimate is fine.

Return every claim the documents support and nothing they do not. If a passage is not a claim, leave
it out.`;
