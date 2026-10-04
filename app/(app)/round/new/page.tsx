import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { savedPostings, setupFacts } from "../load";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Start a round — Suburi",
};

/**
 * Round setup (10 §2): round type, language, length and role context to choose; realistic is the only
 * mode that exists yet, so it is stated, not offered (#49). Each language is scored against its own CV
 * and rubric and draws on its own bank, so the facts are read for both; postings are the user's, in
 * either language.
 */
export default async function NewRoundPage() {
  const userId = await requireSession();
  const db = getDb();
  const [ja, en, postings] = await Promise.all([setupFacts(db, userId, "ja"), setupFacts(db, userId, "en"), savedPostings(db, userId)]);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <SetupForm facts={{ ja, en }} postings={postings} />
    </main>
  );
}
