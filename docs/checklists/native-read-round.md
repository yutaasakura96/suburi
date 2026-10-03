# Native read — the round loop, as it lands

`11` §5 asks for a native read of every new Japanese string, and `05` §6 holds the rules earned so
far. The round loop adds its strings slice by slice; this file collects them so they can be read in
one sitting, the way `native-read-cv.md` did for the CV feature. **Nothing below has been read yet.**
The read is the user's, and #43 does not ship before it (#43's acceptance criteria).

The English column is the intent, not the thing being judged. Mark each row ✓ (accepted as written) or
write the replacement beside it. A rule that generalises past its own row goes into `05` §6 and, where
it can be tested, into `lib/copy/errors.test.ts` or `app/(app)/round/copy.test.ts`.

**Rules already in force**, asserted by test, so a replacement must keep them: every error sentence
ends in `。`; no two error codes share a sentence; in the round's chrome, an unspaced `・` and never a
Latin `·`, no digit followed by `点`, `録り直し` never `撮り直し`, `バージョン` never `版`, no `モード`,
and a string that holds a sentence ends in `。`.

## 1. #42, the tracer — `lib/copy/errors.ts`

The English round's screens carry no Japanese: a round's chrome is in its language (`10` §0), and the
Japanese round is #43's. These are the three error codes the tracer added to the bilingual catalogue.

| | Japanese | Intent |
| --- | --- | --- |
| | 講評をまとめられませんでした。ラウンドは終了し、採点は残っています。もう一度お試しください。 | `feedback_generation_failed` — The round feedback could not be written. The round is complete and its scores are kept. Try again. |
| | 保存に失敗しました。何も書き込まれていません。同じ操作をもう一度お試しください。 | `write_failed` — The save failed, and nothing was written. Try the same step again. |
| | このラウンドは中断されています。新しいラウンドを始めてください。 | `round_abandoned` — This round was abandoned. Start a new round. |

## 2. #43, the Japanese round's chrome — `app/(app)/round/copy.ts`

Every string a Japanese round's screens show, record to feedback (`10` §0). ★ marks a string `10`
§3–§8 or `05` §5 already quotes, which the artboards drew but nobody has read as copy; the rest were
written for #43, most of them as the Japanese of a string #42 wrote in English.

**Four things to decide while reading, each more than one row:**

1. **The section labels.** `10` §0 has the artboards' Latin labels become Japanese. The six chosen:
   `文字起こし — 未修正` (was `Raw transcript — 未修正`), `あなたの回答 — 自由に直せます`
   (`YOUR ANSWER — EDIT FREELY`), `未修正の文字起こし — 置き換えずに残します`
   (`RAW — KEPT, NEVER REPLACED`), `書き直し` (`Rewrite`), `講評の前に` (`BEFORE THE FEEDBACK`) and
   `緊張度について` (`WHAT THIS IS NOT`). The last is not a translation: 「これは何ではないか」 reads
   as a riddle, so the label names the subject and the three lines under it do the denying.
2. **A space around a numeral.** `05` §6 sets the Japanese tight against a Latin numeral
   (`14:32から保存できます。`, not `14:32 から`), and `10` §7–§8 quote
   `緊張度 4 をこのラウンドに記録します。` and `緊張度 4 を講評前に記録` with a space on both sides
   of the value, and `直すところ 3件`, `最長 4分`, `書き直し 8%` with one before it. The strings are
   kept as `10` quotes them, and the round's copy test does not assert the tight-numeral rule. Either
   a value set off as a figure is the exception and `05` §6 says so, or these tighten to
   `緊張度4を…`; whichever the read decides goes into `05` §6.
3. **`HR`, and `CEO・最終`,** as a Japanese round's title: `10` §2's names, Latin letters in a
   Japanese header. `人事面接` and `最終面接` are the alternatives.
4. **`採点中`** for an answer whose scoring has not finished, beside `未採点` for one whose scoring
   failed. `10` §8 quotes only `未採点`.

### 2.1 The round header, the tab titles and the stamps

Every screen of a Japanese round.

| | Japanese | Intent |
| --- | --- | --- |
| | ラウンド — Suburi | Round — Suburi |
| | 講評 — Suburi | Round feedback — Suburi |
| | ★ 行動面接 | round type — Behavioural |
| | ★ 技術面接 | round type — Technical |
| | ★ HR | round type — HR |
| | ★ CEO・最終 | round type — CEO / final |
| | ★ 日本語・実戦・5問 | English · Realistic · 5 questions |
| | ★ 第1問 / 5問 | Question 1 / 5 |
| | ★ 評価基準 v1.0 | Rubric v1.0 |
| | 評価基準 v1.0・set-piece-ja-1.0・応募書類 v3 | the stamp line: the parts joined by `・`, unspaced — Rubric v1.0 · set-piece-en-1.0 · CV v3 |

### 2.2 Record — asked, recording, transcript back (`10` §3–§5)

