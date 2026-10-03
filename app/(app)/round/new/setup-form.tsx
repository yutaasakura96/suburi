"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImportControl, TextButton } from "@/components/import-control";
import { Button } from "@/components/ui/button";
import type { ImportResult } from "@/lib/cv/import/extract";
import { characterLength } from "@/lib/cv/spans";
import { bankSupply, type BankCounts } from "@/lib/round/bank-supply";
import { MAX_POSTING_CHARS, MAX_POSTING_NAME_CHARS, MAX_SOURCE_FILENAME_CHARS } from "@/lib/round/limits";
import { failureText, postJson, type FailureCode } from "../api";
import { ROUND_LENGTHS, ROUND_TYPE_NAMES, ROUND_TYPES, SETUP_COPY as COPY, type RoundType } from "../copy";
import type { PostingOption } from "../load";
import { CalloutRail, caption, sectionLabel } from "../parts";

/** The realistic cap, in minutes: the estimate's multiplier (10 §2). The server holds the value. */
const REALISTIC_CAP_MINUTES = 4;

/** §13's box, and the one-line inputs above it. */
const field =
  "border border-rule-frame bg-surface px-[14px] py-[12px] font-mono text-[13px] leading-[1.9] text-ink-2 outline-none focus:border-ink-4";
const lineInput = "border border-rule-frame bg-surface px-[12px] py-[9px] text-[14px] text-ink-1 outline-none focus:border-ink-4";
const inert = "border-rule-section bg-surface-inert text-ink-8 opacity-100";

