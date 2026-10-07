"use client";

import { useState } from "react";
import { PLOT, type TrendLine } from "@/lib/progress/series";

export interface PlotDot {
  readonly x: number;
  readonly y: number;
  /** 05 §5.4's tooltip, written on the server: the day, the dimension and score, the question. */
  readonly tooltip: string;
}

/** The widest a dot's hover target grows: past it, a dense row's targets would cover each other. */
const HIT_RADIUS = 9;

/**
 * One dimension's plot (05 §5.4): the frame, the boundaries, a trend line per segment that has one,
 * and the dots. All of it is placed on the server; this holds only which dot is being read.
 *
 * **The tooltip is reachable without a pointer** (05 §7): the row is one tab stop, and the arrow keys
 * walk its dots, newest first. A row is one stop rather than each dot being one, because seven rows of
 * thirty dots would put two hundred stops between the header and the footer.
 */
export function DotPlot({
  name,
  dots,
  lines,
  boundaries,
}: {
  /** The row, named for a reader that cannot see it. */
  name: string;
  dots: readonly PlotDot[];
  lines: readonly TrendLine[];
  boundaries: readonly number[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const annotated = active === null ? null : (dots[active] ?? null);
  const spacing = dots.length > 1 ? dots[1].x - dots[0].x : PLOT.width;
  const hit = Math.max(4, Math.min(HIT_RADIUS, spacing / 2));

  function onKeyDown(event: React.KeyboardEvent) {
    if (dots.length === 0) return;
    const last = dots.length - 1;
    const from = active ?? last;
    const to =
      event.key === "ArrowLeft"
        ? Math.max(0, from - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, from + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (to === null) return;
    event.preventDefault();
    setActive(to);
  }

  // The tooltip hangs above its dot, and leans inwards at the plot's ends so it stays over the row.
  const anchor =
    annotated === null
      ? null
      : annotated.x < PLOT.width / 3
        ? { left: Math.max(0, annotated.x - 9) }
        : annotated.x > (PLOT.width * 2) / 3
          ? { right: Math.max(0, PLOT.width - annotated.x - 9) }
          : { left: annotated.x, transform: "translateX(-50%)" };

  return (
    <div
      className="relative h-[40px] w-[360px] shrink-0"
      role="group"
      aria-label={name}
      tabIndex={dots.length > 0 ? 0 : undefined}
      onFocus={() => {
        setFocused(true);
        setActive((current) => current ?? dots.length - 1);
      }}
      onBlur={() => {
        setFocused(false);
        setActive(null);
      }}
      onKeyDown={onKeyDown}
      onMouseLeave={() => {
        if (!focused) setActive(null);
      }}
      data-testid="dot-plot"
    >
      <svg width={PLOT.width} height={PLOT.height} viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} className="block overflow-visible" aria-hidden>
        <line x1={0} y1={PLOT.top} x2={PLOT.width} y2={PLOT.top} className="stroke-rule-hairline" strokeWidth={1} />
        <line x1={0} y1={PLOT.bottom} x2={PLOT.width} y2={PLOT.bottom} className="stroke-rule-hairline" strokeWidth={1} />
        {boundaries.map((x) => (
          <line key={x} x1={x} y1={0} x2={x} y2={PLOT.height} className="stroke-rule-axis" strokeWidth={1} data-testid="plot-boundary" />
        ))}
        {lines.map((line) => (
          <line
            key={line.x1}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            className="stroke-mark-faint"
            strokeWidth={2}
            strokeLinecap="round"
            data-testid="plot-trend"
          />
        ))}
        {dots.map((dot, index) =>
          index === active ? (
            <circle key={index} cx={dot.x} cy={dot.y} r={5} className="fill-mark stroke-surface" strokeWidth={2} data-testid="plot-dot" data-active />
          ) : (
            <circle key={index} cx={dot.x} cy={dot.y} r={4} className="fill-mark" data-testid="plot-dot" />
          ),
        )}
        {dots.map((dot, index) => (
          <circle key={index} cx={dot.x} cy={dot.y} r={hit} fill="transparent" onMouseEnter={() => setActive(index)} />
        ))}
      </svg>
      {annotated && anchor ? (
        <div
          className="pointer-events-none absolute -top-[27px] z-10 border border-tick bg-surface px-[9px] py-[5px] font-mono text-[10px] tracking-[0.04em] whitespace-nowrap text-ink-3"
          style={anchor}
          aria-hidden
          data-testid="plot-tooltip"
        >
          {annotated.tooltip}
        </div>
      ) : null}
      {/* What the tooltip says, for a reader that cannot see it: announced as the arrow keys move. */}
      <span className="sr-only" aria-live="polite">
        {annotated?.tooltip ?? ""}
      </span>
    </div>
  );
}
