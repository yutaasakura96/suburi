import { sql } from "drizzle-orm";
import * as s from "../../db/schema";
import type { Db } from "../round/http";
import { NEAR_DUPLICATE_THRESHOLD } from "./near-duplicate-threshold";

/**
 * The near-duplicate guard (04 `questions`, 03 §11): a generated candidate is compared with the
 * nearest embedded question in its `(user_id, language, round_type) where retired_at is null` slice,
 * and **at or above the threshold the existing row is reused instead of inserted**. Five rephrasings
 * of one question would otherwise be five ids with one first attempt each.
 *
 * Every comparison is stored in `near_duplicate_checks` — ids and numbers, never question text — and
 * that record is what the threshold is tuned from (12 §6's weekly digest reads it).
 */

export { NEAR_DUPLICATE_THRESHOLD };

export function isNearDuplicate(similarity: number, threshold = NEAR_DUPLICATE_THRESHOLD) {
  return similarity >= threshold;
}

export interface QuestionSlice {
  readonly userId: string;
  readonly language: (typeof s.LANGUAGES)[number];
  readonly roundType: (typeof s.ROUND_TYPES)[number];
}

/**
 * Held to the end of the transaction, so two round starts cannot both compare a candidate with the
 * bank and both insert it. One lock per slice: other slices generate freely.
 */
export async function lockSlice(tx: Pick<Db, "execute">, { userId, language, roundType }: QuestionSlice) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`questions:${userId}:${language}:${roundType}`}, 0))`);
}

/**
 * The slice's nearest embedded question, **sorted exactly** on the slice's own index — not through
 * the `hnsw` index, whose approximate search filtered to a slice can miss a neighbour, and a missed
 * neighbour is a duplicate inserted (04 §3). A row without an embedding — a set piece — is not
 * compared.
 */
export async function nearestQuestion(
  tx: Pick<Db, "execute">,
  { userId, language, roundType }: QuestionSlice,
  embedding: readonly number[],
): Promise<{ id: string; similarity: number } | null> {
  const vector = `[${embedding.join(",")}]`;
  const { rows } = await tx.execute<{ id: string; similarity: number }>(sql`
    select id, 1 - (embedding <=> ${vector}::vector) as similarity
    from questions
    where user_id = ${userId} and language = ${language} and round_type = ${roundType}
      and retired_at is null and embedding is not null
    order by similarity desc, id
    limit 1`);
  const [nearest] = rows;
  return nearest ? { id: nearest.id, similarity: Number(nearest.similarity) } : null;
}

export interface QuestionCandidate {
  readonly body: string;
  readonly embedding: readonly number[];
}

export interface GeneratorStamps {
  readonly generatorModelId: string;
  readonly generatorPromptVersion: string;
  readonly embeddingModelId: string;
  /** The call's tokens, for the one row that carries them (04 `questions`); null on the rest. */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export type Admission =
  | { readonly kind: "inserted"; readonly questionId: string }
  /** The bank already holds this question: `questionId` is the existing row's. */
  | { readonly kind: "reused"; readonly questionId: string };

/**
 * One candidate through the guard, inside the caller's transaction and under `lockSlice`: inserted
 * with its embedding, or mapped to the question it duplicates. Candidates are admitted one at a time,
 * so a later one is compared with the earlier ones of the same call too.
 */
export async function admitCandidate(
  tx: Db,
  slice: QuestionSlice,
  candidate: QuestionCandidate,
  stamps: GeneratorStamps,
  threshold = NEAR_DUPLICATE_THRESHOLD,
): Promise<Admission> {
  const nearest = await nearestQuestion(tx, slice, candidate.embedding);
  const check = nearest && {
    userId: slice.userId,
    matchedQuestionId: nearest.id,
    similarity: nearest.similarity,
    threshold,
    embeddingModelId: stamps.embeddingModelId,
  };

  if (check && isNearDuplicate(nearest.similarity, threshold)) {
    await tx.insert(s.nearDuplicateChecks).values({ ...check, questionId: null });
    return { kind: "reused", questionId: nearest.id };
  }

  const [question] = await tx
    .insert(s.questions)
    .values({
      userId: slice.userId,
      language: slice.language,
      roundType: slice.roundType,
      origin: "generated",
      body: candidate.body,
      embedding: [...candidate.embedding],
      generatorModelId: stamps.generatorModelId,
      generatorPromptVersion: stamps.generatorPromptVersion,
      tokensIn: stamps.tokensIn,
      tokensOut: stamps.tokensOut,
    })
    .returning({ id: s.questions.id });
  // Nothing to compare with — an empty slice — is no check, not a check at similarity zero.
  if (check) await tx.insert(s.nearDuplicateChecks).values({ ...check, questionId: question.id });
  return { kind: "inserted", questionId: question.id };
}
