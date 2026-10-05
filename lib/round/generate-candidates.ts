import { sql } from "drizzle-orm";
import type { Embedder } from "../ai/embed";
import type { GenerationRoleContext, QuestionGenerator } from "../ai/generate-questions";
import type { QuestionCandidate, QuestionSlice } from "../questions/near-duplicate";
import type { Db } from "./http";

/**
 * A round's new questions as **candidates**, at round start and outside any transaction (07 §5.4):
 * one generation call for the shortfall and a little more, then one embedding call for the lot. What
 * comes back is not yet in the bank — the near-duplicate guard decides that, inside the round's
 * transaction (`lib/questions/near-duplicate.ts`).
 *
 * The generator reads the round's CV version as its claims, each **sliced from the stored body by its
 * span** and never from model output (04 `cv_claims`), the role context, and every question already
 * in the slice. None of it is logged (12 §7).
 */

/** Asked for beyond the shortfall, so a candidate the guard maps to an existing question does not leave the round short. */
export const SPARE_CANDIDATES = 2;

/**
 * A minute for the questions and twenty seconds for their embeddings: several times the measured
 * medians (03 §4), and short enough that a stuck call is a refusal the user can retry, not a wait
 * that outlives their patience. Nothing has been written when either expires.
 */
export const GENERATION_TIMEOUT_MS = 60_000;
export const EMBEDDING_TIMEOUT_MS = 20_000;

export interface GeneratedCandidates {
  readonly candidates: readonly QuestionCandidate[];
  readonly promptVersion: string;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly generationMs: number;
  readonly embeddingMs: number;
}

async function loadClaims(db: Pick<Db, "execute">, cvVersionId: string) {
  // `substring` counts code points, as the spans do (03 §11).
  const { rows } = await db.execute<{ quote: string }>(sql`
    select substring(v.body from c.span_start + 1 for c.span_end - c.span_start) as quote
    from cv_claims c join cv_versions v on v.id = c.cv_version_id
    where c.cv_version_id = ${cvVersionId}
    order by c.span_start, c.id`);
  return rows.map((row) => row.quote);
}

/** A round's role context as a generating call is shown it: a posting with its text, or General practice. */
export async function loadRoleContext(db: Pick<Db, "execute">, roleContextId: string): Promise<GenerationRoleContext> {
  const { rows } = await db.execute<{ kind: string; company_name: string | null; role_title: string | null; body: string | null }>(sql`
    select kind, company_name, role_title, body from role_contexts where id = ${roleContextId}`);
  const [row] = rows;
  if (!row || row.kind === "general") return { kind: "general" };
  return { kind: "posting", companyName: row.company_name ?? "", roleTitle: row.role_title ?? "", body: row.body ?? "" };
}

/** Every question in the slice, set pieces included: the generator is told to repeat none of them. */
async function loadExisting(db: Pick<Db, "execute">, { userId, language, roundType }: QuestionSlice) {
  const { rows } = await db.execute<{ body: string }>(sql`
    select body from questions
    where user_id = ${userId} and language = ${language} and round_type = ${roundType} and retired_at is null
    order by created_at, id`);
  return rows.map((row) => row.body);
}

/** Throws `ModelCallFailed` — the ports' only failure — with the error class of whichever call failed. */
export async function generateCandidates(
  deps: { readonly db: Pick<Db, "execute">; readonly questionGenerator: QuestionGenerator; readonly embedder: Embedder },
  input: QuestionSlice & { readonly cvVersionId: string; readonly roleContextId: string; readonly shortfall: number },
): Promise<GeneratedCandidates> {
  const [claims, roleContext, existing] = await Promise.all([
    loadClaims(deps.db, input.cvVersionId),
    loadRoleContext(deps.db, input.roleContextId),
    loadExisting(deps.db, input),
  ]);

  const generationStarted = performance.now();
  const generated = await deps.questionGenerator.generate(
    {
      language: input.language,
      roundType: input.roundType,
      count: input.shortfall + SPARE_CANDIDATES,
      roleContext,
      claims,
      existing,
    },
    { timeoutMs: GENERATION_TIMEOUT_MS },
  );
  const embeddingStarted = performance.now();
  const embeddings = await deps.embedder.embed(generated.questions, { timeoutMs: EMBEDDING_TIMEOUT_MS });

  return {
    candidates: generated.questions.map((body, index) => ({ body, embedding: embeddings[index] })),
    promptVersion: deps.questionGenerator.promptVersions[input.language][input.roundType],
    tokensIn: generated.tokensIn,
    tokensOut: generated.tokensOut,
    generationMs: Math.round(embeddingStarted - generationStarted),
    embeddingMs: Math.round(performance.now() - embeddingStarted),
  };
}
