# Native read — the round loop, as it lands

`11` §5 asks for a native read of every new Japanese string, and `05` §6 holds the rules earned so
far. The round loop adds its strings slice by slice; this file collects them so they can be read in
one sitting, the way `native-read-cv.md` did for the CV feature. **Nothing below has been read yet.**

The English column is the intent, not the thing being judged. Mark each row ✓ (accepted as written) or
write the replacement beside it. A rule that generalises past its own row goes into `05` §6 and, where
it can be tested, into `lib/copy/errors.test.ts`.

**Rules already in force**, asserted by test, so a replacement must keep them: every error sentence
ends in `。`; no two error codes share a sentence.

## 1. #42, the tracer — `lib/copy/errors.ts`

The English round's screens carry no Japanese: a round's chrome is in its language (`10` §0), and the
Japanese round is #43's. These are the three error codes the tracer added to the bilingual catalogue.

| | Japanese | Intent |
| --- | --- | --- |
| | 講評をまとめられませんでした。ラウンドは終了し、採点は残っています。もう一度お試しください。 | `feedback_generation_failed` — The round feedback could not be written. The round is complete and its scores are kept. Try again. |
| | 保存に失敗しました。何も書き込まれていません。同じ操作をもう一度お試しください。 | `write_failed` — The save failed, and nothing was written. Try the same step again. |
| | このラウンドは中断されています。新しいラウンドを始めてください。 | `round_abandoned` — This round was abandoned. Start a new round. |

## 2. #46, CV grounding

**Built, on `/cv`'s Japanese panel** (`app/(app)/cv/copy.ts`, `10` §13):

| | Japanese | Intent |
| --- | --- | --- |
| | 記載事項 34件・未使用 12件 | The count line beside the version stamp — 34 claims · 12 never used. `未使用` is the same word the feedback screen uses for unused CV material. |
| | 太い下線は、これまでの回答で使った記載事項です。 | The legend under it — A heavier underline marks a claim one of your answers has used. |

**Specified in `10` §8 for the Japanese round (#43) to render; not built here.** `「…」` stands for a
quote sliced from stored text; `第2問` and `応募書類 v3` are filled in by the app.

| | Japanese | Intent |
| --- | --- | --- |
| | 応募書類との照合 | The section label — Checked against your CV. Already in the artboards; read in the 2026-09-27 AI review. |
| | 裏づけなし（第2問）—「…」に対応する記述が応募書類 v3 にない。 | One rail per unsupported span — Unsupported (Question 2): nothing in CV v3 backs “…”. The question number is new; the rest is the artboards' sentence. Plain form, like its sibling list (`05` §6). |
| | 裏づけなし — 応募書類 v3 に照らして該当なし。 | No span was flagged in the round — Unsupported: nothing flagged against CV v3. |
| | 未使用 —「…」「…」 | The picked unused claims — Unused: “…” “…”. Already in the artboards. |
| | 未使用 — この回で挙げる記載事項はなし。 | Nothing was picked — Unused: nothing picked for this round. |
| | 英語での回答です。日本語の進捗には入れません。 | Under an answer given in English to a Japanese round — This answer was given in English. It is kept out of your Japanese progress. |
