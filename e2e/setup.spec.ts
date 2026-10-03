import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { MAX_POSTING_CHARS } from "../lib/round/limits";
import { E2E_URL } from "./database";
import { generatedQuestions, startMockOpenAi, type MockOpenAi } from "./mock-openai";

// Setup's role context and generated questions (#47), against the production build: add a posting by
// import, pick it, read the bank-exhausted warning, and start a round whose questions are generated.
// OpenAI is the local mock (11 §2).

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

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

const COMPANY = "Invented Freight e2e";
const TITLE = "Backend Engineer";

let openAi: MockOpenAi;

test.beforeAll(async () => {
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
    // Whatever earlier specs saved: this one starts with no posting, as a first visit does.
    const postings = await db.select({ id: s.roleContexts.id }).from(s.roleContexts).where(eq(s.roleContexts.kind, "posting"));
    expect(postings).toHaveLength(0);
  });
  openAi = await startMockOpenAi((body) => (formatOf(body) === "generated_questions" ? generatedQuestions(body) : { fail: 400 }));
});

test.afterAll(async () => {
  await openAi?.close();
});

test("a role context is required: neither card is chosen until the user chooses", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");

  const cards = page.getByRole("radiogroup", { name: "Role context" }).getByRole("radio");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Posting");
  await expect(cards.nth(1)).toContainText("General practice");
  for (const card of await cards.all()) await expect(card).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Required. The two are equal.")).toBeVisible();

  const start = page.getByRole("button", { name: "Start this round" });
  await expect(start).toBeDisabled();
  await expect(page.getByTestId("setup-caption")).toHaveText("Choose a role context to start.");

  // Posting chosen, but none picked: still nothing to start with.
  await cards.nth(0).click();
  await expect(page.getByTestId("posting-form")).toBeVisible();
  await expect(start).toBeDisabled();

  await cards.nth(1).click();
  await expect(page.getByTestId("posting-form")).toBeHidden();
  await expect(start).toBeEnabled();
});

test("a posting is imported into an editable box, saved, and picked; the file is never sent", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("radio", { name: /^Posting/ }).click();

  const form = page.getByTestId("posting-form");
  const save = form.getByRole("button", { name: "Save this posting" });
  await expect(save).toBeDisabled();
  await form.getByLabel("Company").fill(COMPANY);
  await form.getByLabel("Role title").fill(TITLE);

  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(`${request.url()} ${request.headers()["content-type"] ?? ""}`);
  });

  const chooser = page.waitForEvent("filechooser");
  await form.getByRole("button", { name: "Import from a file" }).click();
  await (await chooser).setFiles("e2e/fixtures/shokumu.docx");
  const box = form.getByLabel("Posting text");
  await expect(box).not.toHaveValue("");
  await expect(form.getByText("What you save is what the questions are written from.")).toBeVisible();

  // The box is the editable copy: what is left in it is what is saved.
  const imported = await box.inputValue();
  await box.fill(`${imported}\nEdited after import.`);
  await expect(form.getByTestId("posting-count")).toHaveAttribute("data-over", "false");
  await expect(form.getByText("Saving fixes this posting as it is.")).toBeVisible();
  await save.click();

  // Saved: the form closes, the posting is in the picker and is the picked one.
  await expect(form).toBeHidden();
  const row = page.getByTestId("posting-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-checked", "true");
  await expect(row).toContainText(COMPANY);
  await expect(row).toContainText(TITLE);
  await expect(row).toContainText("shokumu.docx");
  await expect(page.getByTestId("context-card-detail").first()).toHaveText("shokumu.docx");
  await expect(page.getByRole("button", { name: "Start this round" })).toBeEnabled();

  // One JSON request and no upload: the text and the file's name went, the file did not.
  expect(sent).toEqual([expect.stringMatching(/\/api\/role-contexts application\/json$/)]);
  const stored = await withDb((db) => db.select().from(s.roleContexts).where(eq(s.roleContexts.kind, "posting")));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ companyName: COMPANY, roleTitle: TITLE, sourceFilename: "shokumu.docx" });
  expect(stored[0].body).toContain("Edited after import.");

  // On the next visit the newest posting is already picked.
  await page.reload();
  await expect(page.getByRole("radio", { name: /^Posting/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("posting-row")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("posting-form")).toBeHidden();
});

