import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import * as prompt from "../prompts/research-1.0.ts";
import { MAX_POSTING_CHARS } from "../round/limits.ts";
import { RESEARCH_MODEL } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, openAiClient, upstreamErrorClass } from "./upstream.ts";

/**
 * The company-research port (03 §4, 07 §5.22): English notes on a company and on what a role there
 * most likely involves, for US-16 (06, 2026-10-16, R1, R2, R5). **Nothing it is sent or returns is
 * stored or logged** (12 §7) by this slice: the user reads and edits the notes before anything is
 * saved. One real implementation and a fake; no test calls OpenAI (11 §2).
 *
 * **It searches the web through the pinned model when it can, and falls back to the model's own
 * knowledge when it cannot** (R1). One call, with the Responses API's hosted `web_search` tool and
 * `tool_choice: "auto"`: the model searches, or it does not, or its search fails. **Whether it
 * searched is read from the response, never from the notes:** a call searched when its output holds a
 * `web_search_call` that `completed`. The tool's consulted sources are requested
 * (`web_search_call.action.sources`) so that a link in the notes can be checked against what the call
 * actually saw.
 *
 * **What comes back is checked, not trusted** (`checkResearchNotes`): every fact names a source, a
 * web source is an `http(s)` URL, the role part is marked as a guess, and nothing is a question.
 * Anything else is `malformed_output`, a failed call. A link the call never saw is dropped and counted.
 */

/** One fact: a sentence and where it came from, a URL or `model knowledge`. */
export interface ResearchFact {
  readonly text: string;
  readonly source: string;
}

export interface ResearchNotes {
  readonly company: {
    readonly what_it_does: readonly ResearchFact[];
    readonly products: readonly ResearchFact[];
    readonly size: readonly ResearchFact[];
    readonly recent_news: readonly ResearchFact[];
    readonly stated_values: readonly ResearchFact[];
  };
  /** The model's guess at the role, never a fact about a posting (R2). */
  readonly role: {
    readonly guess: true;
    readonly involves: readonly ResearchFact[];
    readonly asks_for: readonly ResearchFact[];
  };
}

export interface ResearchRequest {
  /** Trimmed, non-blank and at most 200 code points, as a posting's (07 §5.3). */
  readonly companyName: string;
  readonly roleTitle: string;
}

