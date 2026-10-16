import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { SYNTHETIC_ENGLISH_VERSION, seedRubrics, seedSetPieces, seedSyntheticEnglish, seedSyntheticQuestions } from "../db/seed-questions";
import { SYNTHETIC_MODEL_ID, seedSyntheticRounds, syntheticId } from "../db/seed-rounds";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";

// 11 §4, `English after the round` (#106, #127): screen 8 of a Japanese round, in each mode. Its pill
// shows the question's and the follow-up's stored English under them — or says there is none — and
// turns the screen's chrome English, while what was said, the CV region's quotes and the
// justification tooltips stay Japanese; it starts from the English help setting. An English round has
// no pill. A read: no model call and nothing written. Study's card pill is history.study.spec.ts's.
//
// Over the synthetic rounds and their hand-written English (12 §1), with fake rows added here. Named
// to sort before history.spec.ts (one worker, file order), which seeds the synthetic rounds itself:
// this spec leaves no round, no English and no setting behind.

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

const JAPANESE = /[぀-ヿ一-鿿]/u;
const NONE = "No English for this question yet.";
const QUESTION = "この1年で解決した、最も難しかった問題について教えてください。";
const QUESTION_EN = "Tell me about the most difficult problem you solved in the last year.";
const FOLLOW_UP = "その判断は誰が下したのですか。";
const FOLLOW_UP_EN = "Who made that call?";
const SAID = "4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。";
const QUOTE = "夜間処理を6時間から2時間に短縮しました。";
const JUSTIFICATION = "結論から先に述べている。";

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

async function setEnglishHelp(on: boolean) {
  await withDb((db) =>
    db
      .insert(s.userSettings)
      .values({ userId, englishHelp: on })
      .onConflictDoUpdate({ target: s.userSettings.userId, set: { englishHelp: on } }),
  );
}

test.beforeAll(async () => {
  userId = await seededUserId();
  await emptyRounds();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
    await seedSyntheticEnglish(db, userId);
    expect(await db.transaction((tx) => seedSyntheticRounds(tx, userId))).toBe(4);

    // Fake rows on the Japanese round: Q1's follow-up has its English and Q3's has none; Q1 has a
    // Japanese justification, a model answer with its English, and one unsupported span to quote.
    await db
      .update(s.followUps)
      .set({ promptTextTranslated: FOLLOW_UP_EN })
      .where(eq(s.followUps.parentAnswerId, id("complete-ja:q1")));
    const [attempt] = await db
      .select({ id: s.scoringAttempts.id })
      .from(s.scoringAttempts)
      .where(and(eq(s.scoringAttempts.answerId, id("complete-ja:q1")), eq(s.scoringAttempts.status, "ok")));
    await db
      .update(s.scores)
      .set({ justification: JUSTIFICATION })
      .where(and(eq(s.scores.scoringAttemptId, attempt.id), eq(s.scores.dimension, "structure")));
    const start = [...SAID].length - [...QUOTE].length;
    await db.insert(s.answerFlags).values({
      answerId: id("complete-ja:q1"),
      scoringAttemptId: attempt.id,
      userId,
      kind: "unsupported",
      spanStart: start,
      spanEnd: start + [...QUOTE].length,
    });
    await db.insert(s.modelAnswers).values({
      answerId: id("complete-ja:q1"),
      userId,
      modelId: SYNTHETIC_MODEL_ID,
      promptVersion: "synthetic-model-answer-1.0",
      body: "夜間処理を6時間から2時間に短縮しました。",
      bodyTranslated: { language: "en", body: "We cut the nightly run from six hours to two.", unsupported_spans: [] },
    });
  });
  await setEnglishHelp(false);
  openAi = await startMockOpenAi(() => ({ fail: 400 }));
});

test.afterAll(async () => {
  await openAi?.close();
  await emptyRounds();
  await withDb(async (db) => {
    await db.delete(s.questionTranslations).where(eq(s.questionTranslations.promptVersion, SYNTHETIC_ENGLISH_VERSION));
    await db.delete(s.userSettings).where(eq(s.userSettings.userId, userId));
  });
});

/** Every row screen 8 reads, and the setting: a read leaves each as it was. */
async function snapshot() {
  return withDb(async (db) => ({
    answers: await db.select().from(s.answers).orderBy(asc(s.answers.id)),
    followUps: await db.select().from(s.followUps).orderBy(asc(s.followUps.id)),
    modelAnswers: await db.select().from(s.modelAnswers).orderBy(asc(s.modelAnswers.id)),
    feedback: await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)),
    translations: await db.select().from(s.questionTranslations).orderBy(asc(s.questionTranslations.id)),
    attempts: await db.$count(s.scoringAttempts),
    settings: await db.select().from(s.userSettings),
  }));
}

const feedback = (name: string) => `/round/${id(name)}/feedback`;

