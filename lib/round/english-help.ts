import { questionEnglish } from "../questions/translations";
import type { Db } from "./http";
import type { RoundRow } from "./state";

// English help in what a round's routes read (07 §5.4, §5.5, §5.9; 06, 2026-10-14, Q106-2, Q106-3).

/**
 * Whether this round's prompts carry their English: **a Japanese practice round's, and no other.** A
 * realistic round shows no English before its feedback whatever the user's setting says, and an
 * English round has none to show.
 */
export function carriesEnglish(round: Pick<RoundRow, "language" | "mode">) {
  return round.language === "ja" && round.mode === "practice";
}

/**
 * The `text_en` a prompt carries, as the fields to spread into it: **none at all** — not `null`,
 * absent — on a round that does not carry English, so no English can reach a realistic round's
 * screens whatever the client does. A bank question's is its newest stored English, or `null`; a
 * follow-up's (`questionId` null) is `null` until follow-ups are written with their English (#125).
 * Read on every request, never cached on the round.
 */
export async function promptEnglish(
  db: Pick<Db, "selectDistinctOn">,
  round: Pick<RoundRow, "language" | "mode">,
  questionId: string | null,
): Promise<{ text_en?: string | null }> {
  if (!carriesEnglish(round)) return {};
  return { text_en: questionId === null ? null : await questionEnglish(db, questionId) };
}
