import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { characterLength } from "../cv/spans";
import { authenticate, guarded, log, parseBody, writeFailed, type RoundDeps } from "./http";
import { MAX_POSTING_CHARS, MAX_POSTING_NAME_CHARS, MAX_SOURCE_FILENAME_CHARS } from "./limits";
import { refuseSamePosting } from "./same-job";

/**
 * `POST /api/role-contexts` (07 §5.3): a **posting**, a **research** or **General practice**.
 * Immutable: there is no update and no delete, and a changed posting is a new row.
 *
 * - **General practice** is a real row, not a null foreign key, and **one per user**: a repeat returns
 *   the existing row with 200, never a second one.
 * - **A posting** carries its company, its role title and its text, all three required. The text was
 *   pasted, or extracted from a file in the browser — the file is never sent, only its name. Over the
 *   measured cap (`limits.ts`) it is a 422 `role_context_too_large`, before anything is saved.
 * - **A research** (US-16; 06, 2026-10-16, R3, R4) carries its company, its role title, `body` — the
 *   notes as the user edited them, which the questions are written from — and `research_draft`, the
 *   notes as the research route (07 §5.22) returned them. Both texts are under the posting's cap.
 *   **A saved posting wins:** the same job as a saved posting is a 422 `research_posting_exists`, on
 *   the research route's own comparison (`same-job.ts`).
 *
 * Calls no model, so it is not rate-limited. **Nothing the user wrote is logged** (12 §7): not the
 * text, the draft, the company, the title or the filename.
 */
const codePoints = (max: number) => (value: string) => characterLength(value) <= max;
const name = z
  .string()
  .trim()
  .min(1)
  .refine(codePoints(MAX_POSTING_NAME_CHARS));

const requestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("general") }),
  z.strictObject({
    kind: z.literal("posting"),
    company_name: name,
    role_title: name,
    // The cap is its own refusal, below: a 400 would hide which invariant refused the save.
    body: z.string().trim().min(1),
    source_filename: z.string().trim().min(1).refine(codePoints(MAX_SOURCE_FILENAME_CHARS)).optional(),
  }),
  z.strictObject({
    kind: z.literal("researched"),
    company_name: name,
    role_title: name,
    // Capped below, as a posting's text is.
    body: z.string().trim().min(1),
    research_draft: z.string().trim().min(1),
  }),
]);

function view(row: typeof s.roleContexts.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    company_name: row.companyName,
    role_title: row.roleTitle,
    source_filename: row.sourceFilename,
    created_at: row.createdAt.toISOString(),
  };
}

export function createPostRoleContext(deps: RoundDeps) {
  return guarded("role_context_failed", async function POST(request: Request): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;

    if (body.kind === "researched") return saveResearch(deps, userId, body);

    if (body.kind === "posting") {
      const bodyChars = characterLength(body.body);
      if (bodyChars > MAX_POSTING_CHARS) return tooLarge("The posting is longer than the cap.", { body_chars: bodyChars });
      try {
        const [row] = await deps.db
          .insert(s.roleContexts)
          .values({
            userId,
            kind: "posting",
            companyName: body.company_name,
            roleTitle: body.role_title,
            body: body.body,
            sourceFilename: body.source_filename ?? null,
          })
          .returning();
        log("info", { event: "role_context_created", role_context_id: row.id, kind: row.kind, body_chars: bodyChars });
        return Response.json(view(row), { status: 201 });
      } catch (error) {
        return writeFailed("role_context_write_failed", error, {});
      }
    }

    try {
      const { created, row } = await deps.transaction(async (tx) => {
        // The partial unique index is the conflict target, so a race between two first requests still
        // leaves one row (04 `role_contexts`).
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into role_contexts (user_id, kind) values (${userId}, 'general')
          on conflict (user_id) where kind = 'general' do nothing
          returning id`);
        const [general] = await tx
          .select()
          .from(s.roleContexts)
          .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "general")));
        return { created: inserted.rows.length > 0, row: general };
      });
      return Response.json(view(row), { status: created ? 201 : 200 });
    } catch (error) {
      return writeFailed("role_context_write_failed", error, {});
    }
  });
}

function tooLarge(message: string, chars: { body_chars: number } | { research_draft_chars: number }) {
  const detail = { ...chars, max_body_chars: MAX_POSTING_CHARS };
  log("error", { event: "role_context_too_large", ...detail });
  return apiError("role_context_too_large", message, detail);
}

type ResearchBody = Extract<z.infer<typeof requestSchema>, { kind: "researched" }>;

async function saveResearch(deps: RoundDeps, userId: string, body: ResearchBody): Promise<Response> {
  const bodyChars = characterLength(body.body);
  if (bodyChars > MAX_POSTING_CHARS) return tooLarge("The notes are longer than the cap.", { body_chars: bodyChars });
  const draftChars = characterLength(body.research_draft);
  if (draftChars > MAX_POSTING_CHARS) return tooLarge("The draft is longer than the cap.", { research_draft_chars: draftChars });

  const refused = await refuseSamePosting(deps.db, userId, body.company_name, body.role_title);
  if (refused) return refused;

  try {
    const [row] = await deps.db
      .insert(s.roleContexts)
      .values({
        userId,
        kind: "researched",
        companyName: body.company_name,
        roleTitle: body.role_title,
        body: body.body,
        researchDraft: body.research_draft,
      })
      .returning();
    log("info", {
      event: "role_context_created",
      role_context_id: row.id,
      kind: row.kind,
      body_chars: bodyChars,
      research_draft_chars: draftChars,
    });
    return Response.json(view(row), { status: 201 });
  } catch (error) {
    return writeFailed("role_context_write_failed", error, {});
  }
}
