import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { unauthenticated } from "../api/errors";
import { getAuth } from ".";

// Only what a session read needs, so callers and tests are not typed against the whole instance.
export interface SessionReader {
  api: { getSession(options: { headers: Headers }): Promise<{ user: { id: string } } | null> };
}

// The server-side re-check behind the optimistic proxy (08 §5). Each returns the user_id every query
// is scoped by.

/** The session's user, read from request headers. Route handlers pass their own request's. */
export async function sessionUserId(auth: SessionReader, requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  return session?.user.id;
}

async function currentUserId() {
  return sessionUserId(getAuth(), await headers());
}

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
