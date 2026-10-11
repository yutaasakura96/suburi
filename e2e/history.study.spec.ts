import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { SYNTHETIC_MODEL_ID, seedSyntheticRounds, syntheticId } from "../db/seed-rounds";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";

// The study view (#75, 10 §16), end to end against the production build: first with no round, then
// over the synthetic rounds `develop` is seeded with (12 §1) and model answers invented here — the
// seed writes none. The screen reads stored rows and nothing else, so the mock model is there only
// to prove it is never called.
//
// The file is named to sort straight after history.spec.ts (one worker, file order): that spec leaves
// no round behind, and this one leaves none either.

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

let openAi: MockOpenAi;
let userId: string;
const id = (name: string) => syntheticId(userId, name);

// home-progress.spec.ts runs next and starts from no round. A throwaway database, emptied by hand:
// nothing in the app deletes.
async function emptyRounds() {
  await withDb(async (db) => {
    await db.delete(s.modelAnswers);
    await db.delete(s.scores);
    await db.delete(s.answerFlags);
    await db.delete(s.claimCitations);
    await db.delete(s.scoringAttempts);
    await db.delete(s.followUps);
    await db.delete(s.roundFeedback);
    await db.delete(s.answers).where(or(isNotNull(s.answers.retryOfAnswerId), isNotNull(s.answers.parentAnswerId)));
    await db.delete(s.answers);
    await db.delete(s.roundQuestions);
    await db.delete(s.rounds);
  });
}

test.beforeAll(async () => {
  userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  await emptyRounds();
  openAi = await startMockOpenAi(() => ({ fail: 400 }));
});

test.afterAll(async () => {
  await openAi?.close();
  await emptyRounds();
});

const JAPANESE = /[぀-ヿ一-鿿]/u;
/** A phrase that would name a figure combining dimensions (refusal #1). */
const COMPOSITE = /\b(overall|average|total|mean|composite)\b/i;

const round = (page: Page, name: string) => page.locator(`[data-testid="study-round"][data-round="${id(name)}"]`);
const questions = (page: Page, name: string) => round(page, name).getByTestId("study-question");

/** The round's CV stamp, as stored: cv.spec.ts runs first, and whichever version it left current is the one stamped. */
async function cvLabel(name: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({ label: s.cvVersions.versionLabel })
      .from(s.rounds)
      .innerJoin(s.cvVersions, eq(s.cvVersions.id, s.rounds.cvVersionId))
      .where(eq(s.rounds.id, id(name)));
    return row.label;
  });
}

/** A stored model answer nobody's model wrote: an invented body, stamped as a fixture. */
function modelAnswer(answer: string, values: Partial<typeof s.modelAnswers.$inferInsert> & { body: string }) {
  return { answerId: id(answer), userId, modelId: SYNTHETIC_MODEL_ID, promptVersion: "synthetic-model-answer-1.0", ...values };
}

test("/history/study without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/history/study");
  await expect(page).toHaveURL("/sign-in");
});

test("with no answered question, it says so and offers to start one", async ({ page }) => {
  await signIn(page);
  await page.goto("/history/study");

  await expect(page).toHaveTitle("Study — Suburi");
  await expect(page.getByRole("heading", { level: 1, name: "Study" })).toBeVisible();
  await expect(page.getByTestId("study-empty")).toContainText("No answered question yet.");
  await expect(page.getByTestId("study-round")).toHaveCount(0);
  await page.getByTestId("study-empty").getByRole("link", { name: "Start a round" }).click();
  await expect(page).toHaveURL("/round/new");
});

