import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { ROUND_COPY, type RoundLanguage } from "../copy";
import { roundFrame } from "../load";
import { ownRound } from "./own-round";
import { RoundRunner } from "./round-runner";

export async function generateMetadata({ params }: PageProps<"/round/[roundId]">): Promise<Metadata> {
  const { round } = await ownRound((await params).roundId);
  return { title: ROUND_COPY[(round?.language ?? "en") as RoundLanguage].title };
}

/** A running round (10 §3–§7). A completed one is its feedback; another user's is a 404, as in the API. */
export default async function RoundPage({ params }: PageProps<"/round/[roundId]">) {
  const { userId, round } = await ownRound((await params).roundId);
  if (!round) notFound();
  const frame = await roundFrame(getDb(), userId, round);
  if (frame === "complete") redirect(`/round/${round.id}/feedback`);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]" lang={frame.round.language}>
      <RoundRunner frame={frame} />
    </main>
  );
}
