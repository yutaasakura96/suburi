import type { Segment } from "@/lib/cv/segments";
import { COPY, type CvLanguage } from "./copy";

// No "use client": the panel renders this on the client, the version page on the server.

export interface VersionView {
  readonly label: string;
  readonly date: string;
  readonly claimCount: number;
  /** How many of them have never been cited, by this version or any it carried a claim forward from. */
  readonly unusedCount: number;
  readonly documents: readonly { id: string; heading: string; segments: readonly Segment[] }[];
}

export const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";

/**
 * One CV version, read-only: stamp top-left, claim count, each document with its claims underlined
 * (10 §13). **Coverage is the weight of the underline**: a claim an answer has cited takes 2px of
 * `--accent`, one never cited keeps the 1px `--accent-mid` every claim had before citations existed.
 * The count and the legend say the same in words, so the mark is never colour alone.
 */
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
          {COPY[language].coverage(version.claimCount, version.unusedCount)}
        </p>
      </div>
      <p className="text-[12px] leading-[1.7] text-ink-6" data-testid="cv-coverage-legend">
        {COPY[language].coverageLegend}
      </p>
      {version.documents.map((document) => (
        <section key={document.id} className="flex flex-col gap-[10px]">
          <h3 className={sectionLabel}>{document.heading}</h3>
          <p className="text-[13px] leading-[1.9] whitespace-pre-wrap text-ink-2">
            {document.segments.map((segment, index) =>
              segment.claim ? (
                <span
                  key={index}
                  data-claim={segment.used ? "used" : "unused"}
                  className={segment.used ? "border-b-2 border-mark" : "border-b border-mark-mid"}
                >
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