| | Japanese | Intent |
| --- | --- | --- |
| | ★ 講評はラウンドが終わってからまとめて出ます。途中では何も出ません。 | The feedback comes together when the round ends. Nothing is shown along the way. |
| | ★ 録音を開始 | Start recording |
| | ★ 最長 4分 | Up to 4 min |
| | ★ 一発勝負です。録り直しはできません。 | One take. There is no re-recording. |
| | ★ 止めたあとに文字起こしを直せます。 | You can correct the transcript once you stop. |
| | ★ 録音中 | Recording |
| | ★ 停止して文字起こし | Stop and transcribe |
| | ★ 4分で自動的に止まります。そこまでの録音は残ります。 | Stops by itself at 4 minutes. What was recorded up to then is kept. |
| | 録音をアップロードして、文字起こしをしています。 | Uploading the take and transcribing it. |
| | マイクを使えません。何も録音されておらず、この質問は未回答のままです。 | The microphone is not available. Nothing was recorded, and the question stays unseen. |
| | 録音に失敗しました。何も録音されておらず、この質問は未回答のままです。 | The recording failed. Nothing was recorded, and the question stays unseen. |
| | 録音をアップロードできませんでした。録音はこのタブに残っています。もう一度お試しください。 | The take could not be uploaded. It is still in this tab; try again. |
| | もう一度試す | Try again |
| | サーバーに届かなかったか、応答が戻りませんでした。もう一度お試しください。 | The request did not reach the server, or its answer did not come back. Try again. |
| | 文字起こし — 未修正 | Raw transcript — uncorrected |
| | ★ 3:12・約250字/分・800字 | 3:12 · ~250 wpm · 800 words |
| | ★ 文字起こしを直す | Correct the transcript |
| | ★ 言った通りに直してから送ります。書き直しの量は記録しますが、評価には使いません。 | Correct it to what you said, then send. The amount rewritten is recorded but never scored. |
| | ★ この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。 | The round goes on. You can correct the full text on the next screen. Neither the audio nor the uncorrected transcript is ever discarded. |

### 2.3 Transcript correction (`10` §6)

| | Japanese | Intent |
| --- | --- | --- |
| | あなたの回答 — 自由に直せます | Your answer — edit freely |
| | ★ 800字 → 812字 | 800 words → 812 words |
| | 未修正の文字起こし — 置き換えずに残します | Raw — kept, never replaced |
| | 書き直し | Rewrite |
| | ★ の文字が、未修正の文字起こしから変わりました | of the characters changed from the uncorrected transcript |
| | ★ 記録するだけです。誤認識と言い直しの区別はしません。 | Recorded only. It does not tell a misrecognition from a restart. |
| | ★ 評価にも進捗にも使いません。あとで認識精度を見直すために残します。 | Not used in scoring or in progress. Kept to review recognition accuracy later. |
| | ★ この回答を送る | Send this answer |
| | 送ると、先へ進む間にこの回答を採点します。結果はラウンドが終わるまで出ません。 | Sending scores this answer while you go on. Nothing about it is shown until the round ends. |
| | 送っています。 | Sending. |
| | 回答が空です。話した内容を、直した形で残してください。 | The answer is empty. Keep what you said, corrected. |
| | ★ 3:12・約250字/分 | 3:12 · ~250 wpm |

### 2.4 Felt pressure (`10` §7)

| | Japanese | Intent |
| --- | --- | --- |
| | ★ 講評の前に | Before the feedback |
| | ★ いまのラウンド、どのくらい緊張しましたか。 | How tense did this round feel? |
| | ★ 近いものを1つ選んでください。講評の前に一度だけ聞きます。 | Pick the closest one. Asked once, before the feedback. |
| | 1 まったく緊張しなかった | 1 Not tense at all |
| | 2 少し意識した | 2 A little aware of it |
| | 3 それなりに緊張した | 3 Fairly tense |
| | 4 かなり緊張した | 4 Very tense |
| | 5 頭が真っ白になった | 5 My mind went blank |
| | 緊張度について | What this is not |
| | ★ 採点ではありません。選んだ数字で講評は変わりません。 | Not a score. The number you pick does not change the feedback. |
| | ★ 進捗グラフには出ません。上げるものでも下げるものでもありません。 | Not on the progress charts. Nothing to raise or lower. |
| | ★ 回答ごとではなく、ラウンドごとに1回だけ聞きます。 | Asked once per round, not per answer. |
| | ★ 1つ選ぶと講評に進めます。 | Pick one to go on to the feedback. |
| | ★ 緊張度 4 をこのラウンドに記録します。 | Records pressure 4 for this round. |
| | 講評に進む | Go to the feedback |
| | 緊張度を記録して、講評をまとめています。 | Recording the rating and writing the feedback. |
| | 新しいラウンドが始まったため、このラウンドは中断されました。記録はそのまま残ります。 | This round was left when a newer one started. It stays as it is. |
| | ホームへ | Home |

### 2.5 Round feedback (`10` §8)

