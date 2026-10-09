import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { spendThresholdUsd } from "../lib/monitor/thresholds";
import { E2E_CRON_SECRET, E2E_URL } from "./database";

// The monitoring jobs, the status page and Home's status line (11 §3.17, 10 §1 and §14), against the
// production build. The cron routes are called the way Vercel Cron calls them. Only this spec writes
// runs; other specs may leave a red CV counter behind, so nothing here assumes the checks are clear
// except where this spec writes the run itself.

test.describe.configure({ mode: "serial" });

const SENTINEL = "ZEBRA-SENTINEL-6630";
const HOUR = 60 * 60 * 1000;

const open = () => drizzle(E2E_URL);

async function withDb<T>(work: (db: ReturnType<typeof open>) => Promise<T>) {
  const db = open();
  try {
    return await work(db);
  } finally {
    await db.$client.end();
  }
}

async function seededUserId() {
  return withDb(async (db) => {
    const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
    return user.id;
  });
}

async function signIn(page: Page) {
  await withDb(async (db) => {
    const cookie = await mintSessionCookie(createAuth({ db, transaction: true }), await seededUserId());
    await page.context().addCookies([
      { name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  });
}

/** A self-check run written directly, every check clear, dated `createdAt`: a state this spec controls. */
async function writeClearRun(createdAt: Date) {
  const userId = await seededUserId();
  await withDb(async (db) => {
    const [run] = await db.insert(s.cronRuns).values({ job: "self-check", createdAt }).returning({ id: s.cronRuns.id });
    await db.insert(s.cronReadings).values(
      s.SELF_CHECK_SIGNALS.map((signal) => ({ runId: run.id, userId, signal, value: 0, threshold: 0, isRed: false })),
    );
  });
}

const statusLine = (page: Page) => page.getByTestId("home-status-line");

test("/status without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/status");
  await expect(page).toHaveURL("/sign-in");
});

test("the cron routes are 401 without the secret, with no cookie in play", async ({ request }) => {
  for (const job of ["self-check", "digest"]) {
    expect((await request.get(`/api/cron/${job}`)).status()).toBe(401);
    expect((await request.get(`/api/cron/${job}`, { headers: { authorization: "Bearer wrong-secret-entirely" } })).status()).toBe(401);
  }
});

test("before any run, Home and the status page both say self-check has never run", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(statusLine(page)).toContainText("Self-check has never run.");
  await statusLine(page).getByRole("link", { name: "Open the status page" }).click();

  await expect(page).toHaveURL("/status");
  await expect(page.getByTestId("status-staleness")).toHaveText("Self-check has never run. Nothing below has been checked.");
  await expect(page.getByTestId("job-selfCheck")).toContainText("Never");
  await expect(page.getByTestId("check-scoring_pending_over_24h")).toContainText("No reading");
  await expect(page.getByText("No weekly digest has run yet.")).toBeVisible();
});

test("the status page and an unknown path both carry the nav, with a link to Home", async ({ page }) => {
  await signIn(page);
  await page.goto("/status");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");

  expect((await page.goto("/no-such-screen"))?.status()).toBe(404);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
});

test("a self-check older than 48 hours is stale, on Home and first on the page", async ({ page }) => {
  await writeClearRun(new Date(Date.now() - 49 * HOUR));
  await signIn(page);

  await page.goto("/");
  await expect(statusLine(page)).toContainText("Self-check has not run since");
  await page.goto("/status");
  await expect(page.getByTestId("status-staleness")).toContainText("Self-check has not run since");
});

test("an authenticated call to each route writes a run the status page shows", async ({ page, request }) => {
  const headers = { authorization: `Bearer ${E2E_CRON_SECRET}` };
  for (const job of ["self-check", "digest"]) {
    const response = await request.get(`/api/cron/${job}`, { headers });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ job, run_id: expect.any(String) });
  }

  await signIn(page);
  await page.goto("/status");
  await expect(page.getByTestId("status-staleness")).toHaveCount(0);
  await expect(page.getByTestId("job-selfCheck")).not.toContainText("Never");
  await expect(page.getByTestId("job-digest")).not.toContainText("Never");
  await expect(page.getByTestId("check-scoring_pending_over_24h")).toContainText("OK");
  // The threshold scales with the rounds started this week, and round.spec.ts runs first. The
  // database is fresh each run, so every round in it started this week.
  const rounds = await withDb((db) => db.$count(s.rounds));
  await expect(page.getByTestId("check-spend_week_to_date_usd")).toContainText(`above $${spendThresholdUsd(rounds).toFixed(2)}`);
  await expect(page.getByTestId("digest-week")).toHaveText(/^\d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId("figure-digest_rounds_started")).toHaveText("0");
});

test("a red check puts one line on Home, and no record text reaches either page", async ({ page, request }) => {
  const userId = await seededUserId();
  // $4.00 of tokens this week per round round.spec.ts started, plus one: above the $1.20 per round
  // the threshold allows, so the spend check fires however many rounds that spec started.
  const rounds = await withDb((db) => db.$count(s.rounds));
  const spend = 4 * (rounds + 1);
  await withDb((db) =>
    db.insert(s.questions).values({
      userId,
      language: "en",
      roundType: "hr",
      origin: "generated",
      body: `Tell me about ${SENTINEL}.`,
      generatorModelId: "gpt-5.6-sol",
      generatorPromptVersion: "generate-e2e",
      tokensIn: 1_000_000 * (rounds + 1),
      tokensOut: 0,
    }),
  );
  const run = await request.get("/api/cron/self-check", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(await run.text()).not.toContain(SENTINEL);

  await signIn(page);
  await page.goto("/");
  await expect(statusLine(page)).toContainText("red:");
  await expect(statusLine(page)).toContainText("Spend this week");
  expect(await page.content()).not.toContain(SENTINEL);

  await page.goto("/status");
  await expect(page.getByTestId("check-spend_week_to_date_usd")).toContainText("Red");
  // This row's tokens, and the cents the other specs' takes and calls cost beside them.
  const shown = Number((await page.getByTestId("check-spend_week_to_date_usd").textContent())?.match(/\$([\d.]+)/)?.[1]);
  expect(shown).toBeGreaterThanOrEqual(spend);
  expect(shown).toBeLessThan(spend + 1);
  expect(await page.content()).not.toContain(SENTINEL);
});

test("Home shows nothing when the newest self-check is fresh and clear", async ({ page }) => {
  await writeClearRun(new Date());
  await signIn(page);
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  await expect(statusLine(page)).toHaveCount(0);
});
