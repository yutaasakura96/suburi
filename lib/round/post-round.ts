import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import type { ModelHealth } from "../ai/health";
import type { AnswerScorer } from "../ai/score";
import { authenticate, log, notFound, parseBody, writeFailed, type RoundDeps } from "./http";
import { chooseQuestions, loadCandidates } from "./select-questions";

/**
 * `POST /api/rounds` ⚡ (07 §5.4). Preflights the model, resolves the rubric and the CV version,
 * **chooses every bank question the round will ask**, and writes the round with its
 * `round_questions` in one transaction.
 *
 * **The client sends the five choices from screen 2 and nothing else.** The rubric is the newest in
 * the round's language, the CV version the current one in it, and the per-answer cap follows the
 * mode; none is a request field, because a client-chosen cap or version is a client-chosen stamp. The
 * strict schema makes a `cv_version_id` a 400 (11 §3.13).
 *
 * English only in this slice: the Japanese rubric and set pieces arrive with #43, so `ja` is a 400
 * until then rather than a round with no rubric.
 *
 * **Starting a round abandons any open one** — derived, nothing written to the old round.
 */
export const CAP_SECONDS = { realistic: 240, practice: 900 } as const;

const requestSchema = z.strictObject({
  round_type: z.enum(s.ROUND_TYPES),
  language: z.literal("en"),
  mode: z.enum(s.MODES),
  length: z.union([z.literal(3), z.literal(5), z.literal(7)]),
  role_context_id: z.uuid(),
});

export interface PostRoundDeps extends RoundDeps {
  readonly health: ModelHealth;
  readonly scorer: AnswerScorer;
}

export function createPostRound(deps: PostRoundDeps) {
  return async function POST(request: Request): Promise<Response> {
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

    // The preflight and the choice run together, before the transaction (07 §5.4). Generation joins
    // the choice with #47.
    const [health, candidates] = await Promise.all([
      deps.health.check(),
      loadCandidates(deps.db, { userId, language, roundType }),
    ]);
    if (!health.ok) {
      log("error", { event: "round_preflight_failed", error_class: health.errorClass, latency_ms: health.latencyMs });
      return apiError("model_unavailable", "Model preflight failed.", {
        model_id: deps.health.modelId,
        error_class: health.errorClass,
      });
    }
    const chosen = chooseQuestions(candidates, mode, length);
    if (!chosen) {
      log("error", { event: "round_bank_too_small", round_type: roundType, language, candidates: candidates.length, length });
      return apiError("question_generation_failed", "The bank cannot fill this round, and nothing was created.", {
        error_class: "bank_too_small",
        candidates: candidates.length,
      });
    }

    let round: typeof s.rounds.$inferSelect;
    try {
      round = await deps.transaction(async (tx) => {
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
          })
          .returning();
        await tx
          .insert(s.roundQuestions)
          .values(chosen.map((questionId, index) => ({ roundId: row.id, userId, position: index + 1, questionId })));
        return row;
      });
    } catch (error) {
      return writeFailed("round_write_failed", error, {});
    }

    const [first] = await deps.db
      .select({ id: s.questions.id, body: s.questions.body })
      .from(s.questions)
      .where(eq(s.questions.id, chosen[0]));

    log("info", {
      event: "round_created",
      round_id: round.id,
      round_type: roundType,
      language,
      mode,
      length,
      preflight_ms: health.latencyMs,
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
      // No Location: `GET /api/rounds/{id}` is the resume slice's (#48), as #14 left the CV route.
      { status: 201 },
    );
  };
}
