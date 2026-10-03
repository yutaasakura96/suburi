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

/** 05 §5.2: replaces the app header in a round — title and meta left, the stepper right. No way out. */
export function RoundHeader({
  title,
  meta,
  done,
  length,
  step,
}: {
  title: string;
  meta: string;
  /** How many positions to draw as done. */
  done: number;
  length: number;
  step: string;
}) {
  return (
    <header className="flex items-baseline justify-between border-b border-rule-frame px-[32px] py-[20px]">
      <div className="flex items-baseline gap-[14px]">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        <span className="text-[13px] text-ink-4">{meta}</span>
      </div>
      <div className="flex items-center gap-[20px]">
        <span className="flex items-center gap-[7px]" aria-hidden data-testid="round-stepper">
          {Array.from({ length }, (_, index) => (
            <span
              key={index}
              data-done={index < done}
              className={`h-[2px] w-[26px] ${index < done ? "bg-mark" : "bg-rule-section"}`}
            />
          ))}
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-ink-label" data-testid="round-step">
          {step}
        </span>
      </div>
    </header>
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

/** 05 §5.8: a 3px full-height bar, gap 10px, 12px/1.7 --ink-3. */
export function CalloutRail({ tone, children }: { tone: "attention" | "information"; children: React.ReactNode }) {
  return (
    <div className="flex gap-[10px]" role={tone === "attention" ? "alert" : "status"}>
      <span
        aria-hidden
        className={`w-[3px] shrink-0 self-stretch ${tone === "attention" ? "bg-attention-mark" : "bg-mark-mid"}`}
      />
      <p className="text-[12px] leading-[1.7] text-ink-3">{children}</p>
    </div>
  );
}

/** A score at the low end takes the attention colour (05 §5.3): the sample's 2 does, its 3 does not. */
export const LOW_END = 2;

/**
 * 05 §5.3: the label, a 300px five-tick scale with the dot at the score, the numeral, and an empty
 * flex spacer — **empty by design** (05 §7: no prose beside a dimension). `value` null is an unscored
 * row: no dot, and the numeral column says why.
 */
export function ScoreRow({ label, value, unscored }: { label: string; value: number | null; unscored: string }) {
  const low = value !== null && value <= LOW_END;
  return (
    <div
      className="flex items-center gap-[18px] border-t border-rule-row py-[11px] last:border-b"
      data-testid="score-row"
      data-dimension={label}
    >
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
    </div>
  );
}
