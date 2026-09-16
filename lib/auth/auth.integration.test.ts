import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { getConfig } from "../config";
import { createAuth, hashEmail } from "./auth";

// Seam 2 (docs/11-testing-plan.md §3.11): the real Google callback, driven through auth.handler
// against the migrated database. Only the token exchange is stubbed, so nothing inside Better Auth
// is — these fail if disableSignUp or the session hook is dropped from the real config.

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type Profile = { sub: string; email: string; name: string };

function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Google's callback only decodes the id_token; the signature is never checked on this path.
function unsignedIdToken(profile: Profile) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: "integration-client-id",
    iat: now,
    exp: now + 3600,
    email_verified: true,
    ...profile,
  };
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url(claims)}.`;
}

// No test calls Google: the token endpoint answers from here, and any other request fails the test.
function stubGoogle(profile: Profile) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== TOKEN_ENDPOINT) throw new Error(`unexpected network call to ${url}`);
    return Response.json({
      access_token: "fixture-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: unsignedIdToken(profile),
    });
  });
}

function cookieHeader(setCookie: string[]) {
  return setCookie.map((cookie) => cookie.slice(0, cookie.indexOf(";"))).join("; ");
}

// Mints state the way the sign-in button does, then returns from "Google" with a code.
async function signInThroughCallback(db: TestDb, profile: Profile) {
  const auth = createAuth({ db, transaction: false });
  const started = await auth.api.signInSocial({
    body: { provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" },
    returnHeaders: true,
  });
  const authorizationUrl = new URL(started.response.url ?? "");
  const state = authorizationUrl.searchParams.get("state");

  stubGoogle(profile);
  const callback = new URL("/api/auth/callback/google", getConfig().BETTER_AUTH_URL);
  callback.searchParams.set("code", "fixture-code");
  callback.searchParams.set("state", state ?? "");
  const response = await auth.handler(
    new Request(callback, {
      headers: { cookie: cookieHeader(started.headers.getSetCookie()) },
    }),
  );

  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "", "http://localhost:3000");
  return { response, location };
}

function sessionCookie(response: Response) {
  return response.headers.getSetCookie().find((cookie) => cookie.includes("session_token="));
}

async function sessionsFor(db: TestDb, email: string) {
  return db
    .select({ id: s.sessions.id })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(eq(s.users.email, email));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

afterAll(closePool);

describe("locked sign-in", () => {
  it("refuses a Google profile with no matching user, and creates none", () =>
    inRolledBackTransaction(async (db) => {
      const email = `${randomUUID()}@example.test`;

      const { response, location } = await signInThroughCallback(db, {
        sub: randomUUID(),
        email,
        name: "Stranger",
      });

      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("error")).toBe("signup_disabled");
      expect(sessionCookie(response)).toBeUndefined();
      expect(await db.select().from(s.users).where(eq(s.users.email, email))).toEqual([]);
    }));

  it("refuses a session for an email other than ALLOWED_EMAIL, logging only its hash", () =>
    inRolledBackTransaction(async (db) => {
      // A verified row that is not the allowlisted one: disableSignUp lets it through, so only
      // the session hook stands between it and a session.
      const email = `${randomUUID()}@example.test`;
      await seedUser(db, email);

      const { response, location } = await signInThroughCallback(db, {
        sub: randomUUID(),
        email,
        name: "Other",
      });

      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("error")).toBe("account_refused");
      expect(sessionCookie(response)).toBeUndefined();
      expect(await sessionsFor(db, email)).toEqual([]);

      const logged = warn.mock.calls.map((args: unknown[]) => args.map(String).join(" "));
      expect(logged).toContainEqual(
        JSON.stringify({ event: "auth_rejected", emailHash: hashEmail(email) }),
      );
      expect(logged.join("\n")).not.toContain(email);
    }));

  it("links the seeded user's Google account and starts a 30-day session", () =>
    inRolledBackTransaction(async (db) => {
      const email = getConfig().ALLOWED_EMAIL;
      await seedUser(db, email);
      const sub = randomUUID();

      const { response, location } = await signInThroughCallback(db, {
        sub,
        email,
        name: "Allowed",
      });

      expect(location.pathname).toBe("/");
      expect(location.searchParams.has("error")).toBe(false);

      const cookie = sessionCookie(response) ?? "";
      expect(cookie).toMatch(/; HttpOnly/i);
      expect(cookie).toMatch(/; Secure/i);
      expect(cookie).toMatch(/; SameSite=Lax/i);
      expect(cookie).toMatch(/; Max-Age=2592000/i);

      const [user] = await db.select().from(s.users).where(eq(s.users.email, email));
      const linked = await db
        .select({ providerId: s.accounts.providerId, accountId: s.accounts.accountId })
        .from(s.accounts)
        .where(eq(s.accounts.userId, user.id));
      expect(linked).toEqual([{ providerId: "google", accountId: sub }]);

      const [session] = await db.select().from(s.sessions).where(eq(s.sessions.userId, user.id));
      const days = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);
    }));
});
