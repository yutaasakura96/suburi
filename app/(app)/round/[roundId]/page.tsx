import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { carriesEnglish } from "@/lib/round/english-help";
import { englishHelpStartsOn } from "@/lib/settings/settings";
import { roundCopy, type RoundLanguage } from "../copy";
import { roundFrame } from "../load";
import { ownRound } from "./own-round";
import { RoundRunner } from "./round-runner";

export async function generateMetadata({ params }: PageProps<"/round/[roundId]">): Promise<Metadata> {
  const { userId, round } = await ownRound((await params).roundId);
  const language = (round?.language ?? "en") as RoundLanguage;
  // English help's pill starts from the setting (10 §15), and the tab title is chrome: it starts there too.
  const englishHelp = round !== null && carriesEnglish(round) && (await englishHelpStartsOn(getDb(), userId));
  return { title: roundCopy(language, englishHelp).title };
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