test("History's rail leads to it, the nav marks History, and Home is one link away", async ({ page }) => {
  await withDb(async (db) => {
    expect(await db.transaction((tx) => seedSyntheticRounds(tx, userId))).toBe(4);
    await db.insert(s.modelAnswers).values([
      modelAnswer("complete-ja:q1", {
        body: "夜間処理を6時間から2時間に短縮しました。売上も倍増しました。",
        unsupportedSpans: [{ start: 21, end: 31 }],
        bodyTranslated: { language: "en", body: "We cut the nightly run from six hours to two. Sales doubled too.", unsupported_spans: [{ start: 46, end: 64 }] },
      }),
      modelAnswer("complete-ja:q1:follow-up-answer", {
        body: "判断はチームで下しました。",
        bodyTranslated: { language: "en", body: "The team made the call.", unsupported_spans: [] },
      }),
      modelAnswer("pending-en:q1", { body: "I start with what changed: the deploy log, then p95 latency by endpoint." }),
    ]);
  });

  await signIn(page);
  await page.goto("/history");
  await page.getByRole("navigation", { name: "Rounds" }).getByRole("link", { name: "Study past questions" }).click();
  await expect(page).toHaveURL("/history/study");

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  // The rail is History's by-round view: this page reads across rounds and carries none.
  await expect(page.getByRole("navigation", { name: "Rounds" })).toHaveCount(0);

  await page.getByRole("link", { name: "Rounds in History" }).click();
  await expect(page).toHaveURL(`/history/${id("complete-ja")}`);
  await page.goBack();
  await nav.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
});

