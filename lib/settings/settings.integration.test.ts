import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createPutSettings, loadSettings } from "./settings";

// 11 §3.26, the display name: PUT /api/settings through its handler, against the migrated test
// database, with a real Better Auth session.

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Recognisable text that must never reach a log line (12 §7).
const SENTINEL = "ZEBRA-SENTINEL-1220";

let logged: string[];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

afterAll(closePool);

async function setUp(db: TestDb, { failWrite = false } = {}) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const handler = createPutSettings({
    auth,
    db,
    transaction: async (work) => {
      if (failWrite) throw Object.assign(new Error("write refused"), { code: "57014" });
      return work(db);
    },
  });

  async function put(body: unknown, { signedIn = true } = {}) {
    const response = await handler(
      new Request("http://localhost:3000/api/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: response.status, json: await response.json() };
  }

  const nameOf = async (userId = user.id) => (await loadSettings(db, userId)).displayName;
  return { userId: user.id, put, nameOf };
}

describe("PUT /api/settings", () => {
  it("writes users.name, trimmed, and answers with the settings", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db);
      const response = await put({ display_name: `  ${SENTINEL} Example  ` });
      expect(response).toEqual({ status: 200, json: { settings: { display_name: `${SENTINEL} Example` } } });
      expect(await nameOf()).toBe(`${SENTINEL} Example`);
      expect(logged.join("\n")).not.toContain(SENTINEL);
    });
  });

  it("counts code points: 80 of them are accepted, 81 are a 400", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db);
      // 𠮷 is two UTF-16 units and one code point.
      expect((await put({ display_name: "𠮷".repeat(80) })).status).toBe(200);
      expect(await nameOf()).toBe("𠮷".repeat(80));

      const tooLong = await put({ display_name: "a".repeat(81) });
      expect(tooLong).toMatchObject({ status: 400, json: { error: { code: "invalid_request", detail: { fields: ["display_name"] } } } });
      expect(await nameOf()).toBe("𠮷".repeat(80));
    });
  });

  it.each([
    ["blank", { display_name: "   " }, ["display_name"]],
    ["missing", {}, ["display_name"]],
    ["not a string", { display_name: 7 }, ["display_name"]],
    ["unknown", { display_name: "Jordan", email: "other@example.test" }, ["email"]],
  ])("a %s field is a 400 naming it, and writes nothing", async (_, body, fields) => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db);
      const before = await nameOf();
      const response = await put(body);
      expect(response).toMatchObject({ status: 400, json: { error: { code: "invalid_request", detail: { fields } } } });
      expect(await nameOf()).toBe(before);
    });
  });

  it("a body that is not JSON is a 400", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put } = await setUp(db);
      expect((await put("{not json")).status).toBe(400);
    });
  });

  it("without a session is a 401 and writes nothing", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db);
      const before = await nameOf();
      const response = await put({ display_name: "Jordan" }, { signedIn: false });
      expect(response).toMatchObject({ status: 401, json: { error: { code: "unauthenticated" } } });
      expect(await nameOf()).toBe(before);
    });
  });

  it("one user's write never reaches another user's row", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db);
      const other = await insertUser(db);
      expect((await put({ display_name: "Jordan" })).status).toBe(200);
      expect(await nameOf(other)).toBe("fixture");
    });
  });

  it("a failed write is 500 write_failed with the error class, and the name is unchanged", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, nameOf } = await setUp(db, { failWrite: true });
      const before = await nameOf();
      const response = await put({ display_name: `${SENTINEL}` });
      expect(response).toMatchObject({
        status: 500,
        json: { error: { code: "write_failed", detail: { error_class: "pg_57014" } } },
      });
      expect(await nameOf()).toBe(before);
      expect(logged.join("\n")).not.toContain(SENTINEL);
    });
  });

  it("leaves the email alone", async () => {
    await inRolledBackTransaction(async (db) => {
      const { put, userId } = await setUp(db);
      await put({ display_name: "Jordan" });
      const [row] = await db.execute<{ email: string }>(sql`select email from users where id = ${userId}`).then((r) => r.rows);
      expect(row.email).toBe(getConfig().ALLOWED_EMAIL);
    });
  });
});
