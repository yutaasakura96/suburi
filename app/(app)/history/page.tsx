import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { HISTORY_COPY } from "./copy";

/** `/history` opens the newest round, as the rail lists it; with none, it says so (PRD §6). */
export default async function HistoryPage() {
  const userId = await requireSession();
  const [newest] = await getDb()
    .select({ id: s.rounds.id })
    .from(s.rounds)
    .where(eq(s.rounds.userId, userId))
    .orderBy(desc(s.rounds.startedAt), desc(s.rounds.id))
    .limit(1);
  if (newest) redirect(`/history/${newest.id}`);

  return (
    <div className="flex flex-col items-start gap-[10px]" data-testid="history-empty">
      <p className="text-[13px] leading-[1.75] text-ink-3">{HISTORY_COPY.empty}</p>
      <Link href="/round/new" className="text-[13px] text-link hover:text-link-hover hover:underline">
        {HISTORY_COPY.start}
      </Link>
    </div>
  );
}
