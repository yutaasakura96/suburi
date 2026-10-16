// The English reading's one bound (07 §5.20), shared by the route and the correction screen (10 §15),
// which disables its button over it before anything is sent. `english_readings` checks the same.

/**
 * A fifteen-minute practice take at a brisk 350 字/分 is 5,250, and the rest is room for what the
 * editor adds. Code points, as every length in a round is counted.
 */
export const MAX_ENGLISH_READING_SOURCE_CODE_POINTS = 8_000;

export const englishReadingTextFits = (text: string) => Array.from(text).length <= MAX_ENGLISH_READING_SOURCE_CODE_POINTS;
