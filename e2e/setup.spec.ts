import { readFile } from "node:fs/promises";
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
import { companyResearch, generatedQuestions, silentPcm, startMockOpenAi, type MockFailure, type MockOpenAi } from "./mock-openai";

// Setup's role context and generated questions (#47), against the production build: add a posting by
// import, pick it, read the bank-exhausted warning, and start a round whose questions are generated.
// Then the research card (#136): research a role, edit and save the notes, start a round on them, and
// the two ways a saved posting wins. OpenAI is the local mock (11 §2).

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
/** How the mock answers the next `company_research` call; a test swaps it to hold or fail one. */
let research: () => object | MockFailure | Promise<object | MockFailure> = companyResearch;
const researchCalls = () => openAi.requests.filter((request) => formatOf(request.body) === "company_research");

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
  // The round Setup starts is realistic, so its first question is spoken (07 §5.15).
  openAi = await startMockOpenAi(
    (body) => {
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      if (formatOf(body) === "company_research") return research();
      return { fail: 400 };
    },
    { speech: silentPcm },
  );
});

test.afterAll(async () => {
  await openAi?.close();
});

test("a role context is required: neither card is chosen until the user chooses", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");

  const cards = page.getByRole("radiogroup", { name: "Role context" }).getByRole("radio");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("Posting");
  await expect(cards.nth(1)).toContainText("AI research");
  await expect(cards.nth(2)).toContainText("General practice");
  for (const card of await cards.all()) await expect(card).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Required. The three are equal.")).toBeVisible();

  const start = page.getByRole("button", { name: "Start this round" });
  await expect(start).toBeDisabled();
  await expect(page.getByTestId("setup-caption")).toHaveText("Choose a role context to start.");

  // Posting chosen, but none picked: still nothing to start with.
  await cards.nth(0).click();
  await expect(page.getByTestId("posting-form")).toBeVisible();
  await expect(start).toBeDisabled();

  // AI research chosen, none saved: the form is open and there is nothing to start with yet.
  await cards.nth(1).click();
  await expect(page.getByTestId("research-form")).toBeVisible();
  await expect(start).toBeDisabled();

  await cards.nth(2).click();
  await expect(page.getByTestId("posting-form")).toBeHidden();
  await expect(page.getByTestId("research-form")).toBeHidden();
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
  for (const name of ["Technical", "English", "3 questions"]) await page.getByRole("radio", { name, exact: true }).click();
  await expect(page.getByTestId("bank-exhausted")).toBeHidden();
  await page.getByRole("radio", { name: "5 questions" }).click();
  await expect(page.getByTestId("bank-exhausted")).toHaveText(
    "There are 3 unseen Technical questions in English, and this round asks 5. The rest are written when it starts, which can take up to a minute. If a new question turns out to match one you have already answered, it is asked as a repeat: scored, but not counted in progress.",
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

test("posting names and imported filenames use code point limits", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("button", { name: "Add a posting" }).click();

  const form = page.getByTestId("posting-form");
  const name = "🦊".repeat(200);
  await form.getByLabel("Company").fill(name);
  await form.getByLabel("Role title").fill(`${name}🦊`);
  await expect(form.getByLabel("Company")).toHaveValue(name);
  await expect(form.getByLabel("Role title")).toHaveValue(name);

  const filename = `${"🦊".repeat(250)}.docx`;
  const chooser = page.waitForEvent("filechooser");
  await form.getByRole("button", { name: "Import from a file" }).click();
  await (await chooser).setFiles({
    name: filename,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await readFile("e2e/fixtures/shokumu.docx"),
  });
  await expect(form.getByLabel("Posting text")).not.toHaveValue("");
  await form.getByRole("button", { name: "Save this posting" }).click();
  await expect(form).toBeHidden();

  const stored = await withDb((db) => db.select().from(s.roleContexts).where(eq(s.roleContexts.companyName, name)));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ companyName: name, roleTitle: name, sourceFilename: filename });
});

