import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { citedClaimIds } from "@/lib/cv/coverage";
import { currentCvVersion, cvVersionHistory } from "@/lib/cv/current-version";
import { getDb } from "@/lib/db";
import { AppHeader } from "../app-header";
import type { CvLanguage } from "./copy";
import { CvPanel, type PanelData } from "./cv-panel";
import { toPrefill, toVersionView, tokyoDate } from "./load";

export const metadata: Metadata = {
  title: "CV — Suburi",
};

async function load(userId: string, language: CvLanguage): Promise<PanelData | null> {
  const db = getDb();
  const [current, history] = await Promise.all([
    currentCvVersion(db, userId, language),
    cvVersionHistory(db, userId, language),
  ]);
  if (!current) return null;
  return {
    view: toVersionView(language, current, await citedClaimIds(db, current.version.id)),
    prefill: toPrefill(current),
    history: history.map((row) => ({
      id: row.id,
      label: row.versionLabel,
      date: tokyoDate(row.createdAt),
      claimCount: row.claimCount,
    })),
  };
}

/**
 * The CV screen (10 §13). Two panels, 応募書類 left and CV right, each with chrome in its own
 * language. Independent: either may be empty while the other is not.
 */
export default async function CvPage() {
  const userId = await requireSession();
  const [japanese, english] = await Promise.all([load(userId, "ja"), load(userId, "en")]);

  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {/* 05 §5.1's header, in a card of its own: the two panels below are each a card (10 §13). */}
      <div className="border-x border-t border-rule-frame bg-surface">
        <AppHeader active="cv" />
      </div>
      <div className="grid grid-cols-2 items-start gap-[14px]">
        <CvPanel language="ja" data={japanese} />
        <CvPanel language="en" data={english} />
      </div>
    </main>
  );
}
