import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { currentCvVersion } from "@/lib/cv/current-version";
import { underlineSegments } from "@/lib/cv/segments";
import { getDb } from "@/lib/db";
import { documentHeading, type CvLanguage } from "./copy";
import { CvPanel, type CurrentVersion } from "./cv-panel";

export const metadata: Metadata = {
  title: "CV — Suburi",
};

// The date beside the stamp. The one user is in Japan, so a save at 08:00 reads as that day.
function tokyoDate(date: Date) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

async function load(userId: string, language: CvLanguage): Promise<CurrentVersion | null> {
  const current = await currentCvVersion(getDb(), userId, language);
  if (!current) return null;
  const { version, documents, claims } = current;
  return {
    label: version.versionLabel,
    date: tokyoDate(version.createdAt),
    claimCount: claims.length,
    documents: documents.map((document) => ({
      id: document.id,
      heading: documentHeading(language, document.kind, document.title),
      segments: underlineSegments(version.body, document, claims),
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
        <CvPanel language="ja" current={japanese} />
        <CvPanel language="en" current={english} />
      </div>
    </main>
  );
}