test("a posting stays fixed while its save is pending", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("button", { name: "Add a posting" }).click();

  const form = page.getByTestId("posting-form");
  const company = "Pending save e2e";
  await form.getByLabel("Company").fill(company);
  await form.getByLabel("Role title").fill("Engineer");
  await form.getByLabel("Posting text").fill("Build a private interview simulator.");

  let startRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => { startRequest = resolve; });
  let releaseRequest!: () => void;
  const requestReleased = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route("**/api/role-contexts", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    startRequest();
    await requestReleased;
    await route.continue();
  });

  try {
    await form.getByRole("button", { name: "Save this posting" }).click();
    await requestStarted;
    await expect(form.getByLabel("Company")).toBeDisabled();
    await expect(form.getByLabel("Role title")).toBeDisabled();
    await expect(form.getByLabel("Posting text")).toBeDisabled();
    await expect(form.getByRole("button", { name: "Import from a file" })).toBeDisabled();
    await expect(form.locator('input[type="file"]')).toBeDisabled();
    await expect(form.getByRole("button", { name: "Save this posting" })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(form.getByLabel("Company")).toHaveValue(company);
  } finally {
    releaseRequest();
  }

  await expect(form).toBeHidden();
  const stored = await withDb((db) => db.select().from(s.roleContexts).where(eq(s.roleContexts.companyName, company)));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ companyName: company, roleTitle: "Engineer", body: "Build a private interview simulator." });
});

const RESEARCHED = "Invented Research e2e";
const RESEARCHED_TITLE = "Data Engineer";
const EDIT = "- Edited in Setup e2e. [model knowledge]";

/** Holds the next research call open until the returned function is called. */
function holdResearch() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  research = async () => {
    await released;
    research = companyResearch;
    return companyResearch();
  };
  return release;
}

test("a role is researched, its notes edited and saved beside the draft, and a round starts on them", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("radio", { name: /^AI research/ }).click();

  const form = page.getByTestId("research-form");
  const run = form.getByRole("button", { name: "Research this role" });
  await expect(run).toBeDisabled();
  await form.getByLabel("Company").fill(RESEARCHED);
  await form.getByLabel("Role title").fill(RESEARCHED_TITLE);
  await expect(form.getByText("Nothing is saved until you save the notes.")).toBeVisible();

  // The wait line while the route runs, the names fixed under it.
  const release = holdResearch();
  const calls = researchCalls().length;
  await run.click();
  await expect(form.getByTestId("research-wait")).toContainText("Researching the company and the role.");
  await expect(form.getByLabel("Company")).toBeDisabled();
  release();

  // The draft in an editable box: each fact with its source, the role part a guess. No link, no list.
  const notes = form.getByLabel("Notes", { exact: true });
  await expect(notes).toHaveValue(/- It is an invented company that exists only in the e2e suite\. \[model knowledge\]/);
  await expect(notes).toHaveValue(/The role \(a guess, not from a posting\)/);
  await expect(form.getByTestId("research-wait")).toBeHidden();
  await expect(form.getByTestId("research-links")).toBeHidden();
  expect(researchCalls()).toHaveLength(calls + 1);
  await expect(form.getByText("Saved research is never edited")).toBeVisible();

  const draft = await notes.inputValue();
  await notes.fill(`${draft}\n${EDIT}`);
  await form.getByRole("button", { name: "Save these notes" }).click();

  // Saved: the form closes, the research is in the picker and picked, and the card says when.
  await expect(form).toBeHidden();
  const row = page.getByTestId("research-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-checked", "true");
  await expect(row).toContainText(RESEARCHED);
  await expect(page.getByTestId("context-card-detail").nth(1)).toContainText("Researched notes, saved");

  // The edited notes are the body; the draft is kept beside them as the route returned it.
  const [stored] = await withDb((db) => db.select().from(s.roleContexts).where(eq(s.roleContexts.companyName, RESEARCHED)));
  expect(stored).toMatchObject({ kind: "researched", roleTitle: RESEARCHED_TITLE, researchDraft: draft.trim() });
  expect(stored.body).toContain(EDIT);
  expect(stored.researchDraft).not.toContain(EDIT);

  // On the next visit the newest saved context is the research, already picked.
  await page.reload();
  await expect(page.getByRole("radio", { name: /^AI research/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("research-row")).toHaveAttribute("aria-checked", "true");

  // More than the bank holds unseen, so the round writes questions from the notes.
  for (const name of ["Technical", "English", "7 questions"]) await page.getByRole("radio", { name, exact: true }).click();
  await expect(page.getByTestId("bank-exhausted")).toBeVisible();
  const before = openAi.requests.length;
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("round-question")).toBeVisible();

  // The questions are written from the edited notes.
  const generation = openAi.requests.slice(before).filter((request) => formatOf(request.body) === "generated_questions");
  expect(generation).toHaveLength(1);
  expect(String(generation[0].body.input)).toContain(`company: ${RESEARCHED}`);
  expect(String(generation[0].body.input)).toContain(EDIT);
  const [round] = await withDb((db) => db.select().from(s.rounds).where(eq(s.rounds.id, roundId)));
  expect(round.roleContextId).toBe(stored.id);
});

