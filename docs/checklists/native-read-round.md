# Native read — the round loop, as it lands

`11` §5 asks for a native read of every new Japanese string, and `05` §6 holds the rules earned so
far. The round loop adds its strings slice by slice; this file collects them so they can be read in
one sitting, the way `native-read-cv.md` did for the CV feature.

> **§1–§4 read 2026-10-03 as an AI review, not a native read.** The user does not read Japanese well
> and explicitly delegated this read to firstmate, the supervising AI agent — not a native speaker
> (`06`, 2026-10-03). Every ✓ below is that review's judgement, made against the row's English intent
> and the rules in force; **no native speaker has read these strings.** Result: every row accepted as
> written except four, marked →: the two 緊張度 strings set tight, a Japanese round's titles
> `人事面接` and `最終面接`, and one fixture question reworded. One rule generalised, into `05` §6.
> §5's rubric was reviewed the same day, the same way. A later human native read can revisit any of
> it.

The English column is the intent, not the thing being judged. **How each row was marked:** ✓ accepted
as written, or → with the replacement in the row and what it replaced beside it. A rule that
generalises past its own row goes into `05` §6 and, where it can be tested, into
`lib/copy/errors.test.ts` or `app/(app)/round/copy.test.ts`.

**Rules already in force**, asserted by test, so a replacement must keep them: every error sentence
ends in `。`; no two error codes share a sentence; in the round's chrome, an unspaced `・` and never a
Latin `·`, no digit followed by `点`, `録り直し` never `撮り直し`, `バージョン` never `版`, no `モード`,
a string that holds a sentence ends in `。`, and — earned by this read — a sentence sets its numerals
tight.

## 1. #42, the tracer — `lib/copy/errors.ts`

The English round's screens carry no Japanese: a round's chrome is in its language (`10` §0), and the
Japanese round is #43's. These are the three error codes the tracer added to the bilingual catalogue.

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | 講評をまとめられませんでした。ラウンドは終了し、採点は残っています。もう一度お試しください。 | `feedback_generation_failed` — The round feedback could not be written. The round is complete and its scores are kept. Try again. |
| ✓ | 保存に失敗しました。何も書き込まれていません。同じ操作をもう一度お試しください。 | `write_failed` — The save failed, and nothing was written. Try the same step again. |
| ✓ | このラウンドは中断されています。新しいラウンドを始めてください。 | `round_abandoned` — This round was abandoned. Start a new round. |

## 2. #43, the Japanese round's chrome — `app/(app)/round/copy.ts`

Every string a Japanese round's screens show, record to feedback (`10` §0). ★ marks a string `10`
§3–§8 or `05` §5 already quotes, which the artboards drew but nobody has read as copy; the rest were
written for #43, most of them as the Japanese of a string #42 wrote in English.

**Four things the read had to decide, each more than one row, and what it decided:**

1. **The section labels.** `10` §0 has the artboards' Latin labels become Japanese. The six chosen:
   `文字起こし — 未修正` (was `Raw transcript — 未修正`), `あなたの回答 — 自由に直せます`
   (`YOUR ANSWER — EDIT FREELY`), `未修正の文字起こし — 置き換えずに残します`
   (`RAW — KEPT, NEVER REPLACED`), `書き直し` (`Rewrite`), `講評の前に` (`BEFORE THE FEEDBACK`) and
   `緊張度について` (`WHAT THIS IS NOT`). The last is not a translation: 「これは何ではないか」 reads
   as a riddle, so the label names the subject and the three lines under it do the denying.
   **Decided: all six accepted as chosen.**
2. **A space around a numeral.** `05` §6 sets the Japanese tight against a Latin numeral
   (`14:32から保存できます。`, not `14:32 から`), and `10` §7–§8 quote
   `緊張度 4 をこのラウンドに記録します。` and `緊張度 4 を講評前に記録` with a space on both sides
   of the value, and `直すところ 3件`, `最長 4分`, `書き直し 8%` with one before it.
   **Decided, and now `05` §6's rule:** inside a sentence or phrase the numeral sits tight —
   `緊張度4をこのラウンドに記録します。`, `緊張度4を講評前に記録`; a value shown as a label's figure
   keeps one space before it — `最長 4分`, `直すところ 3件`, `良かったところ 1件`, `書き直し 8%`.
   `10` §7–§8's quotes were updated to match.