/** 10 §2: tab-style options, 15px, the selected one at 500 over a 2px accent underline. */
function Options<T extends string | number>({
  label,
  options,
  value,
  name,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  name: (option: T) => string;
  onChange?: (option: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-[14px]">
      <legend className={`${sectionLabel} mb-[14px]`}>{label}</legend>
      <div className="flex gap-[28px]" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange?.(option)}
              className={`pb-[7px] text-[15px] ${
                selected ? "border-b-2 border-mark font-medium text-ink-1" : "border-b border-rule-section text-ink-5 hover:text-ink-2"
              }`}
            >
              {name(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One of the two equal cards (10 §2): a title over a detail, underlined like an option. */
function ContextCard({ title, detail, selected, onSelect }: { title: string; detail: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-[4px] pb-[7px] text-left ${selected ? "border-b-2 border-mark" : "border-b border-rule-section"}`}
    >
      <span className={`text-[14px] ${selected ? "font-medium text-ink-1" : "text-ink-5"}`}>{title}</span>
      <span className="truncate text-[12px] leading-[1.7] text-ink-6" data-testid="context-card-detail">
        {detail}
      </span>
    </button>
  );
}

type ImportState = "imported" | "no_text" | "unreadable" | null;

const capPostingName = (value: string) => Array.from(value).slice(0, MAX_POSTING_NAME_CHARS).join("");

/**
 * The add form (10 §2). A posting is pasted, or imported into the box by the CV screen's importer:
 * the text is extracted in the browser, stays editable, and only it and the file's name are sent
 * (07 §5.3). Saved postings are immutable, so the button says what saving fixes.
 */
function PostingForm({ onSaved, onCancel }: { onSaved: (posting: PostingOption) => void; onCancel: (() => void) | null }) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceFilename, setSourceFilename] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportState>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<FailureCode | null>(null);

  const chars = characterLength(text.trim());
  const over = chars > MAX_POSTING_CHARS;
  const complete = company.trim() !== "" && title.trim() !== "" && chars > 0;

  function importResult(result: ImportResult, name: string) {
    if (savingRef.current) return;
    if (!result.ok) {
      // A failed import leaves the box as it was.
      setImported(result.reason);
      return;
    }
    setText(result.text);
    setSourceFilename(Array.from(name).slice(0, MAX_SOURCE_FILENAME_CHARS).join(""));
    setImported("imported");
  }

  function edited(next: string) {
    setText(next);
    // An emptied box is no longer that file's text.
    if (next.trim() === "") setSourceFilename(null);
  }

  async function save() {
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const saved = await postJson<{ id: string; company_name: string; role_title: string; source_filename: string | null; created_at: string }>(
      "/api/role-contexts",
      { kind: "posting", company_name: company, role_title: title, body: text, ...(sourceFilename ? { source_filename: sourceFilename } : {}) },
    );
    if (!saved.ok) {
      savingRef.current = false;
      setSaving(false);
      setError(saved.code);
      return;
    }
    onSaved({
      id: saved.json.id,
      companyName: saved.json.company_name,
      roleTitle: saved.json.role_title,
      sourceFilename: saved.json.source_filename,
      date: new Date(saved.json.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    });
  }

  return (
    <div role="group" aria-label={COPY.addPosting} className="flex flex-col gap-[16px]" data-testid="posting-form">
      <div className="grid grid-cols-2 gap-[24px]">
        <label className="flex flex-col gap-[8px]">
          <span className={sectionLabel}>{COPY.company}</span>
          <input value={company} onChange={(event) => setCompany(capPostingName(event.target.value))} disabled={saving} className={lineInput} />
        </label>
        <label className="flex flex-col gap-[8px]">
          <span className={sectionLabel}>{COPY.roleTitle}</span>
          <input value={title} onChange={(event) => setTitle(capPostingName(event.target.value))} disabled={saving} className={lineInput} />
        </label>
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="flex items-baseline justify-between gap-[14px]">
          <label htmlFor="posting-text" className={sectionLabel}>
            {COPY.postingText}
          </label>
          <ImportControl label={COPY.importFile} onResult={importResult} disabled={saving} />
        </div>
        <textarea id="posting-text" value={text} onChange={(event) => edited(event.target.value)} disabled={saving} rows={8} className={`${field} resize-y`} />
        <p
          className={`text-right font-mono text-[11px] ${over ? "font-medium text-attention-ink" : "text-ink-label"}`}
          data-testid="posting-count"
          data-over={over}
        >
          {COPY.postingCount(chars, MAX_POSTING_CHARS)}
        </p>
        {imported === "imported" ? <p className={caption}>{COPY.imported}</p> : null}
        {imported === "no_text" ? <CalloutRail tone="attention">{COPY.importNoText}</CalloutRail> : null}
        {imported === "unreadable" ? <CalloutRail tone="attention">{COPY.importUnreadable}</CalloutRail> : null}
      </div>

      {error ? <CalloutRail tone="attention">{failureText(error, "en")}</CalloutRail> : null}
      <div className="flex items-center gap-[20px]">
        <Button variant="outline" onClick={save} disabled={!complete || over || saving} className={complete && !over ? "" : inert}>
          {COPY.savePosting}
        </Button>
        {onCancel ? <TextButton label={COPY.cancel} onClick={onCancel} disabled={saving} /> : null}
      </div>
      <p className={caption}>{saving ? COPY.savingPosting : COPY.savePostingCommits}</p>
    </div>
  );
}

/** 05 §5.6's selection rail over the saved postings, newest first. No edit, no delete: a changed posting is a new one. */
function PostingPicker({ postings, picked, onPick }: { postings: readonly PostingOption[]; picked: string | null; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label={COPY.savedPostings} className="flex max-h-[352px] flex-col overflow-y-auto border-t border-rule-hairline">
      {postings.map((posting) => {
        const selected = posting.id === picked;
        return (
          <button
            key={posting.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(posting.id)}
            data-testid="posting-row"
            className="flex shrink-0 items-center gap-[14px] border-b border-rule-hairline py-[11px] text-left"
          >
            <span aria-hidden className={`h-[34px] w-[2px] shrink-0 ${selected ? "bg-mark" : "bg-rule-row"}`} />
            <span className="flex min-w-0 flex-1 items-baseline gap-[12px]">
              <span className={`truncate text-[14px] ${selected ? "font-medium text-ink-1" : "text-ink-3"}`}>{posting.companyName}</span>
              <span className="truncate text-[13px] text-ink-4">{posting.roleTitle}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-[12px] font-mono text-[11px] text-ink-label">
              {posting.sourceFilename ? <span className="max-w-[220px] truncate">{posting.sourceFilename}</span> : null}
              <span>{posting.date}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

type ContextKind = "posting" | "general";

export function SetupForm({
  cv,
  rubricLabel,
  postings: savedPostings,
  bank,
}: {
  cv: { label: string; date: string } | null;
  rubricLabel: string | null;
  postings: readonly PostingOption[];
  bank: Readonly<Record<RoundType, BankCounts>>;
}) {
  const router = useRouter();
  const [roundType, setRoundType] = useState<RoundType>("hr");
  const [length, setLength] = useState<(typeof ROUND_LENGTHS)[number]>(3);
  const [postings, setPostings] = useState(savedPostings);
  // General practice is never the silent default (10 §2): nothing is chosen until the user chooses,
  // unless a posting was saved before, in which case the newest is.
  const [kind, setKind] = useState<ContextKind | null>(savedPostings.length > 0 ? "posting" : null);
  const [postingId, setPostingId] = useState<string | null>(savedPostings[0]?.id ?? null);
  const [adding, setAdding] = useState(savedPostings.length === 0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);

  const posting = postings.find((option) => option.id === postingId) ?? null;
  const contextChosen = kind === "general" || (kind === "posting" && posting !== null);
  const ready = cv !== null && rubricLabel !== null && contextChosen;

  // The questions the bank gives this round without generating (07 §5.4); fewer than its length is
  // the bank-exhausted warning, on screen before the round starts.
  const supply = bankSupply(bank[roundType], "realistic");
  const generates = supply < length;

  async function start() {
    setStarting(true);
    setError(null);
    const context: { ok: true; id: string } | { ok: false; code: FailureCode } =
      kind === "posting" && posting
        ? { ok: true, id: posting.id }
        : await postJson<{ id: string }>("/api/role-contexts", { kind: "general" }).then((result) =>
            result.ok ? { ok: true as const, id: result.json.id } : { ok: false as const, code: result.code },
          );
    const created = context.ok
      ? await postJson<{ round: { id: string } }>("/api/rounds", {
          round_type: roundType,
          language: "en",
          mode: "realistic",
          length,
          role_context_id: context.id,
        })
      : context;
    if (created.ok) {
      router.push(`/round/${created.json.round.id}`);
      return;
    }
    setError(created.code);
    setStarting(false);
  }

  function saved(option: PostingOption) {
    setPostings((current) => [option, ...current]);
    setPostingId(option.id);
    setAdding(false);
  }

  const startCaption = starting ? (generates ? COPY.startingGenerating : COPY.starting) : contextChosen ? COPY.commits : COPY.chooseRoleContext;

  return (
    <section className="border border-rule-frame bg-surface" aria-label={COPY.heading}>
      <header className="border-b border-rule-frame px-[32px] py-[20px]">
        <h1 className="text-[17px] font-semibold">{COPY.heading}</h1>
      </header>
      <div className="grid grid-cols-3">
        <div className="col-span-2 flex flex-col gap-[28px] border-r border-rule-frame px-[32px] py-[30px]">
          <Options label={COPY.roundType} options={ROUND_TYPES} value={roundType} name={(t) => ROUND_TYPE_NAMES[t]} onChange={setRoundType} />
          <div className="flex flex-col gap-[10px]">
            <Options label={COPY.language} options={["en"] as const} value="en" name={() => COPY.english} />
            <p className={caption}>{COPY.englishOnly}</p>
          </div>
          <Options label={COPY.length} options={ROUND_LENGTHS} value={length} name={COPY.lengthOption} onChange={setLength} />
          <div className="flex flex-col gap-[10px]">
            <Options label={COPY.mode} options={["realistic"] as const} value="realistic" name={() => COPY.realistic} />
            <p className="text-[12px] leading-[1.75] text-ink-3">{COPY.realisticExplained}</p>
          </div>

          <fieldset className="flex flex-col gap-[18px]">
            <legend className="mb-[14px] flex items-baseline gap-[12px]">
              <span className={sectionLabel}>{COPY.roleContext}</span>
              <span className="text-[12px] text-ink-6">{COPY.roleContextRequired}</span>
            </legend>
            <div className="grid grid-cols-2 gap-[24px]" role="radiogroup" aria-label={COPY.roleContext}>
              <ContextCard
                title={COPY.posting}
                detail={posting ? (posting.sourceFilename ?? COPY.postingPasted) : COPY.postingNone}
                selected={kind === "posting"}
                onSelect={() => setKind("posting")}
              />
              <ContextCard title={COPY.general} detail={COPY.generalDetail} selected={kind === "general"} onSelect={() => setKind("general")} />
            </div>

            {kind === "posting" ? (
              <div className="flex flex-col gap-[16px]">
                {postings.length > 0 ? <PostingPicker postings={postings} picked={postingId} onPick={setPostingId} /> : null}
                {adding ? (
                  <PostingForm onSaved={saved} onCancel={postings.length > 0 ? () => setAdding(false) : null} />
                ) : (
                  <div>
                    <TextButton label={COPY.addPosting} onClick={() => setAdding(true)} />
                  </div>
                )}
              </div>
            ) : null}
          </fieldset>
        </div>

        <div className="flex flex-col gap-[22px] px-[32px] py-[30px]">
          <div className="flex flex-col gap-[10px]">
            <p className={sectionLabel}>{COPY.scoredAgainst}</p>
            {cv ? (
              <p className="flex items-baseline gap-[10px]" data-testid="setup-cv">
                <span className="text-[15px]">{cv.label}</span>
                <span className="font-mono text-[12px] text-ink-label">{cv.date}</span>
              </p>
            ) : (
              <CalloutRail tone="attention">
                {COPY.noCv}{" "}
                <Link href="/cv" className="text-link hover:text-link-hover hover:underline">
                  {COPY.noCvLink}
                </Link>
              </CalloutRail>
            )}
            {cv && rubricLabel === null ? <CalloutRail tone="attention">{COPY.noRubric}</CalloutRail> : null}
          </div>

          <div className="mt-auto flex flex-col gap-[10px]">
            {generates ? (
              <div data-testid="bank-exhausted">
                <CalloutRail tone="information">{COPY.bankExhausted(ROUND_TYPE_NAMES[roundType], supply, length)}</CalloutRail>
              </div>
            ) : null}
            {error ? <CalloutRail tone="attention">{failureText(error, "en")}</CalloutRail> : null}
            <Button onClick={start} disabled={!ready || starting} className={ready ? "" : inert}>
              {COPY.start}
            </Button>
            <p className={caption} data-testid="setup-caption">
              {startCaption}
            </p>
            <p className="font-mono text-[11px] leading-[1.9] text-ink-label" data-testid="setup-estimate">
              {COPY.estimate(length, REALISTIC_CAP_MINUTES)}
              {rubricLabel ? (
                <>
                  <br />
                  {COPY.rubricStamp(rubricLabel)}
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
