import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { companyResearch, startMockOpenAi, type MockOpenAi } from "./mock-openai";

// Company research, the call (#134): `POST /api/role-contexts/research` (07 §5.22) through the
// production build and the real port, against the mocked Responses API (11 §2). Setup's card is
// e2e/setup.spec.ts's (#136); this spec drives the route with the browser's session. It returns the
// draft and saves nothing. A saved posting for the same job (06, R4) is the integration test's and
// setup.spec.ts's: setup.spec.ts, after this one, starts with no posting saved.

test.describe.configure({ mode: "serial" });

const open = () => drizzle(E2E_URL);

async function withDb<T>(work: (db: ReturnType<typeof open>) => Promise<T>) {
  const db = open();
  try {
    return await work(db);
  } finally {
    await db.$client.end();
  }
}

async function signIn(page: Page) {
  await withDb(async (db) => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), user.id);
    await page.context().addCookies([
      { name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  });
}

/** This run's own company, so no other spec's posting is the same job. */
const COMPANY = `株式会社架空研究 ${randomUUID().slice(0, 8)}`;
const ROLE = "経理マネージャー";

let openAi: MockOpenAi;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

const researchRequests = () => openAi.requests.filter((request) => formatOf(request.body) === "company_research");

test.beforeAll(async () => {
  openAi = await startMockOpenAi((body) => (formatOf(body) === "company_research" ? companyResearch() : { fail: 400 }));
});

test.afterAll(async () => {
  await openAi?.close();
});

test("research returns the English draft with its sources, and saves nothing", async ({ page }) => {
  await signIn(page);
  const countRoleContexts = () => withDb(async (db) => (await db.select({ id: s.roleContexts.id }).from(s.roleContexts)).length);
  const before = await countRoleContexts();

  const response = await page.request.post("/api/role-contexts/research", { data: { company_name: COMPANY, role_title: ROLE } });

  expect(response.status()).toBe(200);
  const json = await response.json();
  expect(json).toMatchObject({ company_name: COMPANY, role_title: ROLE, searched: false, model_id: "gpt-5.6-sol", prompt_version: "research-1.0" });
  expect(json.draft).toContain(`${COMPANY} — ${ROLE}`);
  expect(json.draft).toContain("- It is an invented company that exists only in the e2e suite. [model knowledge]");
  expect(json.draft).toContain("The role (a guess, not from a posting)");
  // The real port asked with the web search tool and the sources, once.
  const sent = researchRequests();
  expect(sent).toHaveLength(1);
  expect(sent[0].body.tools).toEqual([{ type: "web_search" }]);
  expect(sent[0].body.include).toEqual(["web_search_call.action.sources"]);
  expect(await countRoleContexts()).toBe(before);
});
