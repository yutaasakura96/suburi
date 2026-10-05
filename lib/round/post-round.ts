import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { Embedder } from "../ai/embed";
import type { QuestionGenerator } from "../ai/generate-questions";
import type { ModelHealth } from "../ai/health";
import type { AnswerScorer } from "../ai/score";
import { ModelCallFailed, SPEND_LIMIT_CLASSES } from "../ai/upstream";
import { admitCandidate, lockSlice } from "../questions/near-duplicate";
import { generateCandidates, type GeneratedCandidates } from "./generate-candidates";
import { authenticate, guarded, log, notFound, parseBody, writeFailed, type Db, type RoundDeps } from "./http";
import { loadCandidates, planQuestions } from "./select-questions";
import { lockRoundUser } from "./state";

/**
 * `POST /api/rounds` ⚡ (07 §5.4). Preflights the model, resolves the rubric and the CV version,
 * **chooses every bank question the round will ask** — generating the ones the bank cannot give —
 * and writes the round with its `round_questions` in one transaction.
 *
 * **Generation runs beside the preflight, before the transaction.** Its candidates then pass the
 * near-duplicate guard inside the transaction, under a lock on the slice, so a new question, its
 * stored comparison and the round that asks it land together or not at all.
 *
 * **The client sends the five choices from screen 2 and nothing else.** The rubric is the newest in
 * the round's language, the CV version the current one in it, and the per-answer cap follows the
 * mode; none is a request field, because a client-chosen cap or version is a client-chosen stamp. The
 * strict schema makes a `cv_version_id` a 400 (11 §3.13).
 *
 * **Starting a round abandons any open one** — derived, nothing written to the old round.
 */
export const CAP_SECONDS = { realistic: 240, practice: 900 } as const;

const requestSchema = z.strictObject({
  round_type: z.enum(s.ROUND_TYPES),
  language: z.enum(s.LANGUAGES),
  mode: z.enum(s.MODES),
  length: z.union([z.literal(3), z.literal(5), z.literal(7)]),
  role_context_id: z.uuid(),
});

export interface PostRoundDeps extends RoundDeps {
  readonly health: ModelHealth;
  readonly scorer: AnswerScorer;
  readonly questionGenerator: QuestionGenerator;
  readonly embedder: Embedder;
}

/** The candidates and the reserve together could not fill the round: nothing is written. */
class BankTooSmall extends Error {}

