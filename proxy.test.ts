import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

const SESSION = "better-auth.session_token=fixture";

describe("proxy", () => {
  it("redirects a page without a session to /sign-in", () => {
    const response = proxy(request("/progress"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/sign-in");
  });

  it("answers /api/* without a session with 401 and the envelope, never a redirect", async () => {
    const response = proxy(request("/api/answers/presign"));
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it.each(["/sign-in", "/api/auth/callback/google", "/api/auth"])("leaves %s public", (path) => {
    expect(proxy(request(path)).headers.get("x-middleware-next")).toBe("1");
  });

  it("does not treat a path that merely starts with /api/auth as public", () => {
    expect(proxy(request("/api/authors")).status).toBe(401);
  });

  // Vercel Cron sends no cookie; the route itself refuses a caller without CRON_SECRET (07 §5.17).
  it.each(["/api/cron/self-check", "/api/cron/digest"])("lets %s through to its own secret check", (path) => {
    expect(proxy(request(path)).headers.get("x-middleware-next")).toBe("1");
  });

  it("does not exempt any other cron path", () => {
    expect(proxy(request("/api/cron")).status).toBe(401);
    expect(proxy(request("/api/cronjobs")).status).toBe(401);
    expect(proxy(request("/api/cron/other")).status).toBe(401);
    expect(proxy(request("/api/cron/self-check/other")).status).toBe(401);
  });

  it("keeps /status behind the session like every other page", () => {
    expect(proxy(request("/status")).status).toBe(307);
  });

  it("lets a request carrying a session cookie through, secure-prefixed or not", () => {
    expect(proxy(request("/", SESSION)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/x", `__Secure-${SESSION}`)).headers.get("x-middleware-next")).toBe(
      "1",
    );
  });
});
