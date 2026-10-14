import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { authenticate, guarded, log, parseBody, writeFailed, type Db, type RoundDeps } from "../round/http";
import { displayNameProblem } from "./display-name";

// Relative imports: the integration tests load these files outside Next's path aliases.

/** What `/settings` shows (`10` §17): the display name, editable, and the email, read-only. */
export async function loadSettings(db: Db, userId: string) {
  const [user] = await db
    .select({ displayName: s.users.name, email: s.users.email })
    .from(s.users)
    .where(eq(s.users.id, userId));
  return user;
}

const requestSchema = z.strictObject({
  display_name: z
    .string()
    .trim()
    .refine((value) => displayNameProblem(value) === null),
});

/**
 * `PUT /api/settings` (`07` §5.21): the settings page's one write, **a whole replacement** of what the
 * page edits, never a partial update (`07` §4). Today that is the display name; English help's field
 * joins with #123, and until then it is an unknown field like any other — a `400` naming it.
 *
 * Writes `users.name` only for the session's user. Calls no model, so it is not rate-limited. **The
 * name is never logged** (12 §7): ids and the error class only.
 */
export function createPutSettings(deps: Pick<RoundDeps, "auth" | "db" | "transaction">) {
  return guarded("settings_failed", async function PUT(request: Request): Promise<Response> {
    const session = await authenticate(deps, request);
    if (session instanceof Response) return session;
    const { userId } = session;

    const body = await parseBody(request, requestSchema);
    if (body instanceof Response) return body;

    try {
      await deps.transaction(async (tx) => {
        await tx
          .update(s.users)
          .set({ name: body.display_name, updatedAt: sql`now()` })
          .where(eq(s.users.id, userId));
      });
    } catch (error) {
      return writeFailed("settings_write_failed", error, {});
    }
    log("info", { event: "settings_saved" });
    return Response.json({ settings: { display_name: body.display_name } });
  });
}
