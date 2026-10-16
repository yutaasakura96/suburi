import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { fakeCompanyResearcher, fixtureResearch } from "../ai/fake-round-ports";
import type { ResearchRequest, ResearchResult } from "../ai/research";
import type { CallOptions } from "../ai/score";
import { ModelCallFailed } from "../ai/upstream";
import { RATE_LIMITS } from "../api/rate-limit";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { RESEARCH_TIMEOUT_MS, createResearch } from "./research";
import { createPostRoleContext } from "./role-context";

// Company research, the call (#134): `POST /api/role-contexts/research` (07 §5.22). Through the
// handlers, against the migrated test database, with a real Better Auth session; only the model port
// is faked (11 §2). **It saves nothing**, a saved posting for the same job wins before any model call
// (06, R4), and nothing it is sent or returns is logged (12 §7).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

/** Sentinels in what the user sends and in what the model returns: no row and no log line may hold either. */
const COMPANY = "株式会社キリン架空 KESTREL-SENTINEL-7134";
const ROLE = "経理マネージャー";
const RETURNED_SENTINEL = "OSPREY-SENTINEL-7134";

let logged: string[] = [];

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

function returned(request: ResearchRequest): ResearchResult {
  const result = fixtureResearch(request);
  return { ...result, draft: `${result.draft}\n- ${RETURNED_SENTINEL} [model knowledge]` };
}

async function setUp(db: TestDb, respond: (request: ResearchRequest, options: CallOptions) => ResearchResult | Promise<ResearchResult> = returned) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const researcher = fakeCompanyResearcher(respond);
  const base = { auth, db, transaction: async <T>(work: (tx: TestDb) => Promise<T>) => work(db) };
  const handlers = { roleContext: createPostRoleContext(base), research: createResearch({ ...base, researcher }) };
  const headers = { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` };
  async function call(handler: (request: Request) => Promise<Response>, body: unknown) {
    const response = await handler(new Request("http://localhost:3000/api/x", { method: "POST", headers, body: JSON.stringify(body) }));
    const text = await response.text();
    return { status: response.status, json: JSON.parse(text), text };
  }
  const research = (body: unknown = { company_name: COMPANY, role_title: ROLE }) => call(handlers.research, body);
  const post = (company_name: string, role_title: string) =>
    call(handlers.roleContext, { kind: "posting", company_name, role_title, body: "求人票の本文。" });
  return { userId: user.id, researcher, research, post };
}

/** Every public table whose rows, as text, contain `needle` — any column, any table. */
async function tablesHolding(db: TestDb, needle: string) {
  const { rows } = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`);
  const holding: string[] = [];
  for (const { table_name: table } of rows) {
    const found = await db.execute<{ found: boolean }>(
      sql`select exists (select 1 from ${sql.identifier(table)} t where t::text like ${`%${needle}%`}) as found`,
    );
    if (found.rows[0].found) holding.push(table);
  }
  return holding;
}

describe("the research saves nothing (07 §5.22)", () => {
  it("returns the draft, the model and the prompt version — and writes no role context, no row holding either text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roleContextsBefore = await db.select().from(s.roleContexts);

      const response = await world.research({ company_name: `  ${COMPANY} `, role_title: ROLE });

      expect(response.status).toBe(200);
      expect(response.json).toEqual({
        company_name: COMPANY,
        role_title: ROLE,
        draft: returned({ companyName: COMPANY, roleTitle: ROLE }).draft,
        searched: true,
        model_id: "fake-research-2026-01-01",
        prompt_version: "research-fake",
      });
      // Trimmed before the model saw it, and bounded.
      expect(world.researcher.requests).toEqual([{ companyName: COMPANY, roleTitle: ROLE }]);
      expect(world.researcher.options[0].timeoutMs).toBe(RESEARCH_TIMEOUT_MS);

      expect(await db.select().from(s.roleContexts)).toEqual(roleContextsBefore);
      expect(await tablesHolding(db, "KESTREL-SENTINEL")).toEqual([]);
      expect(await tablesHolding(db, RETURNED_SENTINEL)).toEqual([]);
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain("KESTREL-SENTINEL");
        expect(line).not.toContain(RETURNED_SENTINEL);
        expect(line).not.toContain(ROLE);
      }
      expect(logged.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({ event: "research", searched: true, web_facts: 1, model_knowledge_facts: 4, dropped_links: 0 }),
      );
    }));

  it("says when it did not search: the fallback's draft is model knowledge only", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, (request) => fixtureResearch(request, { searched: false }));
      const response = await world.research();
      expect(response.status).toBe(200);
      expect(response.json.searched).toBe(false);
      expect(response.json.draft).not.toContain("https://");
    }));

  it("is 502 research_failed on a failed call, once, with only the error class, and saves nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, () => {
        throw new ModelCallFailed("Research", "malformed_output");
      });

      const response = await world.research();

      expect(response.status).toBe(502);
      expect(response.json.error.code).toBe("research_failed");
      expect(response.json.error.detail).toEqual({ error_class: "malformed_output" });
      expect(world.researcher.calls).toBe(1);
      expect(response.text).not.toContain("KESTREL-SENTINEL");
      expect(await db.select().from(s.roleContexts)).toEqual([]);
      for (const line of logged) expect(line).not.toContain("KESTREL-SENTINEL");
    }));

  it("is bounded: a call that outlives its budget fails as upstream_timeout", () =>
    inRolledBackTransaction(async (db) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const world = await setUp(
          db,
          (_, { signal }) =>
            new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new ModelCallFailed("Research", "aborted")))),
        );
        const pending = world.research();
        await vi.waitFor(() => expect(world.researcher.calls).toBe(1));
        await vi.advanceTimersByTimeAsync(RESEARCH_TIMEOUT_MS);
        const response = await pending;

        expect(response.status).toBe(502);
        expect(response.json.error.detail.error_class).toBe("upstream_timeout");
      } finally {
        vi.useRealTimers();
      }
    }));
});

