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

## 2. #44, follow-ups — `lib/prompts/follow-up-ja-1.0.ts`

No new Japanese string reaches a screen: the round's chrome is still English only, and the
catalogue's `followup_generation_failed` sentence was read with #13. What is new is a **prompt that
asks the model for Japanese** — one 深掘り, in the です・ます register, at most 60 characters. Its
instructions are in English; what needs the read is its **output**, and no Japanese round can
produce one until #43. Read a handful of generated follow-ups then, for whether an interviewer would
say them.