test("a posting over the cap cannot be saved, and the count says why", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("button", { name: "Add a posting" }).click();

  const form = page.getByTestId("posting-form");
  await form.getByLabel("Company").fill(COMPANY);
  await form.getByLabel("Role title").fill(TITLE);
  await form.getByLabel("Posting text").fill("a".repeat(MAX_POSTING_CHARS + 1));

  await expect(form.getByTestId("posting-count")).toHaveText("20,001 / 20,000 characters");
  await expect(form.getByTestId("posting-count")).toHaveAttribute("data-over", "true");
  await expect(form.getByRole("button", { name: "Save this posting" })).toBeDisabled();

  // The server refuses the same text whatever the client did (07 §5.3).
  const refused = await page.request.post("/api/role-contexts", {
    data: { kind: "posting", company_name: COMPANY, role_title: TITLE, body: "a".repeat(MAX_POSTING_CHARS + 1) },
  });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.code).toBe("role_context_too_large");

  // Cancel keeps nothing, and the saved posting is still the picked one.
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId("posting-row")).toHaveCount(1);
});

test("the bank-exhausted warning shows before the round starts, and the round's questions are generated", async ({ page }) => {
  await signIn(page);
  const userId = await seededUserId();
  await page.goto("/round/new");

  // Three unseen technical questions are seeded: a round of three needs none written.
  await page.getByRole("radio", { name: "Technical" }).click();
  await expect(page.getByTestId("bank-exhausted")).toBeHidden();
  await page.getByRole("radio", { name: "5 questions" }).click();
  await expect(page.getByTestId("bank-exhausted")).toHaveText(
    "There are 3 unseen Technical questions in English, and this round asks 5. The rest are written when it starts, which can take up to half a minute. If a new question turns out to match one you have already answered, it is asked as a repeat: scored, but not counted in progress.",
  );

  const before = openAi.requests.length;
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("round-question")).toBeVisible();

  // One generation call, given the picked posting, then one embedding call.
  const calls = openAi.requests.slice(before).filter((request) => request.path !== `/v1/models/gpt-5.6-sol`);
  const generation = calls.filter((request) => request.path === "/v1/responses");
  expect(generation).toHaveLength(1);
  expect(formatOf(generation[0].body)).toBe("generated_questions");
  expect(String(generation[0].body.input)).toContain(`company: ${COMPANY}`);
  expect(String(generation[0].body.input)).toContain("Edited after import.");
  expect(calls.filter((request) => request.path === "/v1/embeddings")).toHaveLength(1);

  await withDb(async (db) => {
    const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
    const [context] = await db.select().from(s.roleContexts).where(eq(s.roleContexts.id, round.roleContextId));
    expect(context).toMatchObject({ kind: "posting", companyName: COMPANY });

    const asked = await db
      .select({ body: s.questions.body, version: s.questions.generatorPromptVersion, model: s.questions.generatorModelId })
      .from(s.roundQuestions)
      .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
      .where(eq(s.roundQuestions.roundId, roundId))
      .orderBy(s.roundQuestions.position);
    expect(asked).toHaveLength(5);
    // The three seeded ones first, then the two written for this round, stamped with their prompt.
    expect(asked.slice(3).map((question) => question.version)).toEqual(["generate-technical-en-1.0", "generate-technical-en-1.0"]);
    expect(asked.slice(3).every((question) => question.model === "gpt-5.6-sol" && question.body.startsWith("Generated e2e question"))).toBe(true);

    // The second new question was compared with the first, and the comparison is on record.
    const checks = await db
      .select()
      .from(s.nearDuplicateChecks)
      .where(eq(s.nearDuplicateChecks.userId, userId))
      .orderBy(desc(s.nearDuplicateChecks.createdAt));
    expect(checks.length).toBeGreaterThanOrEqual(1);
    expect(checks[0].questionId).not.toBeNull();
    expect(checks[0].similarity).toBeLessThan(checks[0].threshold);
  });
});
