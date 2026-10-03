/**
 * The text-size cap on a posting (`POST /api/role-contexts`, 07 §5.3), in **code points** — the unit
 * the CV's cap is stated in (`lib/cv/limits.ts`), so the number a refusal names is the number the
 * add form counts.
 *
 * **Measured, not guessed** (#47, 2026-10-03, `scripts/measure-question-generation.mts`): the one
 * model call a posting reaches is a round's question generation, so that call was run with the
 * posting at each size, seven questions each, five runs, `gpt-5.6-sol`.
 *
 * | posting | chars | median | slowest | tokens in |
 * | --- | --- | --- | --- | --- |
 * | `en`, as written | 5,317 | 11.5 s | 19.9 s | 3,930 |
 * | `en` | 10,000 | 10.8 s | 20.4 s | 4,900 |
 * | `en` | 20,000 | 12.7 s | 14.2 s | 6,945 |
 * | `en` | 40,000 | 8.6 s | 20.8 s | 11,049 |
 * | `ja`, as written | 1,660 | 13.1 s | 15.2 s | 4,723 |
 * | `ja` | 10,000 | 10.3 s | 10.8 s | 11,011 |
 * | `ja` | 20,000 | 13.2 s | 15.3 s | 18,545 |
 * | `ja` | 40,000 | 11.2 s | 13.8 s | 33,628 |
 *
 * **The call's duration does not track the posting's size** — across a twenty-four-fold range it
 * stayed in one band. It tracks the questions written (03 §4). So the cap is not a latency bound, and
 * **it is one number for both languages**, unlike the CV's, whose per-language caps follow claim
 * density.
 *
 * What it bounds is cost and sense. 20,000 is a little under four times the real-sized English
 * posting and twelve times the Japanese one, so a long posting with its company boilerplate fits
 * without the cap being felt; it was measured at the cap and at twice it. At the cap the call reads
 * at most about 18,500 tokens (`ja`), some $0.07 of input per round start against a round's $0.40.
 *
 * **Not measured: whether the questions stay good at the cap.** The sweep repeated one posting to
 * reach each size, which says what the call costs, not what a posting that long does to its output.
 * Raising the cap wants that read first.
 */
export const MAX_POSTING_CHARS = 20_000;

/** A posting's company and role title: one line each, as the picker shows them (10 §2). */
export const MAX_POSTING_NAME_CHARS = 200;

/** As long as a filename gets on the file systems the importer reads from. */
export const MAX_SOURCE_FILENAME_CHARS = 255;
