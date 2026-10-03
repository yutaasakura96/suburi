"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { failureText, postJson, type FailureCode } from "../api";
import {
  LANGUAGE_NAMES,
  ROUND_LANGUAGES,
  ROUND_LENGTHS,
  ROUND_TYPE_NAMES,
  ROUND_TYPES,
  SETUP_COPY as COPY,
  type RoundLanguage,
  type RoundType,
} from "../copy";
import { CalloutRail, caption, sectionLabel } from "../parts";

/** The realistic cap, in minutes: the estimate's multiplier (10 §2). The server holds the value. */
const REALISTIC_CAP_MINUTES = 4;

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

export interface SetupFacts {
  readonly cv: { readonly label: string; readonly date: string } | null;
  readonly rubricLabel: string | null;
}

export function SetupForm({ facts }: { facts: Record<RoundLanguage, SetupFacts> }) {
  const router = useRouter();
  const [roundType, setRoundType] = useState<RoundType>("hr");
  const [language, setLanguage] = useState<RoundLanguage>("en");
  const [length, setLength] = useState<(typeof ROUND_LENGTHS)[number]>(3);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);

  // What the chosen language's round would be scored against (10 §2, `SCORED AGAINST`).
  const { cv, rubricLabel } = facts[language];
  const ready = cv !== null && rubricLabel !== null;

  async function start() {
    setStarting(true);
    setError(null);
    const context = await postJson<{ id: string }>("/api/role-contexts", { kind: "general" });
    const created = context.ok
      ? await postJson<{ round: { id: string } }>("/api/rounds", {
          round_type: roundType,
          language,
          mode: "realistic",
          length,
          role_context_id: context.json.id,
        })
      : context;
    if (created.ok) {
      router.push(`/round/${created.json.round.id}`);
      return;
    }
    setError(created.code);
    setStarting(false);
  }

  return (
    <section className="border border-rule-frame bg-surface" aria-label={COPY.heading}>
      <header className="border-b border-rule-frame px-[32px] py-[20px]">
        <h1 className="text-[17px] font-semibold">{COPY.heading}</h1>
      </header>
      <div className="grid grid-cols-3">
        <div className="col-span-2 flex flex-col gap-[28px] border-r border-rule-frame px-[32px] py-[30px]">
          <Options label={COPY.roundType} options={ROUND_TYPES} value={roundType} name={(t) => ROUND_TYPE_NAMES[t]} onChange={setRoundType} />
          <Options label={COPY.language} options={ROUND_LANGUAGES} value={language} name={(l) => LANGUAGE_NAMES[l]} onChange={setLanguage} />
          <Options label={COPY.length} options={ROUND_LENGTHS} value={length} name={COPY.lengthOption} onChange={setLength} />
          <div className="flex flex-col gap-[10px]">
            <Options label={COPY.mode} options={["realistic"] as const} value="realistic" name={() => COPY.realistic} />
            <p className="text-[12px] leading-[1.75] text-ink-3">{COPY.realisticExplained}</p>
          </div>
          <fieldset className="flex flex-col gap-[14px]">
            <legend className={`${sectionLabel} mb-[14px]`}>{COPY.roleContext}</legend>
            <div className="grid grid-cols-2 gap-[24px]">
              <div className="flex flex-col gap-[4px] border-b-2 border-mark pb-[7px]" aria-current="true">
                <span className="text-[14px] font-medium">{COPY.general}</span>
                <span className="text-[12px] leading-[1.7] text-ink-6">{COPY.generalDetail}</span>
              </div>
            </div>
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
                {COPY.noCv(language)}{" "}
                <Link href="/cv" className="text-link hover:text-link-hover hover:underline">
                  {COPY.noCvLink}
                </Link>
              </CalloutRail>
            )}
            {cv && rubricLabel === null ? <CalloutRail tone="attention">{COPY.noRubric(language)}</CalloutRail> : null}
          </div>

          <div className="mt-auto flex flex-col gap-[10px]">
            {error ? <CalloutRail tone="attention">{failureText(error, "en")}</CalloutRail> : null}
            <Button
              onClick={start}
              disabled={!ready || starting}
              className={ready ? "" : "border-rule-section bg-surface-inert text-ink-8 opacity-100"}
            >
              {COPY.start}
            </Button>
            <p className={caption}>{starting ? COPY.starting : COPY.commits}</p>
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
