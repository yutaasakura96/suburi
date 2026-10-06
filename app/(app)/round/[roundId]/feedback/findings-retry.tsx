"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { failureText, postJson, type FailureCode } from "../../api";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import { CalloutRail, caption } from "../../parts";

/**
 * 10 §8, "when the round-level findings are not in": one plain sentence and a control that retries
 * them (07 §5.16). No spinner, and nothing on the screen waits for it.
 */
export function FindingsRetry({ roundId, language, rated }: { roundId: string; language: RoundLanguage; rated: boolean }) {
  const copy = ROUND_COPY[language];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/rounds/${roundId}/feedback`);
    setBusy(false);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-[14px]" data-testid="findings-not-ready">
      <p className="text-[13px] leading-[1.75] text-ink-3">{copy.findingsNotReady(rated)}</p>
      {error ? <CalloutRail tone="attention">{failureText(error, language)}</CalloutRail> : null}
      <Button variant="outline" onClick={() => void retry()} disabled={busy} className="self-start">
        {copy.retryFindings}
      </Button>
      {busy ? (
        <p className={caption} role="status">
          {copy.retryingFindings}
        </p>
      ) : null}
    </div>
  );
}
