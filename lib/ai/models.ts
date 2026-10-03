/**
 * Every model string the app calls, pinned — the only place one is written (03 §4).
 *
 * Never an environment variable and never an alias. Changing one of these is a migration with a
 * re-score and a Progress boundary (invariant 8, 12 §5), not an edit.
 */
export const CV_EXTRACTION_MODEL = "gpt-5.6-sol";

/** Stamp 4 on every scored answer. Changing it is the 12 §5 procedure: a re-score and a boundary. */
export const SCORING_MODEL = "gpt-5.6-sol";

/** Round feedback, stamped on `round_feedback`. */
export const FEEDBACK_MODEL = "gpt-5.6-sol";

/**
 * Question generation at round start (07 §5.4), stamped on `questions.generator_model_id`. Stamp 3 is
 * the generator *prompt* version, which lives in the prompt's filename (`lib/prompts/`).
 */
export const QUESTION_GENERATION_MODEL = "gpt-5.6-sol";

/**
 * The near-duplicate guard's embeddings (03 §4, §11). `questions.embedding` is `vector(1536)`, this
 * model's default dimension. Changing it changes every distance the guard has ever recorded, so each
 * `question_near_misses` row carries the string it was measured with (04).
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Speech-to-text (03 §4). Its only snapshot shares its name, so unlike the scoring model it cannot be
 * a dated string; `answers.transcriber_model_id` is what makes a repoint visible.
 */
export const TRANSCRIPTION_MODEL = "gpt-transcribe";

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
