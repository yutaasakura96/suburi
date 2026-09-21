import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/cv-extract-en-1.0";
import { CV_EXTRACTION_MODEL } from "./models";

/**
 * The CV-extraction port (03 §10): one real implementation on the pinned model, and a fake for
 * tests — no test ever calls OpenAI (11 §2). Everything deterministic around it (body assembly,
 * locating quotes, the span validator) lives in `lib/cv/`, so the port does as little as possible:
 * send the documents, return what the model said, or fail with an error class.
 *
 * **What comes back is untrusted.** A claim is a document index, a quote and a start hint; the
 * server finds the quote in the stored text and validates the span. Nothing here is ever rendered.
 */

export interface ExtractionDocument {
  readonly kind: string;
  readonly title: string | null;
  readonly text: string;
}

export interface ExtractedClaim {
  readonly document: number;
  readonly quote: string;
  readonly start_hint: number;
}

export interface CvClaimExtractor {
  readonly modelId: string;
  readonly promptVersion: string;
  extract(documents: readonly ExtractionDocument[]): Promise<readonly ExtractedClaim[]>;
}

/**
 * The only way extraction fails. `errorClass` is safe to log and to put in an envelope's `detail`;
 * the message never carries a prompt, a document or a model response (03 §8).
 */
export class ExtractionFailed extends Error {
  readonly errorClass: string;

  constructor(errorClass: string) {
    super(`CV extraction failed: ${errorClass}`);
    this.name = "ExtractionFailed";
    this.errorClass = errorClass;
  }
}

const output = z.object({
  claims: z.array(
    z.object({ document: z.int(), quote: z.string(), start_hint: z.int() }),
  ),
});

export function renderDocuments(documents: readonly ExtractionDocument[]) {
  return documents.map((document, index) => `=== document ${index} ===\n${document.text}`).join("\n\n");
}

function errorClassOf(error: unknown) {
  if (error instanceof ExtractionFailed) return error.errorClass;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "upstream_timeout";
  if (error instanceof OpenAI.APIConnectionError) return "upstream_unreachable";
  if (error instanceof OpenAI.APIError) return `upstream_${error.status ?? "error"}`;
  return "malformed_output";
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * English only until the Japanese prompt exists (#15). One call, no SDK retries: 07 §5.2 is one
 * model call, and the whole invocation shares Vercel Hobby's 300s (CONTEXT.md).
 *
 * `baseURL` is set only by Playwright, at its mock (`lib/config.ts` refuses anything but a local
 * host). It is passed explicitly either way, so the SDK never falls back to reading
 * `process.env.OPENAI_BASE_URL` behind the config module's back.
 */
export function openAiCvClaimExtractor({
  apiKey,
  baseURL = OPENAI_BASE_URL,
}: {
  apiKey: string;
  baseURL?: string;
}): CvClaimExtractor {
  return {
    modelId: CV_EXTRACTION_MODEL,
    promptVersion: en.version,
    async extract(documents) {
      const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 240_000 });
      try {
        const response = await client.responses.parse({
          model: CV_EXTRACTION_MODEL,
          instructions: en.instructions,
          input: renderDocuments(documents),
          text: { format: zodTextFormat(output, "cv_claims") },
        });
        if (response.status !== "completed") throw new ExtractionFailed(`response_${response.status}`);
        if (!response.output_parsed) throw new ExtractionFailed("no_parsed_output");
        return response.output_parsed.claims;
      } catch (error) {
        throw new ExtractionFailed(errorClassOf(error));
      }
    },
  };
}
