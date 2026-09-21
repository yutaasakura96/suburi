/**
 * Every model string the app calls, pinned — the only place one is written (03 §4).
 *
 * Never an environment variable and never an alias. Changing one of these is a migration with a
 * re-score and a Progress boundary (invariant 8, 12 §5), not an edit.
 */
export const CV_EXTRACTION_MODEL = "gpt-5.6-sol";
