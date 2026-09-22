"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/api/errors";
import { ERROR_COPY } from "@/lib/copy/errors";
import { COPY, REQUIRED_KIND, type Copy, type CvLanguage, type Kind, type SaveResult } from "./copy";
import { CvVersionView, sectionLabel, type VersionView } from "./version-view";

type Prefill = readonly {
  readonly kind: Kind;
  readonly title: string;
  readonly text: string;
  readonly sourceFilename: string | null;
}[];

/** A panel with a current version: its view, the form's starting point, and every older version. */
export interface PanelData {
  readonly view: VersionView;
  readonly prefill: Prefill;
  readonly history: readonly { id: string; label: string; date: string; claimCount: number }[];
}

interface Draft {
  readonly key: number;
  readonly kind: Kind;
  readonly title: string;
  readonly text: string;
  readonly sourceFilename: string | null;
}

const MAX_ADDITIONAL = 5;

const caption = "text-[12px] leading-[1.7] text-ink-6";
const field =
  "border border-rule-frame bg-surface px-[14px] py-[12px] font-mono text-[13px] leading-[1.9] text-ink-2 outline-none focus:border-ink-4";

/** 05 §5.8: a 3px full-height bar, gap 10px, 12px/1.7 --ink-3. */
function CalloutRail({ tone, children }: { tone: "attention" | "information"; children: React.ReactNode }) {
  return (
    <div className="flex gap-[10px]" role={tone === "attention" ? "status" : undefined}>
      <span
        aria-hidden
        className={`w-[3px] shrink-0 self-stretch ${tone === "attention" ? "bg-attention-mark" : "bg-mark-mid"}`}
      />
      <p className="text-[12px] leading-[1.7] text-ink-3">{children}</p>
    </div>
  );
}

function SaveResultLine({ copy, result }: { copy: Copy; result: SaveResult }) {
  return (
    <div className="flex flex-col gap-[9px]">
      <p className={caption} role="status">
        {copy.result(result)}
      </p>
      {result.rejected > 0 ? <CalloutRail tone="attention">{copy.dropped(result.rejected)}</CalloutRail> : null}
    </div>
  );
}

/**
 * Older versions, newest first (10 §13): readable at their own page, never selectable. Nothing here
 * makes a version current or points a round at one (07 §6).
 */
