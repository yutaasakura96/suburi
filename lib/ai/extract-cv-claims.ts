import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { ExtractionWindow } from "../cv/windows";
import * as en from "../prompts/cv-extract-en-1.3";
import * as ja from "../prompts/cv-extract-ja-1.2";
import { CV_EXTRACTION_MODEL } from "./models";

/**
 * The CV-extraction port (03 §10): one real implementation on the pinned model, and a fake for
 * tests — no test ever calls OpenAI (11 §2). Everything deterministic around it (body assembly,
 * planning the windows, the fan-out and its retry, locating quotes, the span validator) lives in
 * `lib/cv/`, so the port does as little as possible: send the documents and one window, return what
 * the model said, or fail with an error class.
 *
 * **One synchronous extraction (N parallel windowed calls), one transaction** (07 §5.2, #29). Every
 * call is sent the whole set and returns the claims of one window of one document
 * (`lib/cv/windows.ts`); `lib/cv/windowed-extraction.ts` runs them in parallel and finishes all of
 * them before the save's transaction opens, so the save stays all-or-nothing.
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

export interface ExtractionCallOptions {
  /** Aborts the call: another window has already failed the save. */
  readonly signal?: AbortSignal;
  /** Overrides the client's timeout, for a retry that has less of the route's budget left. */
  readonly timeoutMs?: number;
}

/**
 * One prompt per language (03 §4), so the stamp is chosen by the set's language:
 * `promptVersions[language]` is the version `extract(language, …)` sends.
 *
 * One call reads every document and returns the claims of `window` only. What comes back is not
 * trusted to have stayed inside it: the caller drops and counts any claim that did not.
 */
export interface CvClaimExtractor {
  readonly modelId: string;
  readonly promptVersions: Readonly<Record<CvLanguage, string>>;
  extract(
    language: CvLanguage,
    documents: readonly ExtractionDocument[],
    window: ExtractionWindow,
    options?: ExtractionCallOptions,
  ): Promise<readonly ExtractedClaim[]>;
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

/**
 * The documents, then the window this call returns claims from: a header naming its document and its
 * code-point range, and under it that exact passage. The prompts describe exactly this block. The
 * passage is repeated rather than marked inside the document, so the text the model quotes from is
 * the stored text, untouched.
 */
export function renderWindow(documents: readonly ExtractionDocument[], window: ExtractionWindow) {
  const passage = Array.from(documents[window.document].text).slice(window.start, window.end).join("");
  return (
    `${renderDocuments(documents)}\n\n` +
    `=== window: document ${window.document}, characters ${window.start} to ${window.end} ===\n${passage}`
  );
}

const PROMPTS = { ja, en } as const;

function errorClassOf(error: unknown) {
  if (error instanceof ExtractionFailed) return error.errorClass;
  if (error instanceof OpenAI.APIUserAbortError) return "aborted";
  if (error instanceof OpenAI.APIConnectionTimeoutError) return "upstream_timeout";
  if (error instanceof OpenAI.APIConnectionError) return "upstream_unreachable";
  if (error instanceof OpenAI.APIError) return `upstream_${error.status ?? "error"}`;
  return "malformed_output";
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One call per window, no SDK retries: the whole invocation shares Vercel Hobby's 300s (CONTEXT.md),
 * so the one retry a failed window may get is the fan-out's to decide, because only it knows how much
 * of that budget is left (`lib/cv/windowed-extraction.ts`).
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
    async extract(language, documents, window, { signal, timeoutMs } = {}) {
      const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 240_000 });
      try {
        const response = await client.responses.parse(
          {
            model: CV_EXTRACTION_MODEL,
            instructions: PROMPTS[language].instructions,
            input: renderWindow(documents, window),
            text: { format: zodTextFormat(output, "cv_claims") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ExtractionFailed(`response_${response.status}`);
        if (!response.output_parsed) throw new ExtractionFailed("no_parsed_output");
        return response.output_parsed.claims;
      } catch (error) {
        throw new ExtractionFailed(errorClassOf(error));
      }
    },
  };
}