describe("a saved posting wins (06, R4)", () => {
  it.each([
    ["the same names", COMPANY, ROLE],
    ["full-width letters, other spacing and case", "株式会社キリン架空　ｋｅｓｔｒｅｌ-sentinel-7134", `  ${ROLE} `],
  ])("refuses %s with 422 research_posting_exists naming the posting, before any model call", (_, company, role) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const posting = await world.post(COMPANY, ROLE);
      expect(posting.status).toBe(201);
      const before = await db.select().from(s.roleContexts);

      const response = await world.research({ company_name: company, role_title: role });

      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("research_posting_exists");
      expect(response.json.error.detail).toEqual({ role_context_id: posting.json.id });
      expect(response.text).not.toContain("KESTREL-SENTINEL");
      expect(world.researcher.calls).toBe(0);
      expect(await db.select().from(s.roleContexts)).toEqual(before);
    }),
  );

  it("researches when only the company matches, or the posting is another user's", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.post(COMPANY, "データエンジニア")).status).toBe(201);
      await seedUser(db, "someone-else@example.test");
      const [other] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "someone-else@example.test"));
      await db.insert(s.roleContexts).values({ userId: other.id, kind: "posting", companyName: COMPANY, roleTitle: ROLE, body: "他人の求人票。" });

      const response = await world.research();

      expect(response.status).toBe(200);
      expect(world.researcher.calls).toBe(1);
    }));
});

describe("the request is checked before any model call", () => {
  it.each([
    ["a blank company", { company_name: "  ", role_title: ROLE }, ["company_name"]],
    ["a blank role", { company_name: COMPANY, role_title: "\n" }, ["role_title"]],
    ["a missing role", { company_name: COMPANY }, ["role_title"]],
    ["a company over 200 code points", { company_name: "𠮷".repeat(201), role_title: ROLE }, ["company_name"]],
    ["an unknown field", { company_name: COMPANY, role_title: ROLE, body: "notes" }, ["body"]],
  ])("refuses %s with a 400 naming the field", (_, body, fields) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const response = await world.research(body);
      expect(response.status).toBe(400);
      expect(response.json.error).toMatchObject({ code: "invalid_request", detail: { fields } });
      expect(world.researcher.calls).toBe(0);
    }),
  );

  it("accepts a name of exactly 200 code points", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      expect((await world.research({ company_name: "𠮷".repeat(200), role_title: ROLE })).status).toBe(200);
    }));

  it("is 401 with no session, and counts nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const response = await createResearch({ auth: createAuth({ db, transaction: false }), db, transaction: (work) => work(db), researcher: world.researcher })(
        new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      );
      expect(response.status).toBe(401);
      expect(await db.select().from(s.rateLimitWindows)).toEqual([]);
    }));

  it("has its own rate-limit bucket: the request past the limit is 429 before the body is read", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { limit } = RATE_LIMITS.research;
      expect(limit).toBe(6);

      for (let request = 0; request < limit; request += 1) expect((await world.research({ company_name: "", role_title: "" })).status).toBe(400);
      const response = await world.research();

      expect(response.status).toBe(429);
      expect(world.researcher.calls).toBe(0);
      const windows = await db.select().from(s.rateLimitWindows).where(eq(s.rateLimitWindows.route, "research"));
      expect(windows).toEqual([expect.objectContaining({ count: limit + 1 })]);
    }));
});
