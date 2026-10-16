import { z } from "zod";
import { apiError } from "../api/errors";
import type { CompanyResearcher, ResearchResult } from "../ai/research";
import { ModelCallFailed, upstreamErrorClass } from "../ai/upstream";
import { characterLength } from "../cv/spans";
import { authenticate, guarded, log, parseBody, type RoundDeps } from "./http";
import { MAX_POSTING_NAME_CHARS } from "./limits";
import { refuseSamePosting } from "./same-job";

/**
 * `POST /api/role-contexts/research` ⚡ (07 §5.22): English notes on a company and on what a role there
 * most likely involves, for US-16 (06, 2026-10-16, R1, R2, R4, R5). **It saves nothing**: the user
 * reads and edits the notes on Setup first, and a save is `POST /api/role-contexts` (§5.3, #135).
 *
 * **A saved posting wins** (R4, US-2): when the user has a posting for the same job — company and role
 * equal after tidying (`same-job.ts`, shared with the save) — it is `422 research_posting_exists`, naming
 * that posting, before any model call. A blank or over-long field is a `400`, as a posting's is.
 *
 * **Nothing in the request, the notes or the response is logged** (12 §7): not the company, the role
 * or a fact. Log lines carry counts, a duration and an error class.
 */
export interface ResearchDeps extends RoundDeps {
  readonly researcher: CompanyResearcher;
}

/**
 * Twice the slowest call #134 measured (73.4 s, searching; 03 §4), rounded up: the user is on Setup,
 * waiting, with nothing else to lose. One call, no retry. Inside the route's 300 s.
 */
export const RESEARCH_TIMEOUT_MS = 150_000;

const name = z
  .string()
  .trim()
  .min(1)
  .refine((value) => characterLength(value) <= MAX_POSTING_NAME_CHARS);

const requestSchema = z.strictObject({ company_name: name, role_title: name });

export function createResearch(deps: ResearchDeps) {
  return guarded("research_failed", async function POST(request: Request): Promise<Response> {
    const session = await authenticate(deps, request, "research");
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;

    const refused = await refuseSamePosting(deps.db, userId, body.company_name, body.role_title);
    if (refused) return refused;

    const started = performance.now();
    const outcome = await research(deps.researcher, { companyName: body.company_name, roleTitle: body.role_title });
    const durationMs = Math.round(performance.now() - started);

    if (!outcome.ok) {
      log("error", { event: "research_failed", duration_ms: durationMs, error_class: outcome.errorClass });
      return apiError("research_failed", "The research failed.", { error_class: outcome.errorClass });
    }
    log("info", {
      event: "research",
      duration_ms: durationMs,
      searched: outcome.searched,
      web_facts: outcome.facts.web,
      model_knowledge_facts: outcome.facts.modelKnowledge,
      dropped_links: outcome.facts.dropped,
      draft_chars: characterLength(outcome.draft),
      tokens_in: outcome.tokensIn,
      tokens_out: outcome.tokensOut,
    });
    return Response.json({
      company_name: body.company_name,
      role_title: body.role_title,
      draft: outcome.draft,
      searched: outcome.searched,
      model_id: deps.researcher.modelId,
      prompt_version: deps.researcher.promptVersion,
    });
  });
}

type ResearchOutcome = ({ readonly ok: true } & ResearchResult) | { readonly ok: false; readonly errorClass: string };

/** One call, bounded at `RESEARCH_TIMEOUT_MS` whatever the SDK does, never retried. */
async function research(researcher: CompanyResearcher, request: { companyName: string; roleTitle: string }): Promise<ResearchOutcome> {
  const abort = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        // Rejected first: aborting fails the call in flight, and that must not be the class logged.
        reject(new ModelCallFailed("Research", "upstream_timeout"));
        abort.abort();
      }, RESEARCH_TIMEOUT_MS);
    });
    const result = await Promise.race([researcher.research(request, { signal: abort.signal, timeoutMs: RESEARCH_TIMEOUT_MS }), deadline]);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, errorClass: upstreamErrorClass(error) };
  } finally {
    clearTimeout(timeout);
  }
}