function VersionHistory({ copy, history }: { copy: Copy; history: PanelData["history"] }) {
  if (history.length === 0) return null;
  return (
    <ul className="flex flex-col border-t border-rule-hairline" data-testid="cv-version-history">
      {history.map((row) => (
        <li key={row.id} className="border-b border-rule-hairline">
          <Link
            href={`/cv/versions/${row.id}`}
            className="flex gap-[14px] py-[9px] text-[12px] leading-[1.7] text-ink-6 hover:text-ink-2"
          >
            <span className="font-mono">{row.label}</span>
            <span className="font-mono">{row.date}</span>
            <span className="ml-auto font-mono">{copy.claims(row.claimCount)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// A text control, not a 05 §5.7 button: 05 draws no quiet variant, and a 48px outline beside every
// box would outweigh the box. Removing a document from an unsaved draft deletes nothing stored.
function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${sectionLabel} hover:text-ink-2 hover:underline`}>
      {label}
    </button>
  );
}

function DraftDocument({
  language,
  draft,
  onChange,
  onRemove,
}: {
  language: CvLanguage;
  draft: Draft;
  onChange: (next: Partial<Pick<Draft, "title" | "text">>) => void;
  onRemove: (() => void) | null;
}) {
  const copy = COPY[language];
  const heading = copy.kinds[draft.kind] ?? "";
  return (
    <div role="group" aria-label={heading} className="flex flex-col gap-[10px]">
      <div className="flex items-baseline justify-between gap-[14px]">
        {draft.kind === "additional" ? (
          <input
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            aria-label={copy.title}
            placeholder={copy.title}
            maxLength={200}
            className={`${field} flex-1 py-[6px]`}
          />
        ) : (
          <span className={sectionLabel}>{heading}</span>
        )}
        {onRemove ? <RemoveButton label={copy.remove} onClick={onRemove} /> : null}
      </div>
      {draft.kind === "rirekisho" && copy.particulars ? (
        <CalloutRail tone="information">{copy.particulars}</CalloutRail>
      ) : null}
      <textarea
        value={draft.text}
        onChange={(event) => onChange({ text: event.target.value })}
        aria-label={draft.kind === "additional" ? copy.text : heading}
        rows={draft.kind === "additional" ? 8 : 16}
        className={field}
      />
    </div>
  );
}

// Prefilled from the current version when there is one (10 §13): changing one document does not mean
// retyping the others. Without one, one empty required document.
function NewVersionForm({
  language,
  prefill,
  onSaved,
}: {
  language: CvLanguage;
  prefill: Prefill | null;
  onSaved: (result: SaveResult) => void;
}) {
  const copy = COPY[language];
  const nextKey = useRef(prefill?.length ?? 1);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    prefill
      ? prefill.map((document, key) => ({ key, ...document }))
      : [{ key: 0, kind: REQUIRED_KIND[language], title: "", text: "", sourceFilename: null }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);

  const additionalCount = drafts.filter((draft) => draft.kind === "additional").length;
  const hasShokumu = drafts.some((draft) => draft.kind === "shokumu_keirekisho");
  const complete = drafts.every(
    (draft) => draft.text.trim() !== "" && (draft.kind !== "additional" || draft.title.trim() !== ""),
  );

  function add(kind: "shokumu_keirekisho" | "additional") {
    const draft = { key: nextKey.current++, kind, title: "", text: "", sourceFilename: null };
    // 04's one order: the 職務経歴書 goes straight after the 履歴書, additional documents last.
    setDrafts((current) => (kind === "additional" ? [...current, draft] : [current[0], draft, ...current.slice(1)]));
  }

  function update(key: number, next: Partial<Pick<Draft, "title" | "text">>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...next } : draft)));
  }

  function remove(key: number) {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !complete) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/cv-versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          language,
          documents: drafts.map(({ kind, title, text, sourceFilename }) => ({
            kind,
            ...(kind === "additional" ? { title } : {}),
            ...(sourceFilename ? { source_filename: sourceFilename } : {}),
            text,
          })),
        }),
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
      {drafts.map((draft) => (
        <DraftDocument
          key={draft.key}
          language={language}
          draft={draft}
          onChange={(next) => update(draft.key, next)}
          onRemove={draft.kind === REQUIRED_KIND[language] ? null : () => remove(draft.key)}
        />
      ))}
      <div className="flex flex-wrap gap-[10px]">
        {copy.addShokumu && !hasShokumu ? (
          <Button type="button" variant="outline" onClick={() => add("shokumu_keirekisho")}>
            {copy.addShokumu}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={additionalCount >= MAX_ADDITIONAL}
          onClick={() => add("additional")}
        >
          {copy.addAdditional}
        </Button>
      </div>
      <div className="flex flex-col gap-[12px]">
        <Button type="submit" className="w-full" disabled={saving || !complete}>
          {copy.save}
        </Button>
        <p className={caption}>{saving ? copy.saving : copy.commits}</p>
        {error ? <CalloutRail tone="attention">{ERROR_COPY[error][language]}</CalloutRail> : null}
      </div>
    </form>
  );
}

/**
 * One language's CV panel (10 §13): 応募書類 or CV, chrome in that language whatever the rest of the
 * app decides. Empty → one action. Saving → the server derives every stamp; this sends text and
 * structure only, in the one order the server accepts.
 */
export function CvPanel({ language, data }: { language: CvLanguage; data: PanelData | null }) {
  const copy = COPY[language];
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);

  function saved(next: SaveResult) {
    setResult(next);
    setEditing(false);
    router.refresh();
  }

  const headingId = `cv-${language}-heading`;
  return (
    <section lang={language} aria-labelledby={headingId} className="border border-rule-frame bg-surface">
      <div className="border-b border-rule-frame px-[32px] py-[20px]">
        <h2 id={headingId} className={sectionLabel}>
          {copy.heading}
        </h2>
      </div>
      <div className="flex flex-col gap-[22px] px-[32px] pt-[26px] pb-[32px]">
        {result ? <SaveResultLine copy={copy} result={result} /> : null}
        {editing ? (
          <NewVersionForm language={language} prefill={data?.prefill ?? null} onSaved={saved} />
        ) : data ? (
          <>
            <CvVersionView language={language} version={data.view} />
            <Button variant="outline" className="self-start" onClick={() => setEditing(true)}>
              {copy.newVersion}
            </Button>
            <VersionHistory copy={copy} history={data.history} />
          </>
        ) : (
          <div className="flex flex-col gap-[12px]">
            <Button variant="outline" className="self-start" onClick={() => setEditing(true)}>
              {copy.start}
            </Button>
            <p className={caption}>{copy.requires}</p>
          </div>
        )}
      </div>
    </section>
  );
}