export interface ResearchResult {
  /** The notes as text, sources inline: what Setup shows to edit, and what a save keeps as the draft. */
  readonly draft: string;
  /** Whether the call's web search completed. False is R1's fallback: every fact is `model knowledge`. */
  readonly searched: boolean;
  /** Counts only, for the log line (12 §7): web-sourced, `model knowledge`, and dropped unseen links. */
  readonly facts: { readonly web: number; readonly modelKnowledge: number; readonly dropped: number };
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface CompanyResearcher {
  readonly modelId: string;
  readonly promptVersion: string;
  research(request: ResearchRequest, options?: CallOptions): Promise<ResearchResult>;
}

export const MODEL_KNOWLEDGE = prompt.MODEL_KNOWLEDGE;

/** What the call did on the web, read from its output items (the web-search guide's "Output and citations"). */
export interface SearchEvidence {
  readonly searched: boolean;
  /** Every URL the call's search returned, opened or cited. */
  readonly seenUrls: ReadonlySet<string>;
}

const COMPANY_SECTIONS = [
  ["what_it_does", "What the company does"],
  ["products", "Products and services"],
  ["size", "Size"],
  ["recent_news", "Recent news"],
  ["stated_values", "Stated values"],
] as const;

const ROLE_SECTIONS = [
  ["involves", "What it most likely involves"],
  ["asks_for", "What it most likely asks for"],
] as const;

const malformed = () => new ModelCallFailed("Research", "malformed_output");

function isWebUrl(source: string) {
  if (!/^https?:\/\/\S+$/iu.test(source)) return false;
  try {
    const url = new URL(source);
    return url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** A link is the call's own when the call saw it: the same URL, or a page on a host its search saw. */
function seen(source: string, evidence: SearchEvidence) {
  if (evidence.seenUrls.has(source)) return true;
  const host = new URL(source).hostname.replace(/^www\./u, "");
  for (const url of evidence.seenUrls) {
    try {
      if (new URL(url).hostname.replace(/^www\./u, "") === host) return true;
    } catch {
      // A malformed URL in the tool's own output names no host.
    }
  }
  return false;
}

export interface CheckedNotes {
  readonly notes: ResearchNotes;
  /** Facts whose link the call never saw, dropped rather than shown with a source nobody visited. */
  readonly dropped: number;
}

/**
 * The server-side check (07 §5.22). Returns the notes with every fact trimmed, or throws
 * `malformed_output`:
 *
 * - each fact's text and source are non-blank; the text is one line, holds no `http(s)` URL and no
 *   question mark anywhere (R2: no interview questions), so no fact carries an unchecked source or
 *   writes a second line into the draft;
 * - each source is `model knowledge` or an `http(s)` URL;
 * - the role part is marked as a guess; `what_it_does` and `involves` are not empty;
 * - the draft fits a role context's text cap, so the notes as returned can be saved (#135).
 *
 * **A well-formed link the call never saw is dropped and counted**, never relabelled: the fact is
 * gone, not shown as `model knowledge` it is not. "Saw" is the same URL, or a page on a host its search
 * returned, opened or cited. **A call that did not search saw nothing**, so every link in it is
 * dropped and what is left is labelled `model knowledge` (R1). One unseen link in thirty does not
 * fail a minute's research (#134's measurement, 03 §4); emptying `what_it_does` or `involves` does.
 */
export function checkResearchNotes(request: ResearchRequest, notes: ResearchNotes, evidence: SearchEvidence): CheckedNotes {
  let dropped = 0;
  const checkFacts = (facts: readonly ResearchFact[]): ResearchFact[] =>
    facts.flatMap((fact) => {
      const text = fact.text.trim();
      const source = fact.source.trim();
      if (text === "" || source === "") throw malformed();
      if (/[\r\n\u2028\u2029?？]|https?:\/\//iu.test(text)) throw malformed();
      if (source === MODEL_KNOWLEDGE) return [{ text, source }];
      if (!isWebUrl(source)) throw malformed();
      if (!evidence.searched || !seen(source, evidence)) {
        dropped += 1;
        return [];
      }
      return [{ text, source }];
    });
  if (notes.role.guess !== true) throw malformed();
  const checked: ResearchNotes = {
    company: {
      what_it_does: checkFacts(notes.company.what_it_does),
      products: checkFacts(notes.company.products),
      size: checkFacts(notes.company.size),
      recent_news: checkFacts(notes.company.recent_news),
      stated_values: checkFacts(notes.company.stated_values),
    },
    role: { guess: true, involves: checkFacts(notes.role.involves), asks_for: checkFacts(notes.role.asks_for) },
  };
  if (checked.company.what_it_does.length === 0 || checked.role.involves.length === 0) throw malformed();
  if (Array.from(researchDraft(request, checked)).length > MAX_POSTING_CHARS) throw malformed();
  return { notes: checked, dropped };
}

/**
 * The notes as one English text, every fact with its source in brackets and the role under a heading
 * that says it is a guess. Empty lists are left out. Deterministic: the same notes, the same text.
 */
export function researchDraft({ companyName, roleTitle }: ResearchRequest, notes: ResearchNotes): string {
  const line = (fact: ResearchFact) => `- ${fact.text} [${fact.source}]`;
  const sections = (heading: string, lists: readonly (readonly [string, readonly ResearchFact[]])[]) => [
    heading,
    ...lists.filter(([, facts]) => facts.length > 0).flatMap(([title, facts]) => ["", title, ...facts.map(line)]),
  ];
  return [
    `${companyName} — ${roleTitle}`,
    "",
    ...sections(
      "The company",
      COMPANY_SECTIONS.map(([key, title]) => [title, notes.company[key]] as const),
    ),
    "",
    ...sections(
      "The role (a guess, not from a posting)",
      ROLE_SECTIONS.map(([key, title]) => [title, notes.role[key]] as const),
    ),
  ].join("\n");
}

export function factCounts(notes: ResearchNotes) {
  const all = [...Object.values(notes.company), notes.role.involves, notes.role.asks_for].flat();
  const modelKnowledge = all.filter((fact) => fact.source === MODEL_KNOWLEDGE).length;
  return { web: all.length - modelKnowledge, modelKnowledge };
}

/** Whether the call searched, and every URL it saw, from its output items. */
export function searchEvidence(output: readonly OpenAI.Responses.ResponseOutputItem[]): SearchEvidence {
  const seenUrls = new Set<string>();
  let searched = false;
  for (const item of output) {
    if (item.type === "web_search_call") {
      if (item.status === "completed") searched = true;
      const { action } = item;
      if (action.type === "search") for (const source of action.sources ?? []) seenUrls.add(source.url);
      else if (action.url) seenUrls.add(action.url);
    }
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const annotation of part.annotations) if (annotation.type === "url_citation") seenUrls.add(annotation.url);
      }
    }
  }
  return { searched, seenUrls };
}

const fact = z.object({ text: z.string(), source: z.string() });
const output = z.object({
  company: z.object({
    what_it_does: z.array(fact),
    products: z.array(fact),
    size: z.array(fact),
    recent_news: z.array(fact),
    stated_values: z.array(fact),
  }),
  role: z.object({ guess: z.literal(true), involves: z.array(fact), asks_for: z.array(fact) }),
});

export function researchInput({ companyName, roleTitle }: ResearchRequest) {
  return `=== company name ===\n${companyName}\n\n=== role title ===\n${roleTitle}`;
}

export function openAiCompanyResearcher({ apiKey, baseURL }: { apiKey: string; baseURL?: string }): CompanyResearcher {
  return {
    modelId: RESEARCH_MODEL,
    promptVersion: prompt.version,
    async research(request, { signal, timeoutMs } = {}) {
      try {
        const response = await openAiClient({ apiKey, baseURL }).responses.parse(
          {
            model: RESEARCH_MODEL,
            instructions: prompt.instructions,
            input: researchInput(request),
            tools: [{ type: "web_search" }],
            tool_choice: "auto",
            include: ["web_search_call.action.sources"],
            text: { format: zodTextFormat(output, "company_research") },
          },
          { signal, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
        );
        if (response.status !== "completed") throw new ModelCallFailed("Research", `response_${response.status}`);
        if (!response.output_parsed) throw new ModelCallFailed("Research", "no_parsed_output");
        const evidence = searchEvidence(response.output);
        const { notes, dropped } = checkResearchNotes(request, response.output_parsed, evidence);
        return {
          draft: researchDraft(request, notes),
          searched: evidence.searched,
          facts: { ...factCounts(notes), dropped },
          tokensIn: response.usage?.input_tokens ?? null,
          tokensOut: response.usage?.output_tokens ?? null,
        };
      } catch (error) {
        throw new ModelCallFailed("Research", upstreamErrorClass(error));
      }
    },
  };
}
