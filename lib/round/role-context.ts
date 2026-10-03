import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { characterLength } from "../cv/spans";
import { authenticate, log, parseBody, writeFailed, type RoundDeps } from "./http";
import { MAX_POSTING_CHARS, MAX_POSTING_NAME_CHARS, MAX_SOURCE_FILENAME_CHARS } from "./limits";

/**
 * `POST /api/role-contexts` (07 §5.3): a **posting** or **General practice**. Research arrives with
 * US-16 and is a 400 until then. Immutable: there is no update and no delete, and a changed posting
 * is a new row.
 *
 * - **General practice** is a real row, not a null foreign key, and **one per user**: a repeat returns
 *   the existing row with 200, never a second one.
 * - **A posting** carries its company, its role title and its text, all three required. The text was
 *   pasted, or extracted from a file in the browser — the file is never sent, only its name. Over the
 *   measured cap (`limits.ts`) it is a 422 `role_context_too_large`, before anything is saved.
 *
 * Calls no model, so it is not rate-limited. **Nothing the user wrote is logged** (12 §7): not the
 * text, the company, the title or the filename.
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
  return async function POST(request: Request): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;

    if (body.kind === "posting") {
      const bodyChars = characterLength(body.body);
      if (bodyChars > MAX_POSTING_CHARS) {
        log("error", { event: "role_context_too_large", body_chars: bodyChars, max_body_chars: MAX_POSTING_CHARS });
        return apiError("role_context_too_large", "The posting is longer than the cap.", {
          body_chars: bodyChars,
          max_body_chars: MAX_POSTING_CHARS,
        });
      }
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
  };
}
