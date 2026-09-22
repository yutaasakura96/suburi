import type { currentCvVersion } from "@/lib/cv/current-version";
import { underlineSegments } from "@/lib/cv/segments";
import { sliceQuote } from "@/lib/cv/spans";
import { documentHeading, type CvLanguage, type Kind } from "./copy";
import type { VersionView } from "./version-view";

type Loaded = NonNullable<Awaited<ReturnType<typeof currentCvVersion>>>;

// The date beside the stamp. The one user is in Japan, so a save at 08:00 reads as that day.
export function tokyoDate(date: Date) {
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** A stored version as the read-only view renders it. Only spans leave the server, never claim text. */
export function toVersionView(language: CvLanguage, { version, documents, claims }: Loaded): VersionView {
  const spans = claims.map(({ start, end }) => ({ start, end }));
  return {
    label: version.versionLabel,
    date: tokyoDate(version.createdAt),
    claimCount: claims.length,
    documents: documents.map((document) => ({
      id: document.id,
      heading: documentHeading(language, document.kind, document.title),
      segments: underlineSegments(version.body, document, spans),
    })),
  };
}

/** The new-version form's starting point: the version's documents exactly as saved (10 §13). */
export function toPrefill({ version, documents }: Loaded) {
  return documents.map((document) => ({
    kind: document.kind as Kind,
    title: document.title ?? "",
    text: sliceQuote(version.body, document),
    sourceFilename: document.sourceFilename,
  }));
}