3. **`HR`, and `CEO・最終`,** as a Japanese round's title: `10` §2's names, Latin letters in a
   Japanese header. `人事面接` and `最終面接` are the alternatives.
   **Decided: `人事面接` and `最終面接`** on a Japanese round. The app-level screens are English and
   keep `HR` and `CEO / final`.
4. **`採点中`** for an answer whose scoring has not finished, beside `未採点` for one whose scoring
   failed. `10` §8 quotes only `未採点`. **Decided: accepted.**

### 2.1 The round header, the tab titles and the stamps

Every screen of a Japanese round.

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | ラウンド — Suburi | Round — Suburi |
| ✓ | 講評 — Suburi | Round feedback — Suburi |
| ✓ | ★ 行動面接 | round type — Behavioural |
| ✓ | ★ 技術面接 | round type — Technical |
| → | 人事面接 | round type — HR. Was `HR` |
| → | 最終面接 | round type — CEO / final. Was `CEO・最終` |
| ✓ | ★ 日本語・実戦・5問 | English · Realistic · 5 questions |
| ✓ | ★ 第1問 / 5問 | Question 1 / 5 |
| ✓ | ★ 評価基準 v1.0 | Rubric v1.0 |
| ✓ | 評価基準 v1.0・set-piece-ja-1.0・応募書類 v3 | the stamp line: the parts joined by `・`, unspaced — Rubric v1.0 · set-piece-en-1.0 · CV v3 |

### 2.2 Record — asked, recording, transcript back (`10` §3–§5)

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | ★ 講評はラウンドが終わってからまとめて出ます。途中では何も出ません。 | The feedback comes together when the round ends. Nothing is shown along the way. |
| ✓ | ★ 録音を開始 | Start recording |
| ✓ | ★ 最長 4分 | Up to 4 min |
| ✓ | ★ 一発勝負です。録り直しはできません。 | One take. There is no re-recording. |
| ✓ | ★ 止めたあとに文字起こしを直せます。 | You can correct the transcript once you stop. |
| ✓ | ★ 録音中 | Recording |
| ✓ | ★ 停止して文字起こし | Stop and transcribe |
| ✓ | ★ 4分で自動的に止まります。そこまでの録音は残ります。 | Stops by itself at 4 minutes. What was recorded up to then is kept. |
| ✓ | 録音をアップロードして、文字起こしをしています。 | Uploading the take and transcribing it. |
| ✓ | マイクを使えません。何も録音されておらず、この質問は未回答のままです。 | The microphone is not available. Nothing was recorded, and the question stays unseen. |
| ✓ | 録音に失敗しました。何も録音されておらず、この質問は未回答のままです。 | The recording failed. Nothing was recorded, and the question stays unseen. |
| ✓ | 録音をアップロードできませんでした。録音はこのタブに残っています。もう一度お試しください。 | The take could not be uploaded. It is still in this tab; try again. |
| ✓ | もう一度試す | Try again |
| ✓ | サーバーに届かなかったか、応答が戻りませんでした。もう一度お試しください。 | The request did not reach the server, or its answer did not come back. Try again. |
| ✓ | 文字起こし — 未修正 | Raw transcript — uncorrected |
| ✓ | ★ 3:12・約250字/分・800字 | 3:12 · ~250 wpm · 800 words |
| ✓ | ★ 文字起こしを直す | Correct the transcript |
| ✓ | ★ 言った通りに直してから送ります。書き直しの量は記録しますが、評価には使いません。 | Correct it to what you said, then send. The amount rewritten is recorded but never scored. |
| ✓ | ★ この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。 | The round goes on. You can correct the full text on the next screen. Neither the audio nor the uncorrected transcript is ever discarded. |

