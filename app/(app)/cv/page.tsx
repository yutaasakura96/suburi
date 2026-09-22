import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { currentCvVersion, cvVersionHistory } from "@/lib/cv/current-version";
import { getDb } from "@/lib/db";
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
    view: toVersionView(language, current),
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
    <main className="w-[1280px] px-[44px] py-[40px]">
      <div className="grid grid-cols-2 items-start gap-[14px]">
        <CvPanel language="ja" data={japanese} />
        <CvPanel language="en" data={english} />
      </div>
    </main>
  );
}
