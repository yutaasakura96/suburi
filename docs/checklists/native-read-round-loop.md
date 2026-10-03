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

## 2. #47, generated questions and role context

Setup is app-level and English (`10` §0), so the picker, the add form and the bank-exhausted warning
add no Japanese. One catalogue string does.

| | Japanese | Intent |
| --- | --- | --- |
| | 求人票が長すぎます。短くしてからもう一度保存してください。 | `role_context_too_large` — The posting is too long. Shorten it and save again. |

**Also to be read, though not chrome:** the four Japanese generator prompts
(`lib/prompts/generate-*-ja-1.0.ts`) are written in English and name the Japanese they ask for —
`です・ます体`, ordinary `敬語`, and the set pieces the generator must not ask (`自己紹介`, `自己PR`,
`転職理由`, `志望動機`). What needs a native reader is their **output**: a handful of generated
questions per round type, read for whether an interviewer would say them. No Japanese round can be
started until #43, so nothing they write is asked yet; a reworded prompt is a new version file and a
Progress boundary (`04` `questions`), so the read belongs before the first Japanese round, not after.
