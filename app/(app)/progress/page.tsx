import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { firstAttemptCounts, firstAttempts, seriesOf, type ProgressContext } from "@/lib/progress/first-attempts";
import { AppHeader } from "../app-header";
import { ROUND_LANGUAGES, ROUND_TYPE_NAMES, ROUND_TYPES, type RoundType } from "../round/copy";
import { sectionLabel } from "../round/parts";
import { PROGRESS_COPY as COPY } from "./copy";
import { DotPlot } from "./dot-plot";
import { panelView, type PanelView } from "./panel";

export const metadata: Metadata = {
  title: COPY.title,
};

const CONTEXTS: readonly ProgressContext[] = ["role", "general"];

const tab = "pb-[8px] text-[14px]";
const selectedTab = `${tab} border-b-2 border-mark font-medium text-ink-1`;
const otherTab = `${tab} border-b-2 border-transparent text-ink-5 hover:text-ink-2`;

// 05 §5.4 draws a 96px label column; `Length and pacing` needs 120 to stay on one line, as on the
// score row (05 §5.3). The plot, the gaps and the numeral column are as drawn.
const labelColumn = "w-[120px] shrink-0";

function Panel({ view }: { view: PanelView }) {
  return (
    <div className="flex flex-col gap-[14px]" data-testid="progress-panel" data-language={view.language}>
      <div className="flex items-baseline justify-between gap-[16px]">
        <h2 className="shrink-0 text-[14px] font-medium">{COPY.language(view.language)}</h2>
        <span className="text-right font-mono text-[12px] text-ink-label" data-testid="panel-status">
          {view.status}
        </span>
      </div>
      <div className="flex gap-[18px]">
        <span className={labelColumn} />
        <div className="relative w-[360px]" style={{ height: view.lanes * 13 }}>
          {view.labels.map((label) => (
            <span
              key={`${label.x}-${label.text}`}
              className="absolute truncate font-mono text-[9px] tracking-[0.06em] text-ink-8"
              style={{ left: label.x, top: label.lane * 13, width: label.width, textAlign: label.align }}
              title={label.text}
              data-testid="boundary-label"
            >
              {label.text}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col pt-[16px]">
        {view.rows.map((row) => (
          <div
            key={row.key}
            className="flex items-center gap-[18px] border-t border-rule-hairline py-[11px]"
            data-testid="progress-row"
            data-dimension={row.key}
          >
            <span className={`${labelColumn} text-[13px] text-ink-3`}>{row.label}</span>
            {row.kind === "not_scored" ? (
              <>
                <div className="flex h-[40px] w-[360px] shrink-0 items-center" data-testid="not-scored">
                  <span className="h-px flex-1 bg-rule-hairline" />
                  <span className="pl-[12px] text-[11px] text-ink-9">{COPY.notScored(view.language)}</span>
                </div>
                <span className="w-[22px] text-right font-mono text-[13px] text-ink-9">{COPY.none}</span>
              </>
            ) : (
              <>
                <DotPlot name={COPY.row(row.label, row.dots.length)} dots={row.dots} lines={row.lines} boundaries={view.boundaries} />
                <span
                  className={`w-[22px] text-right font-mono text-[13px] ${row.latest === null ? "text-ink-9" : "text-ink-3"}`}
                  data-testid="row-latest"
                >
                  {row.latest ?? COPY.none}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Progress (10 §9, US-13): one dot per first attempt, one row per rubric dimension, one panel per
 * language — within one round type, and within one of the two context groups. **Nothing here adds two
 * dimensions together, two languages together or two round types together** (refusal #1): the tabs
 * are how the others are seen, one at a time.
 *
 * A Server Component reading stored rows (07 §1); the tabs are links, so the view is the URL's.
 * Protected here as well as in the proxy (08 §5).
 */
export default async function ProgressPage({ searchParams }: PageProps<"/progress">) {
  const userId = await requireSession();
  const query = await searchParams;
  const roundType = ROUND_TYPES.find((option) => option === query.type) ?? "behavioural";
  const context = CONTEXTS.find((option) => option === query.context) ?? "role";

  const all = await firstAttempts(getDb(), userId);
  const counts = firstAttemptCounts(all);
  const href = (to: { type?: RoundType; context?: ProgressContext }) =>
    `/progress?type=${to.type ?? roundType}&context=${to.context ?? context}`;

  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      <section className="flex min-h-[980px] flex-col border border-rule-frame bg-surface" aria-label="Progress">
        <AppHeader active="progress" />
        <div className="flex flex-grow flex-col gap-[22px] px-[32px] pt-[26px] pb-[28px]">
          <div className="flex items-baseline justify-between">
            <h1 className={sectionLabel}>{COPY.heading}</h1>
            <div className="flex items-baseline gap-[24px] font-mono text-[12px] text-ink-4">
              {ROUND_LANGUAGES.map((language) => (
                <span key={language} data-testid="progress-count" data-language={language}>
                  {COPY.count(language, counts[language])}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-[14px] border-b border-rule-section pb-[12px]">
            <div className="flex items-baseline justify-between">
              <nav aria-label={COPY.roundTypes} className="flex gap-[28px]">
                {ROUND_TYPES.map((option) => (
                  <Link
                    key={option}
                    href={href({ type: option })}
                    aria-current={option === roundType ? "true" : undefined}
                    className={option === roundType ? selectedTab : otherTab}
                  >
                    {ROUND_TYPE_NAMES[option]}
                  </Link>
                ))}
              </nav>
              <span className="text-[12px] text-ink-label">{COPY.perRoundType}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <nav aria-label={COPY.contexts} className="flex gap-[28px]">
                {CONTEXTS.map((option) => (
                  <Link
                    key={option}
                    href={href({ context: option })}
                    aria-current={option === context ? "true" : undefined}
                    className={option === context ? selectedTab : otherTab}
                  >
                    {COPY.context[option]}
                  </Link>
                ))}
              </nav>
              <span className="text-[12px] text-ink-label">{COPY.perContext}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[40px]">
            {ROUND_LANGUAGES.map((language) => (
              <Panel key={language} view={panelView(language, seriesOf(all, { language, roundType, context }))} />
            ))}
          </div>

          <div className="flex-grow" />

          <div className="grid grid-cols-2 gap-[40px] border-t border-rule-section pt-[16px] text-[12px] leading-[1.85] text-ink-6" data-testid="progress-footer">
            {COPY.footer.map((column, index) => (
              <div key={index} className="flex flex-col">
                {column.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
