import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { unauthenticated } from "../api/errors";
import { getAuth } from ".";

// The server-side re-check behind the optimistic proxy (08 §5). Each returns the user_id every query
// is scoped by.

async function currentUserId() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user.id;
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
