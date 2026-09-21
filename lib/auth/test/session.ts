import { makeSignature } from "better-auth/crypto";
import type { Auth } from "../auth";

/**
 * Tests only. A real session for `userId`, minted the way Better Auth's own test-utils plugin does
 * — through the internal adapter, so the session hook still runs and a user who is not
 * ALLOWED_EMAIL is still refused — and the signed cookie the browser would carry.
 */
export async function mintSessionCookie(auth: Auth, userId: string) {
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(userId);
  const value = `${session.token}.${await makeSignature(session.token, context.secret)}`;
  return { name: context.authCookies.sessionToken.name, value, expires: session.expiresAt };
}
