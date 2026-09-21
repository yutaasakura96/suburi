import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as en from "../prompts/cv-extract-en-1.1";
import * as ja from "../prompts/cv-extract-ja-1.0";
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

export type CvLanguage = "ja" | "en";

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

/**
 * One prompt per language (03 §4), so the stamp is chosen by the set's language:
 * `promptVersions[language]` is the version `extract(language, …)` sends.
 */
export interface CvClaimExtractor {
  readonly modelId: string;
  readonly promptVersions: Readonly<Record<CvLanguage, string>>;
  extract(language: CvLanguage, documents: readonly ExtractionDocument[]): Promise<readonly ExtractedClaim[]>;
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

/**
 * Each document under a one-line header naming its index, its kind and, for an additional document,
 * the user's title — kept to that line, so a title's line breaks never start a line of their own.
 * The prompts describe exactly this header.
 */
export function renderDocuments(documents: readonly ExtractionDocument[]) {
  return documents
    .map((document, index) => {
      const title = document.title === null ? "" : `, titled: ${document.title.replace(/\s+/gu, " ").trim()}`;
      return `=== document ${index}: ${document.kind}${title} ===\n${document.text}`;
    })
    .join("\n\n");
}

const PROMPTS = { ja, en } as const;

function errorClassOf(error: unknown) {
  if (error instanceof ExtractionFailed) return error.errorClass;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "upstream_timeout";
  if (error instanceof OpenAI.APIConnectionError) return "upstream_unreachable";
  if (error instanceof OpenAI.APIError) return `upstream_${error.status ?? "error"}`;
  return "malformed_output";
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One call, no SDK retries: 07 §5.2 is one model call, and the whole invocation shares Vercel
 * Hobby's 300s (CONTEXT.md).
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
    promptVersions: { ja: ja.version, en: en.version },
    async extract(language, documents) {
      const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 240_000 });
      try {
        const response = await client.responses.parse({
          model: CV_EXTRACTION_MODEL,
          instructions: PROMPTS[language].instructions,
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
