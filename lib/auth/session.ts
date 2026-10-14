import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { unauthenticated } from "../api/errors";
import { getAuth } from ".";

// Only what a session read needs, so callers and tests are not typed against the whole instance.
export interface SessionReader {
  api: {
    getSession(options: {
      headers: Headers;
    }): Promise<{ user: { id: string }; session: { id: string } } | null>;
  };
}

// The server-side re-check behind the optimistic proxy (08 §5). Each returns the user_id every query
// is scoped by.

/**
 * The session's user and the session itself, read from request headers — route handlers pass their
 * own request's. ⚡ routes need both: the per-session rate limiter keys on the session (07 §1 rule 5),
 * every query on the user.
 */
export async function sessionOf(auth: SessionReader, requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return undefined;
  return { userId: session.user.id, sessionId: session.session.id };
}

/**
 * The session's user, or `undefined`, read once per request: the `(app)` layout reads it for the
 * header's name and the page again for its own rows.
 */
export const currentUserId = cache(async () => {
  // Headers first: at build time this is where a prerender stops, before the auth instance is built.
  const requestHeaders = await headers();
  return (await sessionOf(getAuth(), requestHeaders))?.userId;
});

/** Pages and Server Actions. No session redirects to /sign-in. */
export async function requireSession(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  return userId;
}

/**
 * Route handlers. No session is a 401 envelope, never a redirect (07 §2):
 * `const userId = await requireApiSession(); if (userId instanceof Response) return userId;`
 */
export async function requireApiSession(): Promise<string | Response> {
  return (await currentUserId()) ?? unauthenticated();
}
