import { nothingPractised, type DueRow, type Urgency } from "@/lib/progress/due";
import { ROUND_TYPE_NAMES, ROUND_TYPES } from "../round/copy";
import { HOME_COPY as COPY } from "./copy";

// 10 §1's rail: --accent for the most due, stepping down to the grey of a pair never practised.
const RAIL: Record<Urgency, string> = { most: "bg-mark", mid: "bg-mark-mid", least: "bg-mark-pale", never: "bg-rule-axis" };

const row = "flex items-center gap-[20px] border-t border-rule-section py-[15px] last:border-b";

/**
 * The Due list (10 §1, US-14): never-practised pairs first and without a bar — a bar at 0% would read
 * as "not due" — then the rest, most overdue first. **Not links and not controls**: it suggests, and
 * `Start a round` is the one way in, whatever the list says.
 */
export function DueList({ rows }: { rows: readonly DueRow[] }) {
  // 10 §1's empty state: nothing to be due from, so the four round types, unsorted, with no language.
  if (nothingPractised(rows)) {
    return (
      <ul className="flex flex-col" data-testid="due-list" data-empty>
        {ROUND_TYPES.map((roundType) => (
          <li key={roundType} className={row} data-testid="due-row">
            <span aria-hidden className={`h-[26px] w-[5px] shrink-0 ${RAIL.never}`} />
            <span className="w-[168px] text-[15px] font-medium">{ROUND_TYPE_NAMES[roundType]}</span>
            <span className="flex-1" />
            <span className="font-mono text-[13px] text-ink-label">{COPY.interval(null)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-col" data-testid="due-list">
      {rows.map((due) => (
        <li key={`${due.roundType}-${due.language}`} className={row} data-testid="due-row" data-urgency={due.urgency}>
          <span aria-hidden className={`h-[26px] w-[5px] shrink-0 ${RAIL[due.urgency]}`} />
          <span className="w-[168px] text-[15px] font-medium">{COPY.roundType(due)}</span>
          <span className="w-[90px] text-[13px] text-ink-4">{COPY.language(due.language)}</span>
          <span className="flex flex-1 items-center" aria-hidden>
            {due.share === null ? null : (
              <span className={`h-[2px] ${RAIL[due.urgency]}`} style={{ width: `${due.share * 100}%` }} data-testid="due-bar" />
            )}
          </span>
          <span className={`font-mono text-[13px] ${due.days === null ? "text-ink-label" : "text-ink-3"}`}>
            <span aria-hidden data-testid="due-interval">
              {COPY.interval(due.days)}
            </span>
            <span className="sr-only">{COPY.intervalSpoken(due.days)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
