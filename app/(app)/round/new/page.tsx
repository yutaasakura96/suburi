import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { dueDefaults, dueList, lastPractised } from "@/lib/progress/due";
import { savedPostings, setupFacts } from "../load";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Start a round — Suburi",
};

/**
 * Round setup (10 §2): round type, language, length, mode and role context to choose. Each language is
 * scored against its own CV and rubric and draws on its own bank, so the facts are read for both;
 * postings are the user's, in either language. **The four choices start from what is due** (US-3) —
 * the top of Home's Due list, read from the same rows — and every one can be changed.
 */
export default async function NewRoundPage() {
  const userId = await requireSession();
  const db = getDb();
  const [ja, en, postings, last] = await Promise.all([
    setupFacts(db, userId, "ja"),
    setupFacts(db, userId, "en"),
    savedPostings(db, userId),
    lastPractised(db, userId),
  ]);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <SetupForm facts={{ ja, en }} postings={postings} defaults={dueDefaults(dueList(last, new Date()))} />
    </main>
  );
}
