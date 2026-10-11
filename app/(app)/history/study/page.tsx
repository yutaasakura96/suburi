import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { decodeCursor } from "@/lib/round/list-rounds";
import { AppHeader } from "../../app-header";
import { sectionLabel } from "../../round/parts";
import { STUDY_COPY as COPY } from "./copy";
import { studyPage } from "./load";
import { StudyRoundView } from "./study-round";

export const metadata: Metadata = {
  title: COPY.title,
};

const link = "text-[13px] text-link hover:text-link-hover hover:underline";

/**
 * The study view (10 §16, US-18): every answered question, with what was said, the
 * model answer stored for it and the round's `To fix`, to read through before an interview. Part of
 * History — the app header marks it so, and History's rail is the way here — without the rail, since
 * it reads across rounds.
 *
 * A Server Component reading stored rows (07 §1); the page is the URL's, as History's list is paged
 * by cursor (07 §4). **It writes nothing and calls no model**, and no score is read for it.
 * Protected here as well as in the proxy (08 §5).
 */
export default async function StudyPage({ searchParams }: PageProps<"/history/study">) {
  const userId = await requireSession();
  const { before } = await searchParams;
  // A cursor this server did not mint is not a page of anything: a 404, never the first page in its place.
  const cursor = before === undefined ? null : typeof before === "string" ? decodeCursor(before) : null;
  if (before !== undefined && cursor === null) notFound();

  const page = await studyPage(getDb(), userId, cursor);
  // `Older rounds` is only offered when a round follows, so a cursor past the oldest was not followed from here.
  if (cursor !== null && page.rounds.length === 0) notFound();
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      <section className="flex flex-col border border-rule-frame bg-surface" aria-label={COPY.heading}>
        <AppHeader active="history" />
        <div className="flex items-baseline justify-between gap-[24px] px-[32px] py-[20px]">
          <div className="flex items-baseline gap-[18px]">
            <h1 className={sectionLabel}>{COPY.heading}</h1>
            <p className="text-[12px] text-ink-label">{COPY.purpose}</p>
          </div>
          <Link href="/history" className={`shrink-0 ${link}`}>
            {COPY.rounds}
          </Link>
        </div>
        {page.rounds.length === 0 ? (
          <div className="flex flex-col items-start gap-[10px] border-t border-rule-frame px-[32px] py-[24px]" data-testid="study-empty">
            <p className="text-[13px] leading-[1.75] text-ink-3">{COPY.empty}</p>
            <Link href="/round/new" className={link}>
              {COPY.start}
            </Link>
          </div>
        ) : null}
      </section>

      {page.rounds.map((round) => (
        <StudyRoundView key={round.id} round={round} />
      ))}

      <footer className="flex items-start justify-between gap-[40px] border border-rule-frame bg-surface px-[32px] py-[16px]">
        <div className="flex flex-col text-[12px] leading-[1.85] text-ink-6" data-testid="study-footer">
          {COPY.footer.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        {cursor !== null || page.older !== null ? (
          <nav aria-label={COPY.pages} className="flex shrink-0 gap-[24px] leading-[1.85]">
            {cursor !== null ? (
              <Link href="/history/study" className={link}>
                {COPY.newest}
              </Link>
            ) : null}
            {page.older !== null ? (
              <Link href={`/history/study?before=${encodeURIComponent(page.older)}`} className={link}>
                {COPY.older}
              </Link>
            ) : null}
          </nav>
        ) : null}
      </footer>
    </main>
  );
}