### 2.3 Transcript correction (`10` §6)

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | あなたの回答 — 自由に直せます | Your answer — edit freely |
| ✓ | ★ 800字 → 812字 | 800 words → 812 words |
| ✓ | 未修正の文字起こし — 置き換えずに残します | Raw — kept, never replaced |
| ✓ | 書き直し | Rewrite |
| ✓ | ★ の文字が、未修正の文字起こしから変わりました | of the characters changed from the uncorrected transcript |
| ✓ | ★ 記録するだけです。誤認識と言い直しの区別はしません。 | Recorded only. It does not tell a misrecognition from a restart. |
| ✓ | ★ 評価にも進捗にも使いません。あとで認識精度を見直すために残します。 | Not used in scoring or in progress. Kept to review recognition accuracy later. |
| ✓ | ★ この回答を送る | Send this answer |
| ✓ | 送ると、先へ進む間にこの回答を採点します。結果はラウンドが終わるまで出ません。 | Sending scores this answer while you go on. Nothing about it is shown until the round ends. |
| ✓ | 送っています。 | Sending. |
| ✓ | 回答が空です。話した内容を、直した形で残してください。 | The answer is empty. Keep what you said, corrected. |
| ✓ | ★ 3:12・約250字/分 | 3:12 · ~250 wpm |

### 2.4 Felt pressure (`10` §7)

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | ★ 講評の前に | Before the feedback |
| ✓ | ★ いまのラウンド、どのくらい緊張しましたか。 | How tense did this round feel? |
| ✓ | ★ 近いものを1つ選んでください。講評の前に一度だけ聞きます。 | Pick the closest one. Asked once, before the feedback. |
| ✓ | 1 まったく緊張しなかった | 1 Not tense at all |
| ✓ | 2 少し意識した | 2 A little aware of it |
| ✓ | 3 それなりに緊張した | 3 Fairly tense |
| ✓ | 4 かなり緊張した | 4 Very tense |
| ✓ | 5 頭が真っ白になった | 5 My mind went blank |
| ✓ | 緊張度について | What this is not |
| ✓ | ★ 採点ではありません。選んだ数字で講評は変わりません。 | Not a score. The number you pick does not change the feedback. |
| ✓ | ★ 進捗グラフには出ません。上げるものでも下げるものでもありません。 | Not on the progress charts. Nothing to raise or lower. |
| ✓ | ★ 回答ごとではなく、ラウンドごとに1回だけ聞きます。 | Asked once per round, not per answer. |
| ✓ | ★ 1つ選ぶと講評に進めます。 | Pick one to go on to the feedback. |
| → | 緊張度4をこのラウンドに記録します。 | Records pressure 4 for this round. Was `緊張度 4 をこのラウンドに記録します。` |
| ✓ | 講評に進む | Go to the feedback |
| ✓ | 緊張度を記録して、講評をまとめています。 | Recording the rating and writing the feedback. |
| ✓ | 新しいラウンドが始まったため、このラウンドは中断されました。記録はそのまま残ります。 | This round was left when a newer one started. It stays as it is. |
| ✓ | ホームへ | Home |

### 2.5 Round feedback (`10` §8)

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | ★ 第1問 / 5問 | Question 1 / 5 |
| ✓ | ★ 第2問 | Question 2 |
| ✓ | 回答 | Answers |
| ✓ | ★ 3分12秒・約250字/分・書き直し 8% | 3 min 12 s · ~250 wpm · rewrite 8% |
| ✓ | ★ 未採点 | Not scored |
| ✓ | 採点中 | Not scored yet |
| ✓ | ★ 直すところ 3件 | To fix 3 |
| ✓ | ★ 良かったところ 1件 | What worked 1 |
| ✓ | このラウンドの講評はまだできていません。ラウンドは終了し、緊張度は記録され、上の採点はすべて残っています。 | The findings for this round are not ready. The round is complete, its rating is recorded, and every score above is kept. |
| ✓ | このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了し、緊張度は記録されています。 | No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded. |
| ✓ | 講評をまとめる | Write the findings |
| ✓ | 講評をまとめています。 | Writing the findings. |
| → | 緊張度4を講評前に記録 | Pressure 4 recorded before the feedback. Was `緊張度 4 を講評前に記録` |

