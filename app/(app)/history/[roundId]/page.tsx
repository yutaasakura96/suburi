import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/round/http";
import { getRound } from "@/lib/round/state";
import { HistoryDetailView } from "../detail";
import { historyDetail } from "../load";

/**
 * One round, exactly as it happened (US-12). A Server Component reading stored rows (07 §1): another
 * user's round, or no round, is a 404, as in the API.
 */
export default async function HistoryRoundPage({ params }: PageProps<"/history/[roundId]">) {
  const userId = await requireSession();
  const { roundId } = await params;
  const db = getDb();
  const round = isUuid(roundId) ? await getRound(db, userId, roundId) : null;
  if (!round) notFound();

  // Keyed by the round: the row that is open and the language being read belong to one round.
  return <HistoryDetailView key={round.id} detail={await historyDetail(db, round, new Date())} />;
}
