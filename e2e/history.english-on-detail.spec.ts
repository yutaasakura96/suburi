import { asc, eq, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { SYNTHETIC_ENGLISH_VERSION, seedRubrics, seedSetPieces, seedSyntheticEnglish, seedSyntheticQuestions } from "../db/seed-questions";
import { seedSyntheticRounds, syntheticId } from "../db/seed-rounds";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";

// 11 §4, `English on History detail` (#106, #138): the round detail of a Japanese round. Its pill,
// which renames the dimensions, also shows each question's and follow-up's stored English under it —
// or says there is none — while the Japanese, what was said and the transcripts stay; it starts from
// the English help setting. An English round has no pill. A read: no model call and nothing written.
//
// Over the synthetic rounds and their hand-written English (12 §1), with a fake follow-up English
// added here. Named to sort before history.spec.ts (one worker, file order), which seeds the
// synthetic rounds itself: this spec leaves no round, no English and no setting behind.

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

const NONE = "No English for this question yet.";
const QUESTION = "この1年で解決した、最も難しかった問題について教えてください。";
const QUESTION_EN = "Tell me about the most difficult problem you solved in the last year.";
const FOLLOW_UP = "その判断は誰が下したのですか。";
const FOLLOW_UP_EN = "Who made that call?";
const SAID = "4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。";

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
    // Q1's follow-up has its English and Q3's has none.
    await db
      .update(s.followUps)
      .set({ promptTextTranslated: FOLLOW_UP_EN })
      .where(eq(s.followUps.parentAnswerId, id("complete-ja:q1")));
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

/** Every row the detail reads, and the setting: a read leaves each as it was. */
async function snapshot() {
  return withDb(async (db) => ({
    answers: await db.select().from(s.answers).orderBy(asc(s.answers.id)),
    followUps: await db.select().from(s.followUps).orderBy(asc(s.followUps.id)),
    feedback: await db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)),
    translations: await db.select().from(s.questionTranslations).orderBy(asc(s.questionTranslations.id)),
    attempts: await db.$count(s.scoringAttempts),
    settings: await db.select().from(s.userSettings),
  }));
}

const detail = (name: string) => `/history/${id(name)}`;

test("with the setting off, the detail opens in Japanese and its pill shows the questions' English under them", async ({ page }) => {
  const before = await snapshot();
  await signIn(page);
  await page.goto(detail("complete-ja"));

  const pill = page.getByTestId("history-language");
  const rows = page.getByTestId("history-row");
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("history-dimension").first()).toHaveText("構成");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);

  await pill.click();
  await expect(pill).toHaveText("日本語");
  await expect(page.getByTestId("history-dimension").first()).toHaveText("Structure");

  // The question's English sits under it, and the follow-up's; the Japanese stays where it was.
  await expect(rows.nth(0)).toContainText(QUESTION);
  await expect(rows.nth(0).getByTestId("prompt-english")).toHaveText(QUESTION_EN);
  await expect(rows.nth(0).getByTestId("prompt-english")).toHaveAttribute("lang", "en");
  await expect(rows.nth(1)).toContainText(FOLLOW_UP);
  await expect(rows.nth(1).getByTestId("prompt-english")).toHaveText(FOLLOW_UP_EN);
  // Q3's follow-up has no English stored: the line says so, and nothing is generated for it.
  await expect(rows.nth(5).getByTestId("prompt-english-none")).toHaveText(NONE);
  await page.screenshot({ path: test.info().outputPath("history-english.png"), fullPage: true });

  // Opened, the row shows the question in full with its English, and the transcripts unchanged.
  await rows.nth(0).getByTestId("history-play").click();
  const record = page.getByTestId("history-record");
  await expect(record.getByTestId("prompt-english")).toHaveText(QUESTION_EN);
  await expect(record.getByTestId("history-corrected")).toHaveText(SAID);
  await expect(record.getByTestId("history-corrected")).toHaveAttribute("lang", "ja");

  // Pressed again, the detail is Japanese, with no English under anything.
  await pill.click();
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);

  expect(openAi.requests).toHaveLength(0);
  expect(await snapshot()).toEqual(before);
});

test("with the setting on, the pill starts on, and a reload starts from the setting again", async ({ page }) => {
  await setEnglishHelp(true);
  const before = await snapshot();
  await signIn(page);
  await page.goto(detail("complete-ja"));

  const pill = page.getByTestId("history-language");
  await expect(pill).toHaveText("日本語");
  await expect(page.getByTestId("history-dimension").first()).toHaveText("Structure");
  await expect(page.getByTestId("prompt-english").first()).toHaveText(QUESTION_EN);

  // The choice is the page's, not stored: pressed, reloaded, it starts from the setting again.
  await pill.click();
  await expect(pill).toHaveText("English");
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("history-language")).toHaveText("日本語");
  await expect(page.getByTestId("prompt-english").first()).toHaveText(QUESTION_EN);

  expect(openAi.requests).toHaveLength(0);
  expect(await snapshot()).toEqual(before);
  await setEnglishHelp(false);
});

test("an English round has no pill and no English line, whatever the setting", async ({ page }) => {
  await setEnglishHelp(true);
  await signIn(page);
  await page.goto(detail("failed-en"));
  await expect(page.getByTestId("history-dimension")).toHaveCount(6);
  await expect(page.getByTestId("history-language")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english")).toHaveCount(0);
  await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);
  await setEnglishHelp(false);
});

test("stored prompt English alone enables the pill, but an unfinished realistic round hides it", async ({ page }) => {
  const roundId = id("complete-ja");
  const [feedback] = await withDb((db) => db.select({ bodyTranslated: s.roundFeedback.bodyTranslated }).from(s.roundFeedback).where(eq(s.roundFeedback.roundId, roundId)));
  const [round] = await withDb((db) => db.select({ completedAt: s.rounds.completedAt }).from(s.rounds).where(eq(s.rounds.id, roundId)));
  try {
    await withDb((db) => db.update(s.roundFeedback).set({ bodyTranslated: null }).where(eq(s.roundFeedback.roundId, roundId)));
    await signIn(page);
    await page.goto(detail("complete-ja"));
    const pill = page.getByTestId("history-language");
    await expect(pill).toHaveText("English");
    await pill.click();
    await expect(page.getByTestId("prompt-english").first()).toHaveText(QUESTION_EN);

    await withDb((db) => db.update(s.rounds).set({ completedAt: null }).where(eq(s.rounds.id, roundId)));
    await page.reload();
    await expect(page.getByTestId("history-language")).toHaveCount(0);
    await expect(page.getByTestId("prompt-english")).toHaveCount(0);
    await expect(page.getByTestId("prompt-english-none")).toHaveCount(0);
  } finally {
    await withDb((db) => db.update(s.rounds).set({ completedAt: round.completedAt }).where(eq(s.rounds.id, roundId)));
    await withDb((db) => db.update(s.roundFeedback).set({ bodyTranslated: feedback.bodyTranslated }).where(eq(s.roundFeedback.roundId, roundId)));
  }
});