### 2.6 The feedback language pill

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | 日本語 | the pill, while the feedback is read in English: switches it back to Japanese |

## 3. The Japanese set pieces — `lib/questions/set-pieces.ts`

Content version `set-piece-ja-1.0`. Seeded once per user; a changed wording is a new content version, not an edit (`04` `questions`).

| | Japanese | Asked in | Intent |
| --- | --- | --- | --- |
| ✓ | まず、簡単に自己紹介をお願いします。 | `hr` | 自己紹介 — the self-introduction, asked first |
| ✓ | 自己PRをお願いします。 | `hr` | 自己PR |
| ✓ | 転職を考えた理由を教えてください。 | `hr` | 転職理由 |
| ✓ | 当社を志望した理由を教えてください。 | `ceo` | 志望動機 |

## 4. The synthetic Japanese questions — `db/seed-questions.ts`

Fixtures for `develop` and local only (`12` §1), stamped `synthetic-generated-ja-1.0`; production's bank is the generator's (#45). They are read here because the user answers them aloud on `develop`.

| | Japanese | Round type |
| --- | --- | --- |
| ✓ | 上司と意見が合わなかったときのことを教えてください。そのとき、どう対応しましたか。 | `hr` |
| ✓ | どのようなチームで最も力を発揮できますか。その理由も教えてください。 | `hr` |
| ✓ | 仕事の進め方が変わるきっかけになったフィードバックについて教えてください。 | `hr` |
| ✓ | すべての仕事が急ぎに見えるとき、何から取り組むかをどう決めていますか。 | `hr` |
| ✓ | 仕事での失敗と、そのあとに変えたことを教えてください。 | `hr` |
| → | 前のチームのメンバーは、あなたが控えたほうがいいことは何だと言うと思いますか。 | `hr`. Was `前のチームの人たちは、あなたが控えたほうがよいことは何だと言うと思いますか。` |
| ✓ | 担当業務のほかに、スキルを保つためにしていることはありますか。 | `hr` |
| ✓ | 3年後にどのようなキャリアを築いていたいですか。この職務はそこにどうつながりますか。 | `hr` |
| ✓ | この1年で解決した、最も難しかった問題について教えてください。 | `behavioural` |
| ✓ | 必要な時間が足りない中で成果を出さなければならなかった経験を教えてください。 | `behavioural` |
| ✓ | 自分の部下ではない人を説得した経験を教えてください。 | `behavioural` |
| ✓ | 本番環境で突然処理が遅くなったとき、原因をどのように突き止めますか。 | `technical` |
| ✓ | 稼働中のサービスを、停止させずに新しいデータベースへ移行するにはどうしますか。 | `technical` |
| ✓ | 過去の設計判断のうち、今なら違う判断をするものについて教えてください。 | `technical` |
| ✓ | 入社して1年後に、何を成し遂げていたいですか。 | `ceo` |
| ✓ | この業界がいま見誤っていることは何だと思いますか。 | `ceo` |
| ✓ | あなたより経験の豊富な候補者ではなく、あなたを選ぶべき理由は何ですか。 | `ceo` |

## 5. Rubric `ja` v1.0 — `lib/rubric/ja-1.0.ts`

The seven dimensions' names, their one-line definitions and all thirty-five anchors are Japanese and
were read in the file itself, as the rubric review that precedes its seeding (#43's first
acceptance criterion). **Reviewed 2026-10-03, by the same AI review at the user's delegation:**
approved with one anchor reworded — 敬語 level 3 now names `いわゆるバイト敬語（「〜のほう」
「〜になります」）` where it said `「〜のほう」「〜になります」のような不適切な敬語`. Nothing had been
seeded, so it is still v1.0. Why the review comes first: a seeded version is immutable, so a wording changed after the seed is rubric
v1.1, a re-score and a boundary on the charts (`04` §5). The names are `10` §8's — 構成, 根拠, 関連性,
流暢さ, 正確さ, 長さ・配分, 敬語, and they are the seven row labels on a Japanese round's feedback.
The definitions and anchors are what the scoring model reads; no screen shows them yet.

## 6. What cannot be read in advance

The feedback itself — the justifications, `直すところ` and `良かったところ` — is written by the model
per round. `lib/prompts/score-ja-1.0.ts` and `lib/prompts/feedback-ja-1.1.ts` are written in English
and ask for plain form (常体) throughout, counters in 件・問・分・秒・字 and quotes in 「」; whether the
model's Japanese keeps to that is read on the first real Japanese round on `develop`, and a rule it
breaks is a prompt version, not an edit.

## 7. #46, CV grounding

**Unread:** these arrived from #46 after the 2026-10-03 review of §1–§5, and nobody has read them. The
two `裏づけなし` sentences are set tight after `v3`, by the rule that review earned (`05` §6); #46
wrote them with a space.

**On `/cv`'s Japanese panel** (`app/(app)/cv/copy.ts`, `10` §13):

| | Japanese | Intent |
| --- | --- | --- |
| | 記載事項 34件・未使用 12件 | The count line beside the version stamp — 34 claims · 12 never used. `未使用` is the same word the feedback screen uses for unused CV material. |
| | 太い下線は、これまでの回答で使った記載事項です。 | The legend under it — A heavier underline marks a claim one of your answers has used. |

**On a Japanese round's feedback** (`app/(app)/round/copy.ts`, `10` §8), specified by #46 and built by
#43. `「…」` stands for a quote sliced from stored text; `第2問` and `応募書類 v3` are filled in by the
app.

| | Japanese | Intent |
| --- | --- | --- |
| | 応募書類との照合 | The section label — Checked against your CV. Already in the artboards; read in the 2026-09-27 AI review. |
| | 裏づけなし（第2問）—「…」に対応する記述が応募書類 v3にない。 | One rail per unsupported span — Unsupported (Question 2): nothing in CV v3 backs “…”. The question number is new; the rest is the artboards' sentence. Plain form, like its sibling list (`05` §6). |
| | 裏づけなし — 応募書類 v3に照らして該当なし。 | No span was flagged in the round — Unsupported: nothing flagged against CV v3. |
| | 未使用 —「…」「…」 | The picked unused claims — Unused: “…” “…”. Already in the artboards. |
| | 未使用 — この回で挙げる記載事項はなし。 | Nothing was picked — Unused: nothing picked for this round. |
| | 英語での回答です。日本語の進捗には入れません。 | Under an answer given in English to a Japanese round — This answer was given in English. It is kept out of your Japanese progress. |

## 8. #44, follow-ups

**Unread:** these arrived from #44 after the 2026-10-03 review of §1–§5, and nobody has read them.
`深掘り` is the word `05` §6 settled for a follow-up. ★ marks a string `10` §3–§8 or `05` §5 already
quotes; the rest were written for #44, each as the Japanese of a string it wrote in English.

**On a Japanese round's screens** (`app/(app)/round/copy.ts`):

| | Japanese | Intent |
| --- | --- | --- |
| | 第2問 / 5問・深掘り | The header's step while a follow-up is asked — Question 2 / 5 · follow-up. It shares its question's number (`10` §3). |
| | ★ 送ると、いま直した文から深掘りが1問つくられます。 | The send caption under a question's answer — Sending writes one follow-up question from the text you just corrected. |
| | 送っています。深掘りの質問をつくっています。 | While that send is in flight — Sending. The follow-up question is being written. |
| | 回答は保存されています。このページを開いた時点では、深掘りの質問がまだつくられていませんでした。 | The answer was committed and its follow-up was not stored when the page loaded (`10` §6) — Your answer is saved. Its follow-up question had not been written when this page loaded. |
| | 先へ進む | The one button on that frame — Go on. |
| | 上の回答はこのまま保存され、採点されます。あとから変えることはできません。 | Its caption — The answer above is saved and scored as it is. It cannot be changed. |
| | ★ └ 深掘り | The follow-up row's label on the feedback screen (`10` §8). |
| | ★ 7項目を採点。進捗には入れません。 | Beside a scored follow-up — Scored on 7 dimensions. Not counted in progress. |
| | 採点中。進捗には入れません。 | Its scoring has not finished — Not scored yet. Not counted in progress. `採点中` and `未採点` are §2's words. |
| | 未採点。進捗には入れません。 | Its scoring failed — Not scored. Not counted in progress. |
| | ★ 深掘りが生成されませんでした。空欄として記録しています。 | The row of a follow-up that was not generated — The follow-up was not generated. It is recorded as a gap. |

The catalogue's `followup_generation_failed` sentence, shown when the follow-up could not be
generated, was read with #13.

**What cannot be read in advance.** `lib/prompts/follow-up-ja-1.0.ts` asks the model for one 深掘り,
in the です・ます register, at most 60 characters. Its instructions are in English; what needs the
read is its **output**. `lib/prompts/feedback-ja-1.1.ts` names a follow-up's answer as
`第2問の深掘り` in the findings. Both are read on the first real Japanese round with follow-ups on
`develop`: a handful of generated follow-ups, for whether an interviewer would say them, and the
findings, for whether that name reads naturally. A rule either breaks is a prompt version, not an
edit.

## 9. #47, generated questions and role context

Setup is app-level and English (`10` §0), so the picker, the add form and the bank-exhausted warning
add no Japanese. One catalogue string does.

| | Japanese | Intent |
| --- | --- | --- |
| | 求人票が長すぎます。短くしてからもう一度保存してください。 | `role_context_too_large` — The posting is too long. Shorten it and save again. |

**What cannot be read in advance.** The four Japanese generator prompts
(`lib/prompts/generate-*-ja-1.0.ts`) are written in English and name the Japanese they ask for —
`です・ます体`, ordinary `敬語`, and the set pieces the generator must not ask (`自己紹介`, `自己PR`,
`転職理由`, `志望動機`). What needs a native reader is their **output**: a handful of generated
questions per round type, read for whether an interviewer would say them. They are read on the first
real Japanese round on `develop` whose bank runs short, and a generated question is banked
permanently, so that round is worth starting for the read. A reworded prompt is a new version file
and a Progress boundary (`04` `questions`), not an edit.

## 10. #45, the spoken question

One catalogue string, and what a realistic round's screen 3 puts above the question (`10` §3). ★ marks
a string `10` §3 or `05` §6 already gives. **Nothing in this section has been read yet.**

| | Japanese | Intent |
| --- | --- | --- |
| | 質問を読み上げられませんでした。文字はそのまま残ります。このまま回答してください。 | `speech_failed` — The question could not be read aloud. It stays as text; answer it as usual. Shown in place of the speaker line. |
| | ★ 読み上げました。文字は残します。 | the speaker line — Read aloud. The text stays on screen. |
| | 質問を聞く | Hear the question — the control the speaker line becomes when the browser will not play sound unasked (a reload) |
| | ★ 日本語・練習・3問 | English · Practice · 3 questions — the header's mode word in a practice round |

## 11. #50, History

History is app-level and English (`10` §0), so the rail, the matrix and the retry add no Japanese
chrome. One catalogue string does. The synthetic rounds' Japanese (`db/seed-rounds.ts`) is the
synthetic CV's own sentences and strings already in this repository's fixtures, with `えー、` in front
of one raw transcript; it is seeded on `develop` only. The owner read and accepted the catalogue
string below on 2026-10-05.

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | この回答はいま採点中です。少し待ってからもう一度お試しください。 | `scoring_in_progress` — This answer is being scored right now. Wait a moment and try again. |

## 12. #74, model answers

**Read and accepted by the owner on 2026-10-05.** Ten new strings: nine on screen 8 (`app/(app)/round/copy.ts`) and one in the catalogue
(`lib/copy/errors.ts`). `模範回答` is the word chosen for a model answer (`CONTEXT.md`); `{応募書類 v3}`
stands for the round's stored CV label.

| | Japanese | Intent |
| --- | --- | --- |
| | あなたの回答 | Section label over what the user said — Your answer |
| | 模範回答 | Section label over the model answer — Model answer |
| | 深掘りへの回答 | The same, for the follow-up — Your answer to the follow-up |
| | 深掘りへの模範回答 | Model answer to the follow-up |
| | {応募書類 v3}とあなたの回答をもとに作成しています。下線は、{応募書類 v3}に裏づけのない内容です。 | Caption under a model answer with underlined parts — Written from CV v3 and what you said. An underline marks what CV v3 does not back. |
| | {応募書類 v3}とあなたの回答をもとに作成しています。{応募書類 v3}に裏づけのない内容として下線を付けた箇所はありません。 | The same, with nothing underlined — Nothing in it is underlined as going beyond CV v3. |
| | この質問の模範回答はまだ作成されていません。 | An answer with no model answer stored — No model answer is written for this question yet. |
| | 模範回答を作成する | The button that writes the missing ones — Write the model answers |
| | 模範回答を作成しています。 | Caption while it runs — Writing the model answers. |
| | 模範回答を作成できませんでした。ラウンドの記録と採点はそのまま残っています。もう一度お試しください。 | `model_answer_generation_failed` — The model answers could not be written. The round and its scores are kept as they are. Try again. |

**What cannot be read in advance.** `lib/prompts/model-answer-ja-1.0.ts` is written in English and
names the Japanese it asks for: です・ます体 throughout, 謙譲語 for the candidate's own actions, `御社`
for the interviewer's company and `前職`・`現職` for the candidate's own, 450 to 600 字 for a question
and 200 to 350 for a 深掘り. What needs a native reader is its **output**: a model answer is something
the user will learn from and repeat aloud, so an unnatural phrase in it is taught, not just shown.
Read on the first real Japanese round completed with model answers on `develop`: each one, for
whether a candidate would say it in a real interview. A rule it breaks is a new prompt version, not an
edit.

## 13. #49, practice mode — `app/(app)/round/copy.ts`

Practice's frames (`10` §15). **Owner read and accepted the original 28 Japanese strings and the
numbered follow-up retry label on 2026-10-05, and the numbered bank-question retry heading and the
two names `feedback-ja-1.2` gives an answer given again on 2026-10-06.**
Written to the rules above — `練習` bare and never `練習モード`, `録り直す` never `撮り直す`, no digit
followed by `点`, `採点` for scoring, `深掘り` for a follow-up, `講評` for the round's feedback,
`緊張度` for felt pressure, an unspaced `・`. `—` is set as §2's `文字起こし — 未修正` sets it.

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | 日本語・練習・3問 | The header's line for a practice round — Japanese · Practice · 3 questions. `実戦` is realistic's word. |
| ✓ | 第1問 / 3問・再回答 | The header's step while a question is answered again — Question 1 / 3 · again. |
| ✓ | 第1問 / 3問・深掘り・再回答 | The same for a follow-up answered again — Question 1 / 3 · follow-up · again. |
| ✓ | 回答ごとの採点は、済みしだい出ます。講評はラウンドの最後にまとめて出ます。 | The record frames' footer, where realistic promises silence — Each answer's scores appear once it is scored. The round's feedback comes at the end. |
| ✓ | 文字起こしをするまでは、録り直せます。 | Under the record button, where realistic says one take — You can record again until the take is transcribed. |
| ✓ | 録音を停止 | The stop button. Stopping keeps the take and does not transcribe it — Stop recording. |
| ✓ | 録音をアップロードしています。 | While the stopped take uploads — Uploading the take. |
| ✓ | 録音済み — 文字起こし前 | The status line over a held take — Take recorded — not transcribed yet. |
| ✓ | この録音を文字起こしする | The primary button on a held take — Transcribe this take. |
| ✓ | 文字起こしをすると、この録音で確定します。録り直しはできなくなります。 | Its caption — Once it is transcribed, the take is final and cannot be recorded again. |
| ✓ | 文字起こしをしています。 | While the held take is transcribed — Transcribing the take. |
| ✓ | 録り直す | The record button once a take is held — Record again. |
| ✓ | 録り直すと、いまの録音は置き換わります。 | Its caption — Recording again replaces this take. |
| ✓ | 送ると、この回答を採点します。採点が済むと、次の画面に出ます。 | The send caption under a follow-up's answer or an answer given again — Sending scores this answer. Its scores appear on the next screen once it is scored. |
| ✓ | このあと | The section label over what the round asks next — Next. |
| ✓ | この回答を採点しています。済むとここに出ます。待たずに先へ進めます。 | Under the score rows while the score is pending — This answer is being scored. Its scores appear here once it is scored; you can go on without waiting. |
| ✓ | この回答は採点できませんでした。回答はそのまま残っています。 | When the answer's scoring failed — This answer could not be scored. It is kept as it is. |
| ✓ | 裏づけなし —「チーム全体の生産性を上げた」に対応する記述が応募書類 v3にない。 | An unsupported span on the per-answer frame — §7's sentence without the question number. Plain form, as §7's is. |
| ✓ | 深掘りに答える | The primary button when the follow-up is next — Answer the follow-up. |
| ✓ | 次の質問へ進む | When the next question is next — Go to the next question. |
| ✓ | ラウンドを終えて、講評をまとめます。練習では緊張度を聞きません。 | The caption under `講評に進む` on the last answer's frame — Closes the round and writes its feedback. Practice asks for no pressure rating. |
| ✓ | もう一度答える | The outline button — Answer again. |
| ✓ | 新しい回答として、この回答の横に残します。別に採点し、深掘りはつきません。この回答はそのまま残ります。 | Its caption — A new answer beside this one, scored on its own, with no follow-up. This one stays as it is. |
| ✓ | 採点に戻る | The link back from a question asked again, before anything is recorded — Back to the scores. |
| ✓ | 第1問・再回答 | The feedback pager's label for an answer given again — Question 1 · again. |
| ✓ | 第1問・再回答2 | The same for a second one — Question 1 · again 2. The numeral is set tight. |
| ✓ | 第1問 / 3問・深掘り・再回答2 | A second retry of the same follow-up in the feedback pager — Question 1 / 3 · follow-up · again 2. Owner accepted 2026-10-05. |
| ✓ | 第1問 / 3問・再回答2 | The feedback page heading for a second retry of a bank question — Question 1 / 3 · again 2. Owner accepted 2026-10-06. |
| ✓ | このラウンドの講評はまだできていません。ラウンドは終了し、上の採点はすべて残っています。 | A practice round whose findings are not ready. §2's sentence without the rating — The findings for this round are not ready. The round is complete, and every score above is kept. |
| ✓ | このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了しています。 | A practice round with no scored answer. §2's sentence without the rating — No answer in this round could be scored, so there are no findings for this round. The round is complete. |

`採点中`, `未採点`, `講評に進む`, `先へ進む`, `└ 深掘り` and `講評をまとめています。` are reused from §2
and §8 as they stand.

**The names the feedback prompt uses — read.** `lib/prompts/feedback-ja-1.2.ts`, used only when
no original answer scored and the findings are written from answers given again, names them
`第2問の再回答` and `第2問の深掘りの再回答` in the findings. The owner read both names on 2026-10-06
and accepted them as written. A rule the prompt's output breaks is a prompt version, not an edit.