test("the same job as a saved posting is not researched: the posting is used", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  await page.getByRole("radio", { name: /^AI research/ }).click();
  await page.getByRole("button", { name: "Research a company" }).click();

  // Equal after tidying: spacing and case.
  const form = page.getByTestId("research-form");
  await form.getByLabel("Company").fill(`  ${COMPANY.toUpperCase().replace(" ", "  ")}`);
  await form.getByLabel("Role title").fill(TITLE.toLowerCase());
  const calls = researchCalls().length;

  await expect(form.getByTestId("research-precedence")).toContainText("A saved posting is for this company and role. It is used, and no research is run.");
  await expect(form.getByRole("button", { name: "Research this role" })).toBeHidden();
  await form.getByRole("button", { name: "Use that posting" }).click();

  await expect(page.getByRole("radio", { name: /^Posting/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("posting-row").and(page.locator('[aria-checked="true"]'))).toContainText(COMPANY);
  expect(researchCalls()).toHaveLength(calls);
});

test("the same company under another title is asked about first: yes uses the posting, no researches", async ({ page }) => {
  await signIn(page);
  await page.goto("/round/new");
  const researchCard = page.getByRole("radio", { name: /^AI research/ });
  const form = page.getByTestId("research-form");
  const calls = researchCalls().length;

  async function ask() {
    await researchCard.click();
    await page.getByRole("button", { name: "Research a company" }).click();
    await form.getByLabel("Company").fill(COMPANY);
    await form.getByLabel("Role title").fill("Platform Engineer");
    await form.getByRole("button", { name: "Research this role" }).click();
    await expect(form.getByTestId("research-same-company")).toContainText(
      `A posting at ${COMPANY} is already saved, for ${TITLE}. Is this the same job?`,
    );
  }

  // Yes: that posting is picked, and nothing is researched.
  await ask();
  await form.getByRole("button", { name: `Yes — use ${TITLE}` }).click();
  await expect(page.getByRole("radio", { name: /^Posting/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("posting-row").and(page.locator('[aria-checked="true"]'))).toContainText(COMPANY);
  expect(researchCalls()).toHaveLength(calls);

  // No: researched. A failed research says the catalogue's sentence, and nothing is saved.
  await ask();
  research = () => {
    research = companyResearch;
    return { fail: 500 };
  };
  await form.getByRole("button", { name: "No — research it" }).click();
  await expect(form.getByRole("alert")).toHaveText("The research could not be done. Nothing was saved. Try again.");
  expect(researchCalls()).toHaveLength(calls + 1);

  await form.getByRole("button", { name: "Research this role" }).click();
  await form.getByRole("button", { name: "No — research it" }).click();
  const notes = form.getByLabel("Notes", { exact: true });
  await expect(notes).toHaveValue(new RegExp(`${COMPANY} — Platform Engineer`));
  expect(researchCalls()).toHaveLength(calls + 2);

  // A refused save says the notes are too long, in the card's own words, and keeps them.
  await page.route("**/api/role-contexts", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 422, json: { error: { code: "role_context_too_large", message: "e2e" } } })
      : route.continue(),
  );
  await form.getByRole("button", { name: "Save these notes" }).click();
  await expect(form.getByRole("alert")).toHaveText("The notes are too long. Shorten them and save again.");
  await page.unroute("**/api/role-contexts");
  await form.getByRole("button", { name: "Save these notes" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId("research-row").first()).toContainText("Platform Engineer");
  await expect(page.getByTestId("research-row").first()).toHaveAttribute("aria-checked", "true");

  // A posting for that job saved since: the research, picked again, says the posting is used, and is.
  const posting = await page.request.post("/api/role-contexts", {
    data: { kind: "posting", company_name: COMPANY, role_title: "Platform Engineer", body: "An invented platform posting." },
  });
  expect(posting.status()).toBe(201);
  await page.reload();
  await researchCard.click();
  await expect(page.getByTestId("research-row").first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("research-picked-precedence")).toHaveText(
    "A saved posting is for the same company and role as this research. The posting is used.",
  );
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const [round] = await withDb((db) => db.select().from(s.rounds).where(eq(s.rounds.id, page.url().split("/").at(-1)!)));
  expect(round.roleContextId).toBe((await posting.json()).id);
});
