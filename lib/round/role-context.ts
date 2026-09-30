import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { authenticate, parseBody, writeFailed, type RoundDeps } from "./http";

/**
 * `POST /api/role-contexts` (07 §5.3), **`general` only** in this slice: a posting arrives with #47,
 * research with US-16, and until then each is a 400. General practice is a real row, not a null
 * foreign key, and **one per user**: a repeat returns the existing row with 200, never a second one.
 * Immutable: there is no update and no delete.
 */
const requestSchema = z.strictObject({ kind: z.literal("general") });

function view(row: typeof s.roleContexts.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind,
    company_name: row.companyName,
    role_title: row.roleTitle,
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

    try {
      // The partial unique index is the conflict target, so a race between two first requests still
      // leaves one row (04 `role_contexts`).
      const inserted = await deps.db.execute<{ id: string }>(sql`
        insert into role_contexts (user_id, kind) values (${userId}, 'general')
        on conflict (user_id) where kind = 'general' do nothing
        returning id`);
      const [row] = await deps.db
        .select()
        .from(s.roleContexts)
        .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "general")));
      return Response.json(view(row), { status: inserted.rows.length > 0 ? 201 : 200 });
    } catch (error) {
      return writeFailed("role_context_write_failed", error, {});
    }
  };
}
