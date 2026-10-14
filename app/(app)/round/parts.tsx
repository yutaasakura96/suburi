import { useId } from "react";
import Link from "next/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FEEDBACK_READING, NO_ENGLISH_YET } from "./copy";
import type { ModelAnswerSegment } from "./load";

// No "use client": the round runner renders these on the client, the feedback page on the server.

export const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";
/**
 * 05 §3.3: `uppercase` is only ever set on Latin text. A Japanese section label is distinguished by
 * tracking and ink alone, so a Japanese round's labels take no transform.
 */
export function roundSectionLabel(language: "ja" | "en") {
  return language === "ja" ? "font-mono text-[11px] tracking-[0.16em] text-ink-label" : sectionLabel;
}
export const caption = "text-[12px] leading-[1.75] text-ink-6";
export const mono = "font-mono";
/** 10 §8: what was said and its model answer, as written — line breaks kept. */
export const answerText = "text-[13px] leading-[1.85] whitespace-pre-wrap";

/**
 * A stored model answer (10 §8), run by run: **an underline is a stored span of the stored text** —
 * what the round's CV version does not back. The caption under it says so in words, so the mark is
 * never colour alone.
 */
export function ModelAnswerText({ segments, lang }: { segments: readonly ModelAnswerSegment[]; lang: "ja" | "en" }) {
  return (
    <p className={`${answerText} text-ink-2`} lang={lang} data-testid="model-answer">
      {segments.map((segment, index) =>
        segment.unsupported ? (
          <span key={index} className="border-b border-attention-mark" data-testid="model-answer-unsupported">
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </p>
  );
}

/**
 * 05 §5.2: replaces the app header in a round — title and meta left, the stepper right. `pill` is
 * English help's one control (10 §15), first on the right, 18px before the stepper: given only for a
 * Japanese practice round. It names the language it switches to, in that language, and says whether
 * it is pressed.
 */
export function RoundHeader({
  title,
  meta,
  done,
  length,
  step,
  home,
  onHome,
  pill = null,
}: {
  title: string;
  meta: string;
  /** How many positions to draw as done. */
  done: number;
  length: number;
  step: string;
  home: string;
  onHome: React.MouseEventHandler<HTMLAnchorElement>;
  pill?: { readonly on: boolean; readonly onToggle: () => void } | null;
}) {
  const switchesTo = pill?.on ? "ja" : "en";
  return (
    <header className="flex items-baseline justify-between border-b border-rule-frame px-[32px] py-[20px]">
      <div className="flex items-baseline gap-[14px]">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <span className="text-[13px] text-ink-4">{meta}</span>
      </div>
      <div className="flex items-center gap-[20px]">
        <span className="flex items-center gap-[18px]">
          {pill ? (
            <button
              type="button"
              lang={switchesTo}
              aria-pressed={pill.on}
              onClick={pill.onToggle}
              className="border border-tick px-[10px] py-[4px] text-[11px] text-ink-4 hover:text-ink-1"
              data-testid="english-help-pill"
            >
              {FEEDBACK_READING[switchesTo]}
            </button>
          ) : null}
          <span className="flex items-center gap-[7px]" aria-hidden data-testid="round-stepper">
            {Array.from({ length }, (_, index) => (
              <span
                key={index}
                data-done={index < done}
                className={`h-[2px] w-[26px] ${index < done ? "bg-mark" : "bg-rule-section"}`}
              />
            ))}
          </span>
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-ink-label" data-testid="round-step">
          {step}
        </span>
        <Link href="/" onClick={onHome} className="text-[13px] text-link hover:text-link-hover hover:underline">
          {home}
        </Link>
      </div>
    </header>
  );
}

/**
 * English help's line under a prompt (10 §15): the stored English, `lang="en"`, or one line saying
 * there is none. `english` undefined draws nothing — the pill is off, or the round has none. Nothing
 * in it is a control, and the Japanese above it neither shrinks nor moves.
 */
export function PromptEnglish({ english, className }: { english: string | null | undefined; className: string }) {
  if (english === undefined) return null;
  if (english === null) {
    return (
      <p lang="en" className="text-[12px] text-ink-6" data-testid="prompt-english-none">
        {NO_ENGLISH_YET}
      </p>
    );
  }
  return (
    <p lang="en" className={className} data-testid="prompt-english">
      {english}
    </p>
  );
}

/** 05 §5.9, set on a record frame's footer line: a sentence left, the stamps right. */
export function RoundFooter({ sentence, stamp }: { sentence: string; stamp: string }) {
  return (
    <div className="flex items-baseline justify-between gap-[20px] border-t border-rule-section pt-[14px]">
      <span className="text-[12px] text-ink-6">{sentence}</span>
      <span className="font-mono text-[10px] text-ink-8" data-testid="round-stamp">
        {stamp}
      </span>
    </div>
  );
}

const RAIL = { attention: "bg-attention-mark", information: "bg-mark-mid", quiet: "bg-ink-9" } as const;

/**
 * 05 §5.8: a 3px full-height bar, gap 10px, 12px/1.7 --ink-3. `--attention-mark` for an unsupported
 * claim or a failure, `--accent-mid` for information, `--ink-9` (`quiet`) for merely unused material. `live`
 * announces it, for a message that appears in answer to something the user did; a finding that is
 * simply part of the page it loads with is not announced.
 */
export function CalloutRail({
  tone,
  live = true,
  children,
}: {
  tone: keyof typeof RAIL;
  live?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-[10px]" role={live ? (tone === "attention" ? "alert" : "status") : undefined}>
      <span aria-hidden className={`w-[3px] shrink-0 self-stretch ${RAIL[tone]}`} />
      <p className="text-[12px] leading-[1.7] text-ink-3">{children}</p>
    </div>
  );
}

/**
 * A chrome sentence that quotes stored text — the answer's words, a CV label — which keeps its own
 * language inside it (10 §15). `sentence` is the copy's function, given a placeholder for each quote;
 * each placeholder becomes the quote, marked with `lang`.
 */
export function Quoting<Args extends readonly string[]>({
  sentence,
  quotes,
  lang,
}: {
  sentence: (...quotes: Args) => string;
  quotes: Args;
  lang: "ja" | "en";
}) {
  const marks = quotes.map((_, index) => `\u{E000}${index}\u{E001}`) as unknown as Args;
  return sentence(...marks)
    .split(/(\u{E000}\d+\u{E001})/u)
    .map((part, index) => {
      const quote = /^\u{E000}(\d+)\u{E001}$/u.exec(part);
      return quote ? (
        <span key={index} lang={lang}>
          {quotes[Number(quote[1])]}
        </span>
      ) : (
        part
      );
    });
}

/** A failed call, said in the round's language, and how to make it again — null when it cannot be. */
export interface Failure {
  readonly text: string;
  readonly retry: (() => void) | null;
}

export function ErrorLine({ error, retryLabel }: { error: Failure | null; retryLabel: string }) {
  if (!error) return null;
  return (
    <div className="flex flex-col gap-[10px]">
      <CalloutRail tone="attention">{error.text}</CalloutRail>
      {error.retry ? (
        <button type="button" onClick={error.retry} className="self-start text-[13px] text-link hover:text-link-hover hover:underline">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/** A score at the low end takes the attention colour (05 §5.3): the sample's 2 does, its 3 does not. */
export const LOW_END = 2;

const scoreRow = "flex items-center gap-[18px] border-t border-rule-row py-[11px] last:border-b";

/**
 * 05 §5.3: the label, a 300px five-tick scale with the dot at the score, the numeral, and an empty
 * flex spacer — **empty by design** (05 §7: no prose beside a dimension). `value` null is an unscored
 * row: no dot, and the numeral column says why.
 *
 * **The reason is on demand, never ambient** (05 §7): a scored row that has a stored justification
 * shows it in 05 §5.4's tooltip when it is hovered or focused. The row is a tab stop so the keyboard
 * reaches it, and the same sentence is the row's description for a reader that cannot see the tooltip.
 */
export function ScoreRow({
  label,
  value,
  unscored,
  justification = null,
  justificationLang,
}: {
  label: string;
  value: number | null;
  unscored: string;
  /** What the scorer wrote for this dimension (04 `scores`), shown as stored. */
  justification?: string | null;
  /**
   * The round's language, which the justification is written in: marked where the row's own chrome
   * may be in another — English help's (06 Q106-6). The tooltip renders outside the row.
   */
  justificationLang?: "ja" | "en";
}) {
  const reason = useId();
  const cells = <ScoreCells label={label} value={value} unscored={unscored} />;
  if (value === null || !justification) {
    return (
      <div className={scoreRow} data-testid="score-row" data-dimension={label}>
        {cells}
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        delay={150}
        closeOnClick={false}
        render={<div tabIndex={0} role="group" aria-label={`${label} ${value}`} aria-describedby={reason} />}
        className={scoreRow}
        data-testid="score-row"
        data-dimension={label}
      >
        {cells}
        <span id={reason} className="sr-only" lang={justificationLang}>
          {justification}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[420px] text-[11px] leading-[1.7]" lang={justificationLang} data-testid="score-justification">
        {justification}
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreCells({ label, value, unscored }: { label: string; value: number | null; unscored: string }) {
  const low = value !== null && value <= LOW_END;
  return (
    <>
      {/* 05 §5.3 draws 100px for the Japanese labels; `Length and pacing` needs 120 to stay on one line. */}
      <span className="w-[120px] shrink-0 text-[13px] text-ink-3">{label}</span>
      <span className="relative grid h-[16px] w-[300px] shrink-0 grid-cols-5" aria-hidden>
        <span className="absolute inset-x-0 top-[7px] h-px bg-rule-axis" />
        {[1, 2, 3, 4, 5].map((point) => (
          <span key={point} className="relative flex items-center justify-center">
            {point === value ? (
              <span className={`size-[9px] rounded-full ${low ? "bg-attention-mark" : "bg-mark"}`} />
            ) : (
              <span className="h-[6px] w-px bg-tick" />
            )}
          </span>
        ))}
      </span>
      {value === null ? (
        <span className="text-[12px] text-ink-9" data-testid="score-unscored">
          {unscored}
        </span>
      ) : (
        <span
          className={`w-[12px] text-right font-mono text-[13px] ${low ? "font-medium text-attention-ink" : ""}`}
          data-testid="score-value"
        >
          {value}
        </span>
      )}
      <span className="flex-1" />
    </>
  );
}
