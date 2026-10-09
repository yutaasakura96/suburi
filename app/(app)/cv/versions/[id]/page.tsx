import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { citedClaimIds } from "@/lib/cv/coverage";
import { cvVersionById } from "@/lib/cv/current-version";
import { getDb } from "@/lib/db";
import { AppHeader } from "../../../app-header";
import { COPY } from "../../copy";
import { toVersionView } from "../../load";
import { CvVersionView, sectionLabel } from "../../version-view";

export const metadata: Metadata = {
  title: "CV — Suburi",
};

/**
 * One CV version, read-only (10 §13): what a round was scored against, in the current-version view's
 * shape. No new-version action and nothing that makes it current (07 §6). Another user's version, or
 * no version, is a 404 (07 §1).
 */
export default async function CvVersionPage(props: PageProps<"/cv/versions/[id]">) {
  const userId = await requireSession();
  const { id } = await props.params;
  const db = getDb();
  const read = await cvVersionById(db, userId, id);
  if (!read) notFound();
  const cited = await citedClaimIds(db, read.version.id);

  const language = read.version.language;
  const copy = COPY[language];
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {/* The CV screen's own arrangement (10 §13): the app header in a card of its own, the version below. */}
      <div className="border-x border-t border-rule-frame bg-surface">
        <AppHeader active="cv" />
      </div>
      <div className="grid grid-cols-2 items-start gap-[14px]">
        <section lang={language} aria-labelledby="cv-version-heading" className="border border-rule-frame bg-surface">
          <div className="border-b border-rule-frame px-[32px] py-[20px]">
            <h2 id="cv-version-heading" className={sectionLabel}>
              <Link href="/cv" className="hover:text-ink-2 hover:underline">
                ← {copy.heading}
              </Link>
            </h2>
          </div>
          <div className="px-[32px] pt-[26px] pb-[32px]">
            <CvVersionView language={language} version={toVersionView(language, read, cited)} />
          </div>
        </section>
      </div>
    </main>
  );
}
