import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { listRounds, ROUNDS_PAGE_DEFAULT, ROUNDS_PAGE_MAX } from "@/lib/round/list-rounds";
import { HISTORY_COPY } from "./copy";
import { HistoryRail } from "./rail";

export const metadata: Metadata = {
  title: HISTORY_COPY.title,
};

/**
 * History (10 §10): the rail of rounds on the left, the selected round's matrix on the right. The rail
 * lives in the layout so the pages it has loaded survive moving between rounds; its first page is read
 * here, the rest through `GET /api/rounds` (07 §5.13). Protected here as well as in the proxy (08 §5).
 *
 * **Read-only by construction**: nothing under this route deletes, edits or shares a round (07 §6).
 * The one thing it can start is the scoring retry of an answer that has no score.
 */
export default async function HistoryLayout({ children }: LayoutProps<"/history">) {
  const userId = await requireSession();
  const db = getDb();
  const [page, count] = await Promise.all([
    listRounds(db, userId, { limit: ROUNDS_PAGE_DEFAULT, cursor: null }, new Date()),
    db.$count(s.rounds, eq(s.rounds.userId, userId)),
  ]);
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section className="flex min-h-[820px] border border-rule-frame bg-surface" aria-label="History">
        <HistoryRail initial={page} count={count} pageMax={ROUNDS_PAGE_MAX} />
        <div className="flex min-w-0 flex-1 flex-col gap-[20px] px-[32px] pt-[24px] pb-[26px]">{children}</div>
      </section>
    </main>
  );
}
