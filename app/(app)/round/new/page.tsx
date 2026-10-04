import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { setupFacts } from "../load";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Start a round — Suburi",
};

/**
 * Round setup (10 §2), still minimal: round type, language and length to choose; realistic and General
 * practice are the only options that exist yet, so they are stated, not offered. Each language is
 * scored against its own CV and rubric, so the facts are read for both.
 */
export default async function NewRoundPage() {
  const userId = await requireSession();
  const db = getDb();
  const [ja, en] = await Promise.all([setupFacts(db, userId, "ja"), setupFacts(db, userId, "en")]);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <SetupForm facts={{ ja, en }} />
    </main>
  );
}
