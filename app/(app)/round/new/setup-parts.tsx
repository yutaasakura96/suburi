"use client";

import { MAX_POSTING_NAME_CHARS } from "@/lib/round/limits";
import type { PostingOption } from "../load";

// What Setup's posting form and research card share (10 §2).

/** §13's box, and the one-line inputs above it. */
export const field =
  "border border-rule-frame bg-surface px-[14px] py-[12px] font-mono text-[13px] leading-[1.9] text-ink-2 outline-none focus:border-ink-4";
export const lineInput = "border border-rule-frame bg-surface px-[12px] py-[9px] text-[14px] text-ink-1 outline-none focus:border-ink-4";
export const inert = "border-rule-section bg-surface-inert text-ink-8 opacity-100";

/** Cut at 200 code points as it is typed (07 §5.3) — not `maxlength`, which counts UTF-16 units. */
export const capPostingName = (value: string) => Array.from(value).slice(0, MAX_POSTING_NAME_CHARS).join("");

/** A saved role context as the client holds it once the save answered (07 §5.3's 201). */
export function savedOption(json: { id: string; company_name: string; role_title: string; source_filename: string | null; created_at: string }): PostingOption {
  return {
    id: json.id,
    companyName: json.company_name,
    roleTitle: json.role_title,
    sourceFilename: json.source_filename,
    date: new Date(json.created_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
    savedAt: json.created_at,
  };
}

/**
 * 05 §5.6's selection rail over the saved postings or researches, newest first. No edit, no delete: a
 * changed posting or research is a new one.
 */
export function SavedPicker({
  label,
  options,
  picked,
  onPick,
  testId,
}: {
  label: string;
  options: readonly PostingOption[];
  picked: string | null;
  onPick: (id: string) => void;
  testId: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-h-[352px] flex-col overflow-y-auto border-t border-rule-hairline">
      {options.map((option) => {
        const selected = option.id === picked;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(option.id)}
            data-testid={testId}
            className="flex shrink-0 items-center gap-[14px] border-b border-rule-hairline py-[11px] text-left"
          >
            <span aria-hidden className={`h-[34px] w-[2px] shrink-0 ${selected ? "bg-mark" : "bg-rule-row"}`} />
            <span className="flex min-w-0 flex-1 items-baseline gap-[12px]">
              <span className={`truncate text-[14px] ${selected ? "font-medium text-ink-1" : "text-ink-3"}`}>{option.companyName}</span>
              <span className="truncate text-[13px] text-ink-4">{option.roleTitle}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-[12px] font-mono text-[11px] text-ink-label">
              {option.sourceFilename ? <span className="max-w-[220px] truncate">{option.sourceFilename}</span> : null}
              <span>{option.date}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
