import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { setupFacts } from "../load";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Start a round — Suburi",
};

/**
 * Round setup (10 §2): round type, length and role context to choose. English and realistic are the
 * only options that exist yet, so they are stated, not offered (#43, #49).
 */
export default async function NewRoundPage() {
  const userId = await requireSession();
  const facts = await setupFacts(getDb(), userId, "en");
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <SetupForm cv={facts.cv} rubricLabel={facts.rubricLabel} postings={facts.postings} bank={facts.bank} />
    </main>
  );
}
