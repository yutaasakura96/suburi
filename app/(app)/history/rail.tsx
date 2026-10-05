"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RoundListItem, RoundListPage } from "@/lib/round/list-rounds";
import { failureText, getJson, type FailureCode } from "../round/api";
import { CalloutRail, caption, sectionLabel } from "../round/parts";
import { HISTORY_COPY, statusLine } from "./copy";

type OlderRounds = { items: readonly RoundListItem[]; next: string | null };

function mergeItems(first: readonly RoundListItem[], second: readonly RoundListItem[]) {
  const seen = new Set(first.map((item) => item.id));
  return [...first, ...second.filter((item) => !seen.has(item.id))];
}

/**
 * 10 §10's left rail: every round, newest first, the selected one marked by the 05 §5.6 rail. The
 * first page arrives with the layout; older ones are fetched from `GET /api/rounds` by cursor.
 *
 * **The two status lines are designed in, not discovered** (10 §10): an unscored round says its
 * scoring can be retried, and an abandoned one that it is out of progress. The newest open round
 * started today is neither: it is offered for resuming.
 */
export function HistoryRail({
  initial,
  count,
  pageMax,
}: {
  initial: RoundListPage;
  /** Every round the user has, listed or not yet. */
  count: number;
  /** The most one request may ask for (07 §4). */
  pageMax: number;
}) {
  const selected = useParams<{ roundId?: string }>().roundId;
  const [older, setOlder] = useState<OlderRounds | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);
  const olderRef = useRef(older);
  const items = mergeItems(initial.items, older?.items ?? []);
  const next = older ? older.next : initial.next_cursor;

  useEffect(() => {
    olderRef.current = older;
  }, [older]);

  useEffect(() => {
    const loaded = olderRef.current;
    const oldestId = loaded?.items.at(-1)?.id;
    if (!oldestId || initial.next_cursor === null) return;
    let stale = false;
    void (async () => {
      const refreshed: RoundListItem[] = [];
      let cursor: string | null = initial.next_cursor;
      while (cursor !== null && !refreshed.some((item) => item.id === oldestId)) {
        const result = await getJson<RoundListPage>(
          `/api/rounds?limit=${Math.min(Math.max(loaded.items.length - refreshed.length, 1), pageMax)}&cursor=${encodeURIComponent(cursor)}`,
        );
        if (stale || !result.ok) return;
        refreshed.push(...result.json.items);
        cursor = result.json.next_cursor;
      }
      if (stale) return;
      setOlder((current) => {
        const refreshedIds = new Set(refreshed.map((item) => item.id));
        const next = current && current.items.some((item) => !refreshedIds.has(item.id)) ? current.next : cursor;
        return { items: mergeItems(refreshed, current?.items ?? []), next };
      });
    })();
    return () => {
      stale = true;
    };
  }, [initial, pageMax]);

  async function loadOlder() {
    if (next === null) return;
    setBusy(true);
    setError(null);
    const result = await getJson<RoundListPage>(`/api/rounds?cursor=${encodeURIComponent(next)}`);
    setBusy(false);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setOlder((current) => ({
      items: mergeItems(current?.items ?? [], result.json.items),
      next: result.json.next_cursor,
    }));
  }

  return (
    <nav className="flex w-[330px] shrink-0 flex-col gap-[14px] border-r border-rule-frame px-[28px] pt-[24px] pb-[26px]" aria-label={HISTORY_COPY.rounds}>
      <div className="flex items-baseline justify-between">
        <h1 className={sectionLabel}>{HISTORY_COPY.rounds}</h1>
        <span className="font-mono text-[11px] text-ink-8" data-testid="history-count">
          {count}
        </span>
      </div>
      <ol className="flex flex-col">
        {items.map((round) => {
          const current = round.id === selected;
          const line = statusLine(round);
          return (
            <li
              key={round.id}
              className="flex items-start gap-[14px] border-t border-rule-hairline py-[13px]"
              data-testid="history-round"
              data-status={round.status}
            >
              <span aria-hidden className={`h-[34px] w-[2px] shrink-0 ${current ? "bg-mark" : "bg-transparent"}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <Link href={`/history/${round.id}`} aria-current={current ? "page" : undefined} className="group flex flex-col gap-[5px]">
                  <span className="flex items-baseline justify-between">
                    <span className={`text-[13px] group-hover:text-ink-1 ${current ? "font-medium text-ink-1" : "text-ink-3"}`}>
                      {HISTORY_COPY.roundType(round.round_type)}
                    </span>
                    <span className="font-mono text-[11px] text-ink-8">{HISTORY_COPY.date(round.started_at)}</span>
                  </span>
                  <span className="text-[11px] text-ink-7">{HISTORY_COPY.meta(round.language, round.mode, round.length)}</span>
                  {line && line.kind !== "resume" ? (
                    <span className="text-[11px] text-attention-ink" data-testid="history-status-line">
                      {line.text}
                    </span>
                  ) : null}
                </Link>
                {line?.kind === "resume" ? (
                  <Link
                    href={`/round/${round.id}`}
                    className="text-[11px] text-link hover:text-link-hover hover:underline"
                    data-testid="history-status-line"
                  >
                    {line.text}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {next !== null ? (
        <button
          type="button"
          onClick={() => void loadOlder()}
          disabled={busy}
          className="self-start text-[12px] text-link hover:text-link-hover hover:underline disabled:text-ink-9"
        >
          {HISTORY_COPY.older}
        </button>
      ) : null}
      {busy ? (
        <p className={caption} role="status">
          {HISTORY_COPY.loadingOlder}
        </p>
      ) : null}
      {error ? <CalloutRail tone="attention">{failureText(error, "en")}</CalloutRail> : null}
    </nav>
  );
}
