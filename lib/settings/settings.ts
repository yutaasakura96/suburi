import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../../db/schema";
import { authenticate, guarded, log, parseBody, writeFailed, type Db, type RoundDeps } from "../round/http";
import { displayNameProblem } from "./display-name";

// Relative imports: the integration tests load these files outside Next's path aliases.

/**
 * What `/settings` shows (`10` §17): the display name, editable, the email, read-only, and whether
 * English help starts on. **No `user_settings` row is every default**: English help reads off (`04`).
 */
export async function loadSettings(db: Db, userId: string) {
  const [user] = await db
    .select({
      displayName: s.users.name,
      email: s.users.email,
      englishHelp: sql<boolean>`coalesce(${s.userSettings.englishHelp}, false)`,
    })
    .from(s.users)
    .leftJoin(s.userSettings, eq(s.userSettings.userId, s.users.id))
    .where(eq(s.users.id, userId));
  return user;
}

/**
 * Whether English help starts on for this user: the starting state of a Japanese practice round's
 * pill (`10` §15) and of screen 8's and Study's (§8, §16), off when the user has no `user_settings` row. **A starting state, never a gate**:
 * whether a round carries English at all is the round's (`lib/round/english-help.ts`).
 */
export async function englishHelpStartsOn(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ englishHelp: s.userSettings.englishHelp })
    .from(s.userSettings)
    .where(eq(s.userSettings.userId, userId));
  return row?.englishHelp ?? false;
}

const requestSchema = z.strictObject({
  display_name: z
    .string()
    .trim()
    .refine((value) => displayNameProblem(value) === null),
  english_help: z.boolean(),
});

/**
 * `PUT /api/settings` (`07` §5.21): the settings page's one write, **a whole replacement** of what the
 * page edits, never a partial update (`07` §4): the display name and English help, both every time.
 *
 * One transaction, for the session's user only: `users.name` is set and `user_settings` upserted on
 * `user_id` (`04`). Calls no model, so it is not rate-limited. **The name is never logged** (12 §7):
 * ids and the error class only.
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
        await tx
          .insert(s.userSettings)
          .values({ userId, englishHelp: body.english_help })
          .onConflictDoUpdate({
            target: s.userSettings.userId,
            set: { englishHelp: body.english_help, updatedAt: sql`now()` },
          });
      });
    } catch (error) {
      return writeFailed("settings_write_failed", error, {});
    }
    log("info", { event: "settings_saved" });
    return Response.json({ settings: { display_name: body.display_name, english_help: body.english_help } });
  });
}
