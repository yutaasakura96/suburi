"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { failureText, postJson, type FailureCode } from "../../api";
import { ROUND_COPY, type RoundLanguage } from "../../copy";
import { CalloutRail, caption } from "../../parts";

/**
 * 10 §8, an answer with no model answer: one plain sentence and a control that writes every model
 * answer the round still lacks (07 §5.19). No spinner, and nothing on the screen waits for it. A call
 * that wrote only some still refreshes: what landed is stored, and the rest keep this control.
 */
export function ModelAnswersRetry({ roundId, language }: { roundId: string; language: RoundLanguage }) {
  const copy = ROUND_COPY[language];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureCode | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/rounds/${roundId}/model-answers`);
    setBusy(false);
    if (!result.ok) setError(result.code);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-[14px]" data-testid="model-answer-not-written">
      <p className="text-[13px] leading-[1.75] text-ink-3">{copy.modelAnswerNotWritten}</p>
      {error ? <CalloutRail tone="attention">{failureText(error, language)}</CalloutRail> : null}
      <Button variant="outline" onClick={() => void retry()} disabled={busy} className="self-start">
        {copy.writeModelAnswers}
      </Button>
      {busy ? (
        <p className={caption} role="status">
          {copy.writingModelAnswers}
        </p>
      ) : null}
    </div>
  );
}