test("it lists every round with submitted answers newest first, including the abandoned one", async ({ page }) => {
  await signIn(page);
  await page.goto("/history/study");

  await expect(page.getByTestId("study-round")).toHaveCount(4);
  expect(await page.getByTestId("study-round").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-round")))).toEqual(
    ["complete-ja", "pending-en", "failed-en", "abandoned-en"].map(id),
  );
  const abandoned = round(page, "abandoned-en");
  await expect(abandoned.getByTestId("study-question")).toHaveCount(1);
  await expect(abandoned.getByTestId("own-answer")).toContainText("The hardest was the database migration.");
  await expect(abandoned.getByTestId("model-answer-not-written")).toBeVisible();
  await expect(abandoned.getByTestId("study-no-findings")).toBeVisible();
  await expect(abandoned.getByRole("link", { name: "Round feedback" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("What was the hardest part of those six weeks?");
  await expect(page.locator("main")).not.toContainText("Describe a time you had to deliver with less time than you needed.");
  await expect(page.getByTestId("study-footer")).toContainText("Answered questions from completed and unfinished rounds");

  const japanese = round(page, "complete-ja");
  await expect(japanese.getByRole("heading", { level: 2 })).toHaveText("Behavioural");
  await expect(japanese.locator("header")).toContainText("Japanese · Realistic · 3 questions");
  await expect(japanese.locator("header")).toContainText("2026-09-12");
  await expect(japanese.getByRole("link", { name: "Round feedback" })).toHaveAttribute("href", `/round/${id("complete-ja")}/feedback`);
  await expect(japanese.getByRole("link", { name: "Scores and recordings" })).toHaveAttribute("href", `/history/${id("complete-ja")}`);
});

test("each question shows what was said beside its stored model answer, the follow-up the same way, and the round's to-fix list", async ({ page }) => {
  await signIn(page);
  await page.goto("/history/study");

  const english = questions(page, "pending-en");
  await expect(english).toHaveCount(3);
  const first = english.nth(0);
  await expect(first).toContainText("Question 1 / 3");
  await expect(first.getByRole("heading", { level: 3 })).toHaveText("Walk me through how you would find the cause of a sudden slowdown in production.");
  await expect(first.getByTestId("own-answer").nth(0)).toHaveText(
    "I would start with what changed. I check the deploy log and the p95 latency dashboards, then narrow it down by endpoint.",
  );
  // The corrected answer, as it was scored: the raw transcript is History's (10 §10).
  await expect(first).not.toContainText("Um, I would start");
  await expect(first.getByTestId("model-answer").nth(0)).toHaveText("I start with what changed: the deploy log, then p95 latency by endpoint.");
  await expect(first.getByTestId("model-answer-unsupported")).toHaveCount(0);
  const cv = await cvLabel("pending-en");
  await expect(first.getByTestId("model-answer-legend").nth(0)).toHaveText(
    `Written from ${cv} and what you said. Nothing in it is underlined as going beyond ${cv}.`,
  );

  // The follow-up: asked, answered, and with no model answer stored — said, with nothing to press.
  const followUp = first.getByTestId("study-follow-up");
  await expect(followUp).toContainText("└ Follow-up");
  await expect(followUp).toContainText("Which signal would you look at first, and why?");
  await expect(followUp.getByRole("heading", { name: "Your answer to the follow-up" })).toBeVisible();
  await expect(followUp.getByTestId("own-answer")).toHaveText(
    "The p95 latency per endpoint, because it shows where the time goes before I guess at a cause.",
  );
  await expect(followUp.getByTestId("model-answer-not-written")).toHaveText(
    "No model answer is available for this question.",
  );

  await expect(round(page, "pending-en").getByTestId("study-to-fix").getByRole("heading")).toHaveText("To fix 2");
  await expect(round(page, "pending-en").getByTestId("study-to-fix").getByRole("listitem")).toHaveText([
    "1Lead with the result In answer 1, the method comes before what it found.",
    "2Name the number earlier In answer 2, the six weeks arrive in the last sentence.",
  ]);
  // An English round reads in English already: no pill (PRD §4).
  await expect(round(page, "pending-en").getByTestId("study-language")).toHaveCount(0);
});

test("a Japanese round keeps its data in Japanese under English chrome and marks what the CV does not back", async ({ page }) => {
  await signIn(page);
  await page.goto("/history/study");

  const japanese = round(page, "complete-ja");
  const first = questions(page, "complete-ja").nth(0);
  await expect(first.getByRole("heading", { level: 3 })).toHaveText("この1年で解決した、最も難しかった問題について教えてください。");
  await expect(first.getByRole("heading", { level: 3 })).toHaveAttribute("lang", "ja");
  await expect(first.getByTestId("own-answer").nth(0)).toHaveText("4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。");
  await expect(first.getByTestId("model-answer").nth(0)).toHaveText("夜間処理を6時間から2時間に短縮しました。売上も倍増しました。");
  await expect(first.getByTestId("model-answer").nth(0)).toHaveAttribute("lang", "ja");
  // The underline is the stored span, and the legend says what it is, naming the round's CV stamp as stored.
  await expect(first.getByTestId("model-answer-unsupported")).toHaveText("売上も倍増しました。");
  const cv = await cvLabel("complete-ja");
  expect(cv).toMatch(/^応募書類 v\d+$/);
  await expect(first.getByTestId("model-answer-legend").nth(0)).toHaveText(
    `Written from ${cv} and what you said. An underline marks what ${cv} does not back.`,
  );
  // The chrome is English on a Japanese round (10 §0): its labels are, and only the data is not.
  for (const label of ["Your answer", "Model answer", "Your answer to the follow-up", "Model answer to the follow-up"]) {
    await expect(first.getByRole("heading", { level: 4, name: label, exact: true })).toBeVisible();
  }
  await expect(japanese.locator("header")).not.toContainText(JAPANESE);

  await expect(questions(page, "complete-ja").nth(1).getByTestId("study-follow-up")).toHaveCount(0);

  await expect(japanese.getByTestId("study-to-fix").getByRole("heading")).toHaveText("To fix 2");
  await expect(japanese.getByTestId("study-to-fix").getByRole("listitem")).toHaveText([
    "1結論を最初の一文に置く 第1問で、結論が最後に出てくる。",
    "2数値を一つ挙げる 第2問で、成果が抽象的なままである。",
  ]);
});

test("the pill reads a Japanese round's model answers and to-fix list in their stored English, and what was said does not change", async ({ page }) => {
  await signIn(page);
  await page.goto("/history/study");

  const japanese = round(page, "complete-ja");
  const first = questions(page, "complete-ja").nth(0);
  const pill = japanese.getByTestId("study-language");
  await expect(pill).toHaveText("English");
  await pill.click();

  await expect(pill).toHaveText("日本語");
  await expect(first.getByTestId("model-answer").nth(0)).toHaveText("We cut the nightly run from six hours to two. Sales doubled too.");
  await expect(first.getByTestId("model-answer").nth(0)).toHaveAttribute("lang", "en");
  await expect(first.getByTestId("model-answer-unsupported")).toHaveText("Sales doubled too.");
  await expect(first.getByTestId("study-follow-up").getByTestId("model-answer")).toHaveText("The team made the call.");
  await expect(japanese.getByTestId("study-to-fix").getByRole("listitem")).toHaveText([
    "1Put the conclusion in the first sentence In answer 1, the conclusion arrives last.",
    "2Name one number In answer 2, the outcome stays general.",
  ]);
  // What was asked and what was said are the record, never translated.
  await expect(first.getByRole("heading", { level: 3 })).toHaveText("この1年で解決した、最も難しかった問題について教えてください。");
  await expect(first.getByTestId("own-answer").nth(0)).toHaveText("4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。");
  // The choice is that round's: the English round beside it is as it was.
  await expect(questions(page, "pending-en").nth(0).getByTestId("model-answer").nth(0)).toHaveText(
    "I start with what changed: the deploy log, then p95 latency by endpoint.",
  );

  await pill.click();
  await expect(first.getByTestId("model-answer").nth(0)).toHaveText("夜間処理を6時間から2時間に短縮しました。売上も倍増しました。");
});

test("it shows no score and no combined figure, has nothing to press but the pill, and neither writes nor calls a model", async ({ page }) => {
  const before = await withDb(async (db) => ({
    modelAnswers: await db.select().from(s.modelAnswers).orderBy(asc(s.modelAnswers.id)),
    feedback: await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)),
    attempts: await db.$count(s.scoringAttempts),
  }));
  const forbidden = /delete|remove|discard|erase|share|export|publish|send|invite|copy link|download|削除|消去|共有|書き出/i;

  await signIn(page);
  await page.goto("/history/study");
  await expect(page.getByTestId("study-round")).toHaveCount(4);

  const main = page.locator("main");
  await expect(main).not.toContainText(COMPOSITE);
  await expect(main).not.toContainText(forbidden);
  // No score row, no scale and no numeral: this screen reads no score at all (refusal #1).
  await expect(main.getByTestId("score-row")).toHaveCount(0);
  await expect(main).not.toContainText(/Structure|Evidence|Relevance|Fluency|Accuracy|Length and pacing|Keigo|構成|根拠/);

  for (const role of ["button", "link", "menuitem", "checkbox", "switch"] as const) {
    for (const control of await page.getByRole(role).all()) {
      expect((await control.getAttribute("aria-label")) ?? (await control.textContent())).not.toMatch(forbidden);
    }
  }
  // Read-only: the one button is the pill on the Japanese round, and nothing takes input.
  expect(await main.locator("button").allTextContents()).toEqual(["English"]);
  await expect(main.locator("input, textarea, select, form, [contenteditable]")).toHaveCount(0);

  expect(openAi.requests).toHaveLength(0);
  expect(
    await withDb(async (db) => ({
      modelAnswers: await db.select().from(s.modelAnswers).orderBy(asc(s.modelAnswers.id)),
      feedback: await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)),
      attempts: await db.$count(s.scoringAttempts),
    })),
  ).toEqual(before);
});