export function createPostRound(deps: PostRoundDeps) {
  return guarded("round_create_failed", async function POST(request: Request): Promise<Response> {
    const session = await authenticate(deps, request, "rounds");
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;
    const { round_type: roundType, language, mode, length } = body;

    const [context] = await deps.db
      .select({ id: s.roleContexts.id })
      .from(s.roleContexts)
      .where(and(eq(s.roleContexts.id, body.role_context_id), eq(s.roleContexts.userId, userId)));
    if (!context) return notFound("role context");

    const [cv] = await deps.db
      .select({ id: s.cvVersions.id, label: s.cvVersions.versionLabel })
      .from(s.cvVersions)
      .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)))
      .orderBy(desc(s.cvVersions.createdAt))
      .limit(1);
    if (!cv) return apiError("not_found", "No CV version in this language.", { language });

    const [rubric] = await deps.db
      .select({ id: s.rubricVersions.id, label: s.rubricVersions.versionLabel })
      .from(s.rubricVersions)
      .where(eq(s.rubricVersions.language, language))
      .orderBy(desc(s.rubricVersions.createdAt))
      .limit(1);
    if (!rubric) return apiError("not_found", "No rubric version in this language.", { language });

    const slice = { userId, language, roundType };
    const plan = planQuestions(await loadCandidates(deps.db, slice), mode, length);

    // The preflight and generation run together, before the transaction (07 §5.4): the round waits
    // for the slower of the two, not their sum.
    const [health, generated] = await Promise.all([
      deps.health.check(),
      plan.shortfall === 0
        ? null
        : generateCandidates(deps, { ...slice, cvVersionId: cv.id, roleContextId: context.id, shortfall: plan.shortfall }).catch(
            (error: unknown) => (error instanceof ModelCallFailed ? error : new ModelCallFailed("Question generation", "unexpected")),
          ),
    ]);
    if (!health.ok) {
      log("error", { event: "round_preflight_failed", error_class: health.errorClass, latency_ms: health.latencyMs });
      return apiError("model_unavailable", "Model preflight failed.", {
        model_id: deps.health.modelId,
        error_class: health.errorClass,
      });
    }
    if (generated instanceof ModelCallFailed) {
      log("error", {
        event: "round_question_generation_failed",
        round_type: roundType,
        language,
        shortfall: plan.shortfall,
        error_class: generated.errorClass,
      });
      // A spent project (12 §6) is the model being unavailable, whichever call met it first.
      if ((SPEND_LIMIT_CLASSES as readonly string[]).includes(generated.errorClass)) {
        return apiError("model_unavailable", "The model's project has reached its spend limit.", {
          model_id: deps.health.modelId,
          error_class: generated.errorClass,
        });
      }
      return apiError("question_generation_failed", "The round's questions could not be generated; nothing was created.", {
        error_class: generated.errorClass,
      });
    }

    const chosen = [...plan.chosen];
    const admitted = { inserted: 0, reused: 0 };
    let round: typeof s.rounds.$inferSelect;
    let first: { id: string; body: string };
    try {
      // The first prompt is read inside the write: nothing after the commit can fail a round that exists.
      [round, first] = await deps.transaction(async (tx) => {
        await lockRoundUser(tx, userId);
        if (generated) {
          await lockSlice(tx, slice);
          await fillFromCandidates(tx, generated);
        }
        const [row] = await tx
          .insert(s.rounds)
          .values({
            userId,
            roundType,
            language,
            mode,
            length,
            perAnswerCapSeconds: CAP_SECONDS[mode],
            cvVersionId: cv.id,
            roleContextId: context.id,
            rubricVersionId: rubric.id,
            startedAt: sql`clock_timestamp()`,
          })
          .returning();
        await tx
          .insert(s.roundQuestions)
          .values(chosen.map((questionId, index) => ({ roundId: row.id, userId, position: index + 1, questionId })));
        const [question] = await tx
          .select({ id: s.questions.id, body: s.questions.body })
          .from(s.questions)
          .where(eq(s.questions.id, chosen[0]));
        return [row, question] as const;
      });
    } catch (error) {
      if (error instanceof BankTooSmall) {
        log("error", { event: "round_bank_too_small", round_type: roundType, language, length, ...admitted });
        return apiError("question_generation_failed", "The bank cannot fill this round, and nothing was created.", {
          error_class: "bank_too_small",
        });
      }
      return writeFailed("round_write_failed", error, {});
    }

    log("info", {
      event: "round_created",
      round_id: round.id,
      round_type: roundType,
      language,
      mode,
      length,
      preflight_ms: health.latencyMs,
      generated: generated !== null,
      candidates: generated?.candidates.length ?? 0,
      questions_inserted: admitted.inserted,
      questions_reused: admitted.reused,
      generation_ms: generated?.generationMs ?? null,
      embedding_ms: generated?.embeddingMs ?? null,
    });

    return Response.json(
      {
        round: {
          id: round.id,
          round_type: round.roundType,
          language: round.language,
          mode: round.mode,
          length: round.length,
          per_answer_cap_seconds: round.perAnswerCapSeconds,
          started_at: round.startedAt.toISOString(),
          completed_at: null,
          stamps: {
            cv_version_label: cv.label,
            rubric_version_label: rubric.label,
            scoring_model_id: deps.scorer.modelId,
            scoring_prompt_version: deps.scorer.promptVersions[language] ?? null,
          },
        },
        prompt: { kind: "question", position: 1, question_id: first.id, text: first.body, speak: mode === "realistic" },
        progress: { position: 1, of: length },
      },
      // Where the round is read back from, and resumed (07 §5.5).
      { status: 201, headers: { Location: `/api/rounds/${round.id}` } },
    );
  });
}
