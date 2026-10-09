import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { AppHeader } from "../../../app-header";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import { feedbackScreen } from "../../load";
import { ownRound } from "../own-round";
import { FeedbackView } from "./feedback-view";

export async function generateMetadata({ params }: PageProps<"/round/[roundId]/feedback">): Promise<Metadata> {
  const { round } = await ownRound((await params).roundId);
  return { title: ROUND_COPY[(round?.language ?? "en") as RoundLanguage].feedbackTitle };
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

  const screen = await feedbackScreen(getDb(), round);
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {/* App-level chrome stays English whatever the round's language (10 §0); the round card below carries `lang`. */}
      <div className="border-x border-t border-rule-frame bg-surface">
        <AppHeader active={null} />
      </div>
      <div lang={screen.round.language}>
        <FeedbackView screen={screen} />
      </div>
    </main>
  );
}