test("with the setting off, screen 8 opens in Japanese and its pill shows the questions' English and turns the chrome English", async ({ page }) => {
  const before = await snapshot();
  await signIn(page);
  await page.goto(feedback("complete-ja"));

  const card = page.locator("section[lang]");
  const pill = page.getByTestId("feedback-language");
  await expect(page).toHaveTitle("講評 — Suburi");
  await expect(pill).toHaveText("English");
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(card).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("行動面接");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);

  await pill.click();
  await expect(pill).toHaveText("日本語");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveTitle("Round feedback — Suburi");
  await expect(card).toHaveAttribute("lang", "en");

  // The chrome is an English round's, naming the round as Japanese and its pace in characters (10 §0).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Behavioural");
  await expect(card.locator("header")).toContainText("Japanese · Realistic · 3 questions");
  const region = page.getByTestId("answer-region");
  await expect(region).toContainText("Question 1 / 3");
  await expect(page.getByTestId("answer-figures")).toContainText("chars/min");
  await expect(page.getByTestId("answer-figures")).not.toContainText(JAPANESE);
  await expect(region.getByRole("navigation")).toHaveText(/Question 2.*Question 3/);
  await expect(region.getByRole("heading", { name: "Your answer", exact: true })).toBeVisible();
  await expect(region.getByRole("heading", { name: "Your answer to the follow-up", exact: true })).toBeVisible();
  await expect(page.getByTestId("follow-up-row")).toContainText("└ Follow-up");
  await expect(page.getByTestId("grounding")).toContainText("Checked against your CV");
  await expect(page.getByTestId("to-fix").getByRole("heading")).toHaveText("To fix 2");
  await expect(page.getByTestId("round-stamp")).toContainText("Rubric ");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 4 recorded before the feedback");
  await expect(region.locator('[data-dimension="Structure"]')).toBeVisible();

  // The question's and follow-up's English sit under them; the Japanese stays where it was.
  await expect(region.getByText(QUESTION, { exact: true })).toHaveAttribute("lang", "ja");
  await expect(region.getByTestId("prompt-english")).toHaveText([QUESTION_EN, FOLLOW_UP_EN]);
  await expect(region.getByTestId("prompt-english").first()).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("follow-up-row").getByText(FOLLOW_UP, { exact: true })).toHaveAttribute("lang", "ja");

  // What stays: what was said, every quote in the CV region and the justification tooltip.
  await expect(region.getByTestId("own-answer").first()).toHaveText(SAID);
  await expect(region.getByTestId("own-answer").first()).toHaveAttribute("lang", "ja");
  const unsupported = page.getByTestId("unsupported");
  await expect(unsupported).toContainText(`Unsupported (Question 1) — nothing in`);
  await expect(unsupported.getByText(QUOTE, { exact: true })).toHaveAttribute("lang", "ja");
  await expect(unsupported.getByText(/^応募書類 v\d+$/)).toHaveAttribute("lang", "ja");
  await expect(region.getByTestId("model-answer").first()).toHaveText("We cut the nightly run from six hours to two.");
  await region.locator('[data-dimension="Structure"]').hover();
  const tooltip = page.getByTestId("score-justification");
  await expect(tooltip).toHaveText(JUSTIFICATION);
  await expect(tooltip).toHaveAttribute("lang", "ja");
  await page.screenshot({ path: test.info().outputPath("feedback-english.png"), fullPage: true });
  await page.mouse.move(0, 0);

  // A follow-up with no English stored says so; nothing is generated for it.
  await region.getByRole("navigation").getByRole("button", { name: "Question 3" }).click();
  await expect(region.getByTestId("prompt-english")).toHaveText(["Tell me about a time you persuaded someone who did not report to you."]);
  await expect(page.getByTestId("follow-up-row").getByTestId("prompt-english-none")).toHaveText(NONE);

  // Pressed again, the screen is Japanese, with no English under anything.
  await pill.click();
  await expect(pill).toHaveText("English");
  await expect(page).toHaveTitle("講評 — Suburi");
  await expect(region).toContainText("第3問 / 3問");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);

  expect(openAi.requests).toHaveLength(0);
  expect(await snapshot()).toEqual(before);
});

test("with the setting on, the pill starts on in either mode, and a reload starts from the setting again", async ({ page }) => {
  await setEnglishHelp(true);
  const before = await snapshot();
  await signIn(page);

  for (const mode of ["realistic", "practice"] as const) {
    if (mode === "practice") {
      // A practice round records no rating (04): the same round, as practice would have left it.
      await withDb((db) => db.update(s.rounds).set({ mode, feltPressure: null }).where(eq(s.rounds.id, id("complete-ja"))));
    }
    await page.goto(feedback("complete-ja"));
    const pill = page.getByTestId("feedback-language");
    await expect(pill).toHaveText("日本語");
    await expect(pill).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveTitle("Round feedback — Suburi");
    await expect(page.locator("section[lang]").locator("header")).toContainText(
      `Japanese · ${mode === "practice" ? "Practice" : "Realistic"} · 3 questions`,
    );
    await expect(page.getByTestId("answer-region").getByTestId("prompt-english").first()).toHaveText(QUESTION_EN);

    // The choice is the page's, not stored: pressed, reloaded, it starts from the setting again.
    await pill.click();
    await expect(pill).toHaveText("English");
    await page.reload();
    await expect(page.getByTestId("feedback-language")).toHaveText("日本語");
  }

  expect(openAi.requests).toHaveLength(0);
  expect(await snapshot()).toEqual(before);
  await withDb((db) =>
    db.update(s.rounds).set({ mode: "realistic", feltPressure: 4 }).where(eq(s.rounds.id, id("complete-ja"))),
  );
});

test("an English round has no pill and no English line, whatever the setting", async ({ page }) => {
  await signIn(page);
  await page.goto(feedback("failed-en"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("CEO / final");
  await expect(page.getByTestId("feedback-language")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);
  await setEnglishHelp(false);
});
