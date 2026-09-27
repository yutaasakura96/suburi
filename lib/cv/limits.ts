/**
 * The total text-size cap on `POST /api/cv-versions` (07 §5.2), in **code points** — the unit of
 * every `cv_claims.span_start/end` and every `cv_documents.start/end`, so the number a refusal names
 * is the number the record counts in.
 *
 * **Measured, not guessed** (#20, 2026-09-23, `gpt-5.6-sol` on the real documents):
 *
 * | set | chars | claims | duration |
 * | --- | --- | --- | --- |
 * | `応募書類` 履歴書 + 職務経歴書 | 9,202 | 181 | 59.5 s |
 * | `CV` one document | 14,607 | 126 | 48.0 s |
 * | synthetic `CV` (develop) | ~1,500 | 17 | 51.0 s |
 *
 * Duration does not track input size — across a ten-fold range it stayed inside a minute. It tracks
 * **claims**, at roughly `21.5 s + 0.21 s × claims`, and claim density is a property of the
 * language: about 20 claims per 1,000 characters in Japanese against 8.6 in English. **That is why
 * the cap is per language** rather than one number: the same character count is two different calls.
 *
 * Each cap is a little over three times the real set, so a 履歴書 plus a 職務経歴書 plus five
 * supporting documents fits without the cap ever being felt. At the cap the predicted call is ~145 s
 * (`ja`) and ~105 s (`en`), inside the OpenAI client's 240 s timeout with margin and well inside the
 * route's 300 s ceiling. Output at the cap is ~24,000 tokens against the model's 128,000 limit, and
 * input is a rounding error against its 922,000.
 *
 * Raising one is not an edit: it is a measurement on a set that size, because the margin above is
 * the only thing standing between a long CV and a save that dies at the client timeout.
 *
 * **Everything above is one call.** Since #29 extraction is N parallel windowed calls
 * (`windowed-extraction.ts`), whose wall time follows the largest window rather than the whole set,
 * and a set at the cap is at least 8 (`ja`) or 12 (`en`) concurrent calls.
 *
 * **Re-measured windowed on the real documents, 2026-09-27 (#20/#29), `cv-extract-ja-1.2` /
 * `cv-extract-en-1.3`:**
 *
 * | set | code points | windows | claims | duration |
 * | --- | --- | --- | --- | --- |
 * | `応募書類` 履歴書 + 職務経歴書 | 9,077 | 3 | 81 | 43.2 s |
 * | `CV` one document | 14,607 | 4 | 82 | 45.5 s |
 *
 * `spans_rejected`, `quotes_outside_window` and `window_retries` were all 0 on both. Wall time tracks
 * the largest window (a few thousand code points), not the whole set, so both came in under the
 * one-call durations above (59.5 s and 48.0 s) even as window fan-out grew. **The caps stay ja 30,000 /
 * en 45,000**: nothing measured windowed suggests a set at either cap would approach the OpenAI
 * client's 240 s timeout or the route's 300 s ceiling.
 */
export const MAX_BODY_CHARS = { ja: 30_000, en: 45_000 } as const satisfies Record<"ja" | "en", number>;
