// The derived measures of an answer (11 §3.9). Pure, and shared by the server, which stores them, and
// screen 6's meter, which shows them live — so the meter and the stored value cannot disagree
// (07 §5.9).

function codePoints(text: string) {
  return Array.from(text);
}

// Whitespace runs are one space: a re-wrapped line is not a rewrite (11 §3.9, "stable under pure
// whitespace changes").
function comparable(text: string) {
  return codePoints(text.replace(/\s+/gu, " ").trim());
}

/** Longest common subsequence length, by code point, in O(min) memory. */
function lcsLength(a: readonly string[], b: readonly string[]) {
  // A common prefix and suffix are in every LCS; trimming them first makes a local edit to a long
  // transcript cheap enough to run on every keystroke.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const shared = start + (a.length - endA);
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length === 0 || y.length === 0) return shared;

  const [long, short] = x.length >= y.length ? [x, y] : [y, x];
  let previous = new Uint32Array(short.length + 1);
  let current = new Uint32Array(short.length + 1);
  for (const character of long) {
    for (let j = 1; j <= short.length; j += 1) {
      current[j] = character === short[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return shared + previous[short.length];
}

/**
 * How much the correction step changed the raw transcript, 0–1: `1 − LCS(raw, edited) / max(|raw|,
 * |edited|)`, by character (10 §6). Not a word diff and not an edit-distance ratio, which give visibly
 * different numbers for the same edit.
 */
export function rewriteMagnitude(raw: string, edited: string): number {
  const a = comparable(raw);
  const b = comparable(edited);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  return Math.min(1, Math.max(0, 1 - lcsLength(a, b) / longest));
}

/** Screen 6's figure: the magnitude as a whole percentage, clamped to 0–100 (10 §6). */
export function rewritePercent(magnitude: number) {
  return Math.min(100, Math.max(0, Math.round(magnitude * 100)));
}

/**
 * How long a transcript is, in the unit its language is paced in: characters for `ja`, whitespace
 * aside, and words for `en`. Screens 5 and 6 show this count beside the pace, and 10 §5 requires the
 * two to agree, so they are the same count.
 */
export function paceUnits(language: "ja" | "en", transcript: string): number {
  return language === "ja"
    ? codePoints(transcript.replace(/\s/gu, "")).length
    : transcript.split(/\s+/u).filter((word) => word !== "").length;
}

/**
 * The pace, in the language's own unit (06, 2026-09-27, confirm 4): characters per minute of the raw
 * transcript for `ja`, words per minute for `en`. Stored in `answers.words_per_minute` whatever the
 * unit. Null without a duration — there is no delivery to measure.
 */
export function pace(language: "ja" | "en", transcript: string, durationMs: number | null): number | null {
  if (durationMs === null || durationMs <= 0) return null;
  return paceUnits(language, transcript) / (durationMs / 60_000);
}
