import { cache } from "react";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/round/http";
import { getRound } from "@/lib/round/state";

/**
 * The signed-in user's round, read once per request: the page needs it, and so does its `<title>`,
 * which is chrome and follows the round's language like the rest (10 §0). `null` for another user's
 * round or no round — a 404, as in the API.
 */
export const ownRound = cache(async (roundId: string) => {
  const userId = await requireSession();
  const round = isUuid(roundId) ? await getRound(getDb(), userId, roundId) : null;
  return { userId, round };
});
