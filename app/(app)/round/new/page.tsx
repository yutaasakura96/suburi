import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { setupFacts } from "../load";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Start a round — Suburi",
};

/**
 * Round setup (10 §2), minimal for the tracer (#42): round type and length to choose; English,
 * realistic and General practice are the only options that exist yet, so they are stated, not offered.
 */
export default async function NewRoundPage() {
  const userId = await requireSession();
  const facts = await setupFacts(getDb(), userId, "en");
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <SetupForm cv={facts.cv} rubricLabel={facts.rubricLabel} />
    </main>
  );
}