test("older rounds are a page away by cursor, a practice answer-again sits beside the first answer, and a round with no findings says so", async ({ page }) => {
  // Ten newer answered rounds fill the first page, so the seeded four are the second. The newest is
  // a practice round whose one question was answered twice, with no findings written.
  const practiceId = await withDb(async (db) => {
    const [like] = await db.select().from(s.rounds).where(eq(s.rounds.id, id("pending-en")));
    const [question] = await db
      .select()
      .from(s.questions)
      .where(and(eq(s.questions.userId, userId), eq(s.questions.language, "en"), eq(s.questions.roundType, "hr")))
      .orderBy(asc(s.questions.createdAt))
      .limit(1);
    const inserted = await db
      .insert(s.rounds)
      .values(
        Array.from({ length: 10 }, (_, index) => ({
          userId,
          roundType: "hr" as const,
          language: "en" as const,
          mode: "practice" as const,
          length: 3,
          perAnswerCapSeconds: 900,
          cvVersionId: like.cvVersionId,
          roleContextId: like.roleContextId,
          rubricVersionId: like.rubricVersionId,
          startedAt: new Date(Date.UTC(2026, 8, 20 + index, 1)),
          completedAt: new Date(Date.UTC(2026, 8, 20 + index, 2)),
        })),
      )
      .returning();
    const newest = inserted.at(-1)!;
    const answer = (roundId: string, corrected: string, minute: number, retryOf: string | null) => ({
      roundId,
      userId,
      questionId: question.id,
      promptText: question.body,
      position: 1,
      language: "en" as const,
      transcriptRaw: corrected,
      transcriptCorrected: corrected,
      retryOfAnswerId: retryOf,
      createdAt: new Date(newest.startedAt.getTime() + minute * 60_000),
    });
    await db.insert(s.answers).values(inserted.slice(0, -1).map((round) => answer(round.id, "An invented answer.", 1, null)));
    const [first] = await db.insert(s.answers).values(answer(newest.id, "An invented first answer.", 1, null)).returning();
    await db.insert(s.answers).values(answer(newest.id, "An invented second answer.", 5, first.id));
    await db.insert(s.modelAnswers).values({ answerId: first.id, userId, body: "An invented model answer.", modelId: SYNTHETIC_MODEL_ID, promptVersion: "synthetic-model-answer-1.0" });
    return newest.id;
  });

  await signIn(page);
  await page.goto("/history/study");
  await expect(page.getByTestId("study-round")).toHaveCount(10);
  await expect(round(page, "complete-ja")).toHaveCount(0);

  const practice = page.locator(`[data-testid="study-round"][data-round="${practiceId}"]`);
  await expect(page.getByTestId("study-round").first()).toHaveAttribute("data-round", practiceId);
  await expect(practice.getByTestId("study-question")).toHaveCount(1);
  // Refusal #3: the first answer is still there, and the retry is beside it under the one model answer.
  await expect(practice.getByTestId("own-answer")).toHaveText("An invented first answer.");
  await expect(practice.getByTestId("answered-again")).toHaveText("Answered againAn invented second answer.");
  await expect(practice.getByTestId("model-answer")).toHaveText("An invented model answer.");
  await expect(practice.getByTestId("study-no-findings")).toHaveText("No fixes are available for this round.");

  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByRole("link", { name: "Newest rounds" })).toHaveCount(0);
  await pages.getByRole("link", { name: "Older rounds" }).click();
  await expect(page).toHaveURL(/\/history\/study\?before=/);
  expect(await page.getByTestId("study-round").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-round")))).toEqual(
    ["complete-ja", "pending-en", "failed-en", "abandoned-en"].map(id),
  );
  await expect(pages.getByRole("link", { name: "Older rounds" })).toHaveCount(0);
  await pages.getByRole("link", { name: "Newest rounds" }).click();
  await expect(page).toHaveURL("/history/study");
  await expect(page.getByTestId("study-round")).toHaveCount(10);
});

test("a cursor this server did not mint is a 404 with the nav, never the first page in its place", async ({ page }) => {
  await signIn(page);
  expect((await page.goto("/history/study?before=not-a-cursor"))?.status()).toBe(404);
  await expect(page.getByTestId("study-round")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
});
