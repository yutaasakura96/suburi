"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RoundCopy, RoundLanguage } from "../copy";
import { CalloutRail, RoundFooter, caption, roundSectionLabel } from "../parts";

/**
 * 10 §4–§5, when a take exists and the round cannot go on with it yet (03 §5, §8). Either it has not
 * reached S3 — it is **held**, the screen says where, and the one control sends it again — or it is
 * uploaded and **could not be transcribed**: the take is kept, and the answer is retried or typed
 * (07 §5.7–§5.8). Neither offers a new recording: the take is the answer.
 *
 * The question stays where the record frames set it, so nothing moves when a take gets stuck.
 */
export function StuckTakeFrame({
  copy,
  language,
  question,
  notices,
  busy,
  working,
  stamp,
  onRetry,
  onType,
}: {
  copy: RoundCopy;
  language: RoundLanguage;
  question: string;
  /** What happened, plainly: each its own rail. */
  notices: readonly string[];
  busy: boolean;
  /** What the call in flight is doing, said in place of the caption. */
  working: string;
  stamp: string;
  /** Null when no retry could succeed: the round takes no more writes, or the route refused the take. */
  onRetry: (() => void) | null;
  /** Set when typing is offered: transcription failed, or the take can never be uploaded. */
  onType: ((text: string) => void) | null;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const empty = text.trim() === "";

  return (
    <div className="flex flex-grow flex-col gap-[26px] px-[32px] pt-[36px] pb-[32px]">
      <div className="h-[18px]" />
      <p className="max-w-[880px] text-[19px] leading-[1.9] text-ink-2" data-testid="round-question">
        {question}
      </p>
      <div className="h-px bg-rule-row" />

      <div className="flex flex-col gap-[10px]" data-testid="take-notice">
        {notices.map((notice) => (
          <CalloutRail key={notice} tone="attention">
            {notice}
          </CalloutRail>
        ))}
      </div>
      <div className="flex items-center gap-[22px]">
        {onRetry ? (
          <Button variant="outline" onClick={onRetry} disabled={busy}>
            {copy.tryAgain}
          </Button>
        ) : null}
        {onType && !typing ? (
          <Button variant="outline" onClick={() => setTyping(true)} disabled={busy}>
            {copy.typeInstead}
          </Button>
        ) : null}
        {busy ? (
          <span className={caption} role="status">
            {working}
          </span>
        ) : null}
      </div>

      {onType && typing ? (
        <div className="flex max-w-[880px] flex-col gap-[12px]">
          <label htmlFor="typed-answer" className={roundSectionLabel(language)}>
            {copy.typedAnswer}
          </label>
          <textarea
            id="typed-answer"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-[200px] resize-none border border-rule-frame px-[18px] py-[16px] font-sans text-[15px] leading-[1.95] text-ink-1 outline-none"
          />
          <Button onClick={() => onType(text)} disabled={busy || empty} className="self-start">
            {copy.saveTyped}
          </Button>
          <p className={caption}>{copy.typedCaption}</p>
        </div>
      ) : null}

      <div className="flex-grow" />
      <RoundFooter sentence={copy.withheld} stamp={stamp} />
    </div>
  );
}
