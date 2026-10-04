/**
 * How many questions the bank can give a round **without generating** (07 §5.4), from counts alone.
 * No imports: the server's choice (`select-questions.ts`) and Setup's bank-exhausted warning (10 §2)
 * both read it, so the warning cannot say one thing and the round start do another.
 */
export interface BankCounts {
  /** Unseen set pieces of the round's type. A round takes at most one. */
  readonly unseenSetPieces: number;
  readonly unseenGenerated: number;
  readonly seenGenerated: number;
}

export type RoundMode = "realistic" | "practice";

/**
 * - **Realistic:** at most one unseen set piece, then every unseen generated question. A seen one is
 *   a repeat, so it is not supply: it only fills a round that generation could not.
 * - **Practice:** every generated question, seen first; it takes no set piece.
 */
export function bankSupply(counts: BankCounts, mode: RoundMode) {
  return mode === "realistic"
    ? Math.min(1, counts.unseenSetPieces) + counts.unseenGenerated
    : counts.seenGenerated + counts.unseenGenerated;
}
