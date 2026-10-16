import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import type { RoundRow } from "@/lib/round/state";
import { AppHeader } from "../../../app-header";
import { roundCopy, type RoundLanguage } from "../../copy";
import { feedbackScreen } from "../../load";
import { ownRound } from "../own-round";
import { FeedbackView } from "./feedback-view";

/** Read once per request: the page needs it, and so does its `<title>`, which follows where the pill starts. */
const screenOf = cache((round: RoundRow) => feedbackScreen(getDb(), round));

export async function generateMetadata({ params }: PageProps<"/round/[roundId]/feedback">): Promise<Metadata> {
  const { round } = await ownRound((await params).roundId);
  const language = (round?.language ?? "en") as RoundLanguage;
  // The tab title is chrome: with the pill starting on (10 §8), it starts in English too.
  const englishHelp = round !== null && round.completedAt !== null && (await screenOf(round)).englishHelp === true;
  return { title: roundCopy(language, englishHelp).feedbackTitle };
}

/**
 * Round feedback (10 §8): the screen the product exists for. It reads stored rows and nothing else —
 * `complete` already waited, bounded, and wrote what it could — so it renders at once, and a missing
 * piece is a stated state, never a spinner.
 */
export default async function FeedbackPage({ params }: PageProps<"/round/[roundId]/feedback">) {
  const { round } = await ownRound((await params).roundId);
  if (!round) notFound();
  if (round.completedAt === null) redirect(`/round/${round.id}`);

  const screen = await screenOf(round);
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {/* App-level chrome stays English whatever the round's language (10 §0); the round card below carries `lang`. */}
      <div className="border-x border-t border-rule-frame bg-surface">
        <AppHeader active={null} />
      </div>
      <FeedbackView screen={screen} />
    </main>
  );
}
