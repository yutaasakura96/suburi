"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/api/errors";
import { ERROR_COPY } from "@/lib/copy/errors";
import type { Segment } from "@/lib/cv/segments";

export interface CurrentVersion {
  readonly label: string;
  readonly date: string;
  readonly claimCount: number;
  readonly documents: readonly { id: string; heading: string; segments: readonly Segment[] }[];
}

interface SaveResult {
  readonly total: number;
  readonly carriedForward: number;
  readonly fresh: number;
  readonly rejected: number;
}

const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";
const caption = "text-[12px] leading-[1.7] text-ink-6";

function claims(n: number) {
  return `${n} ${n === 1 ? "claim" : "claims"}`;
}

/** 05 §5.8: a 3px full-height bar, gap 10px, 12px/1.7 --ink-3. */
function CalloutRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-[10px]" role="status">
      <span aria-hidden className="w-[3px] shrink-0 self-stretch bg-attention-mark" />
      <p className="text-[12px] leading-[1.7] text-ink-3">{children}</p>
    </div>
  );
}

function SaveResultLine({ result }: { result: SaveResult }) {
  return (
    <div className="flex flex-col gap-[9px]">
      <p className={caption} role="status">
        {`${claims(result.total)} extracted — ${result.carriedForward} carried forward, ${result.fresh} new. ${result.rejected} dropped.`}
      </p>
      {result.rejected > 0 ? (
        <CalloutRail>
          {`${claims(result.rejected)} ${result.rejected === 1 ? "was" : "were"} dropped — their quotes did not match your text.`}
        </CalloutRail>
      ) : null}
    </div>
  );
}

function CurrentVersionView({ current }: { current: CurrentVersion }) {
  return (
    <div className="flex flex-col gap-[22px]">
      {/* 05 §5.9, top-left here: it labels the thing being read (10 §13). */}
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] leading-[1.9] text-ink-8">
          <span data-testid="cv-version-label">{current.label}</span>
          <span className="ml-[10px]">{current.date}</span>
        </p>
        <p className="font-mono text-[11px] text-ink-label" data-testid="cv-claim-count">
          {claims(current.claimCount)}
        </p>
      </div>
      {current.documents.map((document) => (
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

function NewVersionForm({ onSaved }: { onSaved: (result: SaveResult) => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/cv-versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: "en", documents: [{ kind: "cv", text }] }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error?.code in ERROR_COPY ? json.error.code : "cv_extraction_failed");
        return;
      }
      onSaved({
        total: json.claims.total,
        carriedForward: json.claims.carried_forward,
        fresh: json.claims.new,
        rejected: json.validation.spans_rejected,
      });
    } catch {
      setError("cv_extraction_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-[22px]">
      <label className="flex flex-col gap-[10px]">
        <span className={sectionLabel}>CV</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={16}
          className="border border-rule-frame bg-surface px-[14px] py-[12px] font-mono text-[13px] leading-[1.9] text-ink-2 outline-none focus:border-ink-4"
        />
      </label>
      <div className="flex flex-col gap-[12px]">
        <Button type="submit" className="w-full" disabled={saving || text.trim() === ""}>
          Save this version
        </Button>
        <p className={caption}>
          {saving
            ? "Extracting claims from your CV. This can take a while."
            : "Saving fixes this version as it is. It cannot be edited afterwards."}
        </p>
        {error ? <CalloutRail>{ERROR_COPY[error].en}</CalloutRail> : null}
      </div>
    </form>
  );
}

/**
 * The English CV panel (10 §13): its chrome is English whatever the rest of the app decides.
 * Empty → one action. Saving → the server derives every stamp; this sends text and structure only.
 */
export function EnglishPanel({ current }: { current: CurrentVersion | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  function saved(next: SaveResult) {
    setResult(next);
    setEditing(false);
    router.refresh();
  }

  return (
    <section lang="en" aria-labelledby="cv-en-heading" className="border border-rule-frame bg-surface">
      <div className="border-b border-rule-frame px-[32px] py-[20px]">
        <h2 id="cv-en-heading" className={sectionLabel}>
          CV
        </h2>
      </div>
      <div className="flex flex-col gap-[22px] px-[32px] pt-[26px] pb-[32px]">
        {result ? <SaveResultLine result={result} /> : null}
        {editing ? (
          <NewVersionForm onSaved={saved} />
        ) : current ? (
          <CurrentVersionView current={current} />
        ) : (
          <div className="flex flex-col gap-[12px]">
            <Button variant="outline" className="self-start" onClick={() => setEditing(true)}>
              Add your CV
            </Button>
            <p className={caption}>
              One CV document is required. You can add up to five supporting documents.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
