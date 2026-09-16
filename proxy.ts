import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { unauthenticated } from "./lib/api/errors";

function isPublic(pathname: string) {
  return pathname === "/sign-in" || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

/**
 * Optimistic (08 §5): it reads the cookie without validating the session, so it only decides where
 * an unauthenticated request lands. Every page, Server Action and Route Handler re-checks through
 * lib/auth/session.ts — this is not the security boundary.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname) || getSessionCookie(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return unauthenticated();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

// Everything but build output and the favicon, so a route added later is covered by default.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
