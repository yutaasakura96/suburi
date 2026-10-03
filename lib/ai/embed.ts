import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The embedding port (03 §4, §11): one vector per text, for the near-duplicate guard. One real
 * implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **What comes back is checked, not trusted:** one vector per input, in the input's order, each of
 * the pinned model's dimension and every component finite. Anything else is `malformed_output` and
 * embeds nothing — a short or misordered answer would compare a question against another's vector.
 */
export interface Embedder {
  readonly modelId: string;
  embed(texts: readonly string[], options?: CallOptions): Promise<readonly (readonly number[])[]>;
}

export function checkEmbeddings(count: number, vectors: readonly (readonly number[])[]) {
  if (vectors.length !== count) throw new ModelCallFailed("Embedding", "malformed_output");
  for (const vector of vectors) {
    if (vector.length !== EMBEDDING_DIMENSIONS || vector.some((value) => !Number.isFinite(value))) {
      throw new ModelCallFailed("Embedding", "malformed_output");
    }
  }
  return vectors;
}

export function openAiEmbedder({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): Embedder {
  return {
    modelId: EMBEDDING_MODEL,
    async embed(texts, { signal, timeoutMs } = {}) {
      if (texts.length === 0) return [];
      try {
        const response = await openAiClient({ apiKey, baseURL }).embeddings.create(
          { model: EMBEDDING_MODEL, input: [...texts], encoding_format: "float" },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        // The API numbers each vector; sorting by that number is what makes the order the input's.
        const ordered = [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
        return checkEmbeddings(texts.length, ordered);
      } catch (error) {
        throw new ModelCallFailed("Embedding", upstreamErrorClass(error));
      }
    },
  };
}
