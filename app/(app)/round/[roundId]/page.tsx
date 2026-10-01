import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/round/http";
import { getRound } from "@/lib/round/state";
import { roundFrame } from "../load";
import { RoundRunner } from "./round-runner";

export const metadata: Metadata = {
  title: "Round — Suburi",
};

/** A running round (10 §3–§7). A completed one is its feedback; another user's is a 404, as in the API. */
export default async function RoundPage({ params }: PageProps<"/round/[roundId]">) {
  const userId = await requireSession();
  const { roundId } = await params;
  const db = getDb();
  const round = isUuid(roundId) ? await getRound(db, userId, roundId) : null;
  if (!round) notFound();
  const frame = await roundFrame(db, userId, round);
  if (frame === "complete") redirect(`/round/${round.id}/feedback`);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <RoundRunner frame={frame} />
    </main>
  );
}
