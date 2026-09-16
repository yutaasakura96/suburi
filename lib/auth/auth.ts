import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";
import { getConfig } from "../config";

// Relative imports: the integration tests load this file outside Next's path aliases.

const DAY = 60 * 60 * 24;

// Keyed, so a log reader cannot recover an address by hashing guesses (03 §8: email hash only).
export function hashEmail(email: string) {
  return createHmac("sha256", getConfig().BETTER_AUTH_SECRET)
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/**
 * The locked door (08 §2, §3). Two independent locks: `disableSignUp` refuses a Google account with
 * no user row, and the session hook refuses any user whose email is not ALLOWED_EMAIL.
 *
 * `transaction` is the only thing tests change: they bind the client of a rolled-back transaction
 * and turn the adapter's own transactions off, so every auth write is undone.
 */
export function createAuth({ db, transaction }: { db: NodePgDatabase; transaction: boolean }) {
  const config = getConfig();

  return betterAuth({
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema, transaction }),
    session: { expiresIn: 30 * DAY, updateAge: DAY },
    // Set explicitly rather than inferred from BETTER_AUTH_URL's scheme, so localhost gets the same
    // cookie as production.
    advanced: { defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" } },
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        disableSignUp: true,
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ email: schema.users.email })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId));
            const email = user?.email ?? "";
            if (email.toLowerCase() === config.ALLOWED_EMAIL.toLowerCase()) return;

            console.warn(JSON.stringify({ event: "auth_rejected", emailHash: hashEmail(email) }));
            // The callback redirects to errorCallbackURL with ?error=<code>. Says nothing of why.
            throw new APIError("UNAUTHORIZED", {
              code: "account_refused",
              message: "This account cannot sign in.",
            });
          },
        },
      },
    },
    // Lets a Server Action's auth.api call set cookies. Must stay the last plugin.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
