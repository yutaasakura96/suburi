/**
 * Every model string the app calls, pinned — the only place one is written (03 §4).
 *
 * Never an environment variable and never an alias. Changing one of these is a migration with a
 * re-score and a Progress boundary (invariant 8, 12 §5), not an edit.
 */
export const CV_EXTRACTION_MODEL = "gpt-5.6-sol";

/**
 * US dollars per million tokens, beside the strings they price, for 12 §6's spend signal. Standard
 * tier, short context (up to 272K input tokens), verified against OpenAI's API pricing page on
 * 2026-09-30 (06). Every stored input token is priced as uncached, since only the total is stored, so
 * the figure can only overstate. A price change is an edit here with a new date, not a migration: it
 * moves a threshold's reading, not a score.
 */
export const MODEL_PRICES: Readonly<Record<string, { readonly inputPerMillion: number; readonly outputPerMillion: number }>> = {
  [CV_EXTRACTION_MODEL]: { inputPerMillion: 4.0, outputPerMillion: 20.0 },
};
