import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { currentCvVersion } from "@/lib/cv/current-version";
import { underlineSegments } from "@/lib/cv/segments";
import { getDb } from "@/lib/db";
import { EnglishPanel, type CurrentVersion } from "./english-panel";

export const metadata: Metadata = {
  title: "CV — Suburi",
};

// The date beside the stamp. The one user is in Japan, so a save at 08:00 reads as that day.
function tokyoDate(date: Date) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

async function loadEnglish(userId: string): Promise<CurrentVersion | null> {
  const current = await currentCvVersion(getDb(), userId, "en");
  if (!current) return null;
  const { version, documents, claims } = current;
  return {
    label: version.versionLabel,
    date: tokyoDate(version.createdAt),
    claimCount: claims.length,
    documents: documents.map((document) => ({
      id: document.id,
      heading: document.kind === "additional" ? (document.title ?? "") : "CV",
      segments: underlineSegments(version.body, document, claims),
    })),
  };
}

/**
 * The CV screen (10 §13). Two panels, 応募書類 left and CV right, each with chrome in its own
 * language. Only the English panel exists so far; the Japanese one is #15, and its column is held
 * empty so the English panel already sits where it will stay.
 */
export default async function CvPage() {
  const userId = await requireSession();
  const english = await loadEnglish(userId);

  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <div className="grid grid-cols-2 items-start gap-[14px]">
        <div />
        <EnglishPanel current={english} />
      </div>
    </main>
  );
}
