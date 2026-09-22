import type { Segment } from "@/lib/cv/segments";
import { COPY, type CvLanguage } from "./copy";

// No "use client": the panel renders this on the client, the version page on the server.

export interface VersionView {
  readonly label: string;
  readonly date: string;
  readonly claimCount: number;
  readonly documents: readonly { id: string; heading: string; segments: readonly Segment[] }[];
}

export const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";

/** One CV version, read-only: stamp top-left, claim count, each document with its claims underlined (10 §13). */
export function CvVersionView({ language, version }: { language: CvLanguage; version: VersionView }) {
  return (
    <div className="flex flex-col gap-[22px]">
      {/* 05 §5.9, top-left here: it labels the thing being read (10 §13). */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] leading-[1.9] text-ink-8">
          <span data-testid="cv-version-label">{version.label}</span>
          <span className="ml-[10px]">{version.date}</span>
        </p>
        <p className="font-mono text-[11px] text-ink-label" data-testid="cv-claim-count">
          {COPY[language].claims(version.claimCount)}
        </p>
      </div>
      {version.documents.map((document) => (
        <section key={document.id} className="flex flex-col gap-[10px]">
          <h3 className={sectionLabel}>{document.heading}</h3>
          <p className="text-[13px] leading-[1.9] whitespace-pre-wrap text-ink-2">
            {document.segments.map((segment, index) =>
              segment.claim ? (
                <span key={index} data-claim className="border-b border-mark-mid">
                  {segment.text}
                </span>
              ) : (
                segment.text
              ),
            )}
          </p>
        </section>
      ))}
    </div>
  );
}