| | Japanese | Intent |
| --- | --- | --- |
| | ★ 第1問 / 5問 | Question 1 / 5 |
| | ★ 第2問 | Question 2 |
| | 回答 | Answers |
| | ★ 3分12秒・約250字/分・書き直し 8% | 3 min 12 s · ~250 wpm · rewrite 8% |
| | ★ 未採点 | Not scored |
| | 採点中 | Not scored yet |
| | ★ 直すところ 3件 | To fix 3 |
| | ★ 良かったところ 1件 | What worked 1 |
| | このラウンドの講評はまだできていません。ラウンドは終了し、緊張度は記録され、上の採点はすべて残っています。 | The findings for this round are not ready. The round is complete, its rating is recorded, and every score above is kept. |
| | このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了し、緊張度は記録されています。 | No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded. |
| | 講評をまとめる | Write the findings |
| | 講評をまとめています。 | Writing the findings. |
| | ★ 緊張度 4 を講評前に記録 | Pressure 4 recorded before the feedback |

### 2.6 The feedback language pill

| | Japanese | Intent |
| --- | --- | --- |
| | 日本語 | the pill, while the feedback is read in English: switches it back to Japanese |

## 3. The Japanese set pieces — `lib/questions/set-pieces.ts`

Content version `set-piece-ja-1.0`. Seeded once per user; a changed wording is a new content version, not an edit (`04` `questions`).

| | Japanese | Asked in | Intent |
| --- | --- | --- | --- |
| | まず、簡単に自己紹介をお願いします。 | `hr` | 自己紹介 — the self-introduction, asked first |
| | 自己PRをお願いします。 | `hr` | 自己PR |
| | 転職を考えた理由を教えてください。 | `hr` | 転職理由 |
| | 当社を志望した理由を教えてください。 | `ceo` | 志望動機 |

## 4. The synthetic Japanese questions — `db/seed-questions.ts`

Fixtures for `develop` and local only (`12` §1), stamped `synthetic-generated-ja-1.0`; production's bank is the generator's (#45). They are read here because the user answers them aloud on `develop`.

| | Japanese | Round type |
| --- | --- | --- |
| | 上司と意見が合わなかったときのことを教えてください。そのとき、どう対応しましたか。 | `hr` |
| | どのようなチームで最も力を発揮できますか。その理由も教えてください。 | `hr` |
| | 仕事の進め方が変わるきっかけになったフィードバックについて教えてください。 | `hr` |
| | すべての仕事が急ぎに見えるとき、何から取り組むかをどう決めていますか。 | `hr` |
| | 仕事での失敗と、そのあとに変えたことを教えてください。 | `hr` |
| | 前のチームの人たちは、あなたが控えたほうがよいことは何だと言うと思いますか。 | `hr` |
| | 担当業務のほかに、スキルを保つためにしていることはありますか。 | `hr` |
| | 3年後にどのようなキャリアを築いていたいですか。この職務はそこにどうつながりますか。 | `hr` |
| | この1年で解決した、最も難しかった問題について教えてください。 | `behavioural` |
| | 必要な時間が足りない中で成果を出さなければならなかった経験を教えてください。 | `behavioural` |
| | 自分の部下ではない人を説得した経験を教えてください。 | `behavioural` |
| | 本番環境で突然処理が遅くなったとき、原因をどのように突き止めますか。 | `technical` |
| | 稼働中のサービスを、停止させずに新しいデータベースへ移行するにはどうしますか。 | `technical` |
| | 過去の設計判断のうち、今なら違う判断をするものについて教えてください。 | `technical` |
| | 入社して1年後に、何を成し遂げていたいですか。 | `ceo` |
| | この業界がいま見誤っていることは何だと思いますか。 | `ceo` |
| | あなたより経験の豊富な候補者ではなく、あなたを選ぶべき理由は何ですか。 | `ceo` |

## 5. Rubric `ja` v1.0 — `lib/rubric/ja-1.0.ts`

The seven dimensions' names, their one-line definitions and all thirty-five anchors are Japanese and
are read in the file itself, as part of the rubric review that precedes its seeding (#43's first
acceptance criterion): a seeded version is immutable, so a wording changed after the seed is rubric
v1.1, a re-score and a boundary on the charts (`04` §5). The names are `10` §8's — 構成, 根拠, 関連性,
流暢さ, 正確さ, 長さ・配分, 敬語, and they are the seven row labels on a Japanese round's feedback.
The definitions and anchors are what the scoring model reads; no screen shows them yet.

## 6. What cannot be read in advance

The feedback itself — the justifications, `直すところ` and `良かったところ` — is written by the model
per round. `lib/prompts/score-ja-1.0.ts` and `lib/prompts/feedback-ja-1.0.ts` are written in English
and ask for plain form (常体) throughout, counters in 件・問・分・秒・字 and quotes in 「」; whether the
model's Japanese keeps to that is read on the first real Japanese round on `develop`, and a rule it
breaks is a prompt version, not an edit.
