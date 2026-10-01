import { SCORING_MODEL } from "./models.ts";
import { openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The round-setup preflight (07 §5.1, 03 §5): **a round is never started into a broken scorer.** A
 * cheap probe against the pinned scoring model — it retrieves the model, which proves the key
 * authenticates and the exact string resolves — not a scoring call.
 */
export type HealthResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly latencyMs: number; readonly errorClass: string };

export interface ModelHealth {
  readonly modelId: string;
  check(): Promise<HealthResult>;
}

export function openAiModelHealth({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): ModelHealth {
  return {
    modelId: SCORING_MODEL,
    async check() {
      const started = performance.now();
      const latencyMs = () => Math.round(performance.now() - started);
      try {
        await openAiClient({ apiKey, baseURL }).models.retrieve(SCORING_MODEL, { timeout: 10_000 });
        return { ok: true, latencyMs: latencyMs() };
      } catch (error) {
        return { ok: false, latencyMs: latencyMs(), errorClass: upstreamErrorClass(error) };
      }
    },
  };
}
