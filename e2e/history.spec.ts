import { asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { seedSyntheticRounds, syntheticId } from "../db/seed-rounds";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL, MOCK_S3_ENDPOINT } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// History (#50), end to end against the production build, over the synthetic rounds `develop` is
// seeded with (12 §1): one complete and scored, one with a score still pending, one with a failed
// score, one abandoned. S3 and OpenAI are the local mocks, so nothing leaves the machine (11 §2).

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

/** 0.2 s of silence, 8 kHz mono 8-bit: the smallest thing an `<audio>` element will actually load. */
function wav() {
  const samples = 1_600;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8_000, 24);
  header.writeUInt32LE(8_000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

/** Stores `body` in the mock bucket and points the answer at it, as a finished upload would have. */
async function storeRecording(answerId: string, body: Buffer, contentType: string) {
  const key = `dev/e2e-history/${answerId}`;
  const put = await fetch(`${MOCK_S3_ENDPOINT}/${getConfig().S3_BUCKET}/${key}`, { method: "PUT", headers: { "content-type": contentType }, body: new Uint8Array(body) });
  expect(put.ok).toBe(true);
  await withDb((db) => db.update(s.answers).set({ audioS3Key: key }).where(eq(s.answers.id, answerId)));
  return key;
}

let s3: MockS3;
let openAi: MockOpenAi;
let userId: string;
let scoringFails = false;
const id = (name: string) => syntheticId(userId, name);

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}
const calls = (format: string) => openAi.requests.filter((request) => formatOf(request.body) === format).length;

const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];

test.beforeAll(async () => {
  userId = await seededUserId();
  await withDb(async (db) => {
    // cv.spec.ts runs first, and a CV it saved is left as it is: the rounds are stamped with whichever
    // version is current.
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
    expect(await db.transaction((tx) => seedSyntheticRounds(tx, userId))).toBe(4);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi((body) => {
    if (formatOf(body) !== "answer_scores") return { fail: 400 };
    if (scoringFails) return { fail: 500 };
    return {
      scores: DIMENSIONS.map((dimension) => ({ dimension, value: 5, justification: "e2e" })),
      citations: [],
      unsupported: [],
      answered_language: "en",
    };
  });
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
  // round.spec.ts and status.spec.ts run next against this database, and count on its rounds being
  // theirs and started this week. A throwaway database, emptied by hand: nothing in the app deletes.
  await withDb(async (db) => {
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
});

test.beforeEach(() => {
  scoringFails = false;
});

const rounds = (page: Page) => page.getByTestId("history-round");
const rows = (page: Page) => page.getByTestId("history-row");
/** A row's scores, one numeral per dimension, as the digits read across. */
const scoresOf = (page: Page, row: number) => rows(page).nth(row).getByTestId("history-score").allTextContents();

test("/history without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/history");
  await expect(page).toHaveURL("/sign-in");
});

test("Home links to History, which opens on the newest round", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(`/history/${id("complete-ja")}`);
  await expect(page).toHaveTitle("History — Suburi");
});

test("the rail lists every round newest first, with the unscored and abandoned lines, in English", async ({ page }) => {
  await signIn(page);
  await page.goto("/history");

  await expect(page.getByRole("heading", { name: "Rounds" })).toBeVisible();
  await expect(page.getByTestId("history-count")).toHaveText("4");
  await expect(rounds(page)).toHaveCount(4);
  await expect(rounds(page).nth(0)).toContainText("Behavioural");
  await expect(rounds(page).nth(0)).toContainText("2026-09-12");
  await expect(rounds(page).nth(0)).toContainText("Japanese · Realistic · 3 questions");
  // A complete round with every score in carries no line (10 §10).
  await expect(rounds(page).nth(0).getByTestId("history-status-line")).toHaveCount(0);
  await expect(rounds(page).nth(0).getByRole("link")).toHaveAttribute("aria-current", "page");

  await expect(rounds(page).nth(1)).toContainText("Technical");
  await expect(rounds(page).nth(1).getByTestId("history-status-line")).toHaveText("Unscored — retry scoring");
  await expect(rounds(page).nth(2)).toContainText("CEO / final");
  await expect(rounds(page).nth(2).getByTestId("history-status-line")).toHaveText("Unscored — retry scoring");
  await expect(rounds(page).nth(3)).toHaveAttribute("data-status", "abandoned");
  await expect(rounds(page).nth(3).getByTestId("history-status-line")).toHaveText("Abandoned — not counted in progress");

  // The chrome is English on a Japanese round too (10 §0): only the data keeps its language.
  await expect(page.locator("nav")).not.toContainText(/[ぁ-んァ-ン一-龯]/);

  await rounds(page).nth(3).getByRole("link").click();
  await expect(page).toHaveURL(`/history/${id("abandoned-en")}`);
  await expect(rounds(page).nth(3).getByRole("link")).toHaveAttribute("aria-current", "page");
});

test("the matrix shows each question, its follow-up under it, and the hole a missing follow-up left", async ({ page }) => {
  await signIn(page);
  await page.goto(`/history/${id("complete-ja")}`);

  await expect(page.getByRole("heading", { name: "Behavioural" })).toBeVisible();
  await expect(page.getByTestId("history-context")).toHaveText("General practice · Pressure 4 recorded before the feedback");
  await expect(page.getByText("Read-only")).toBeVisible();
  // Seven dimensions in a Japanese round, named in Japanese until the pill is used (PRD §4).
  await expect(page.getByTestId("history-dimension")).toHaveText(["構成", "根拠", "関連性", "流暢さ", "正確さ", "長さ・配分", "敬語"]);

  await expect(rows(page)).toHaveCount(6);
  expect(await rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kind")))).toEqual([
    "answer",
    "answer",
    "answer",
    "follow_up_missing",
    "answer",
    "answer",
  ]);
  await expect(rows(page).nth(0)).toContainText("Q1");
  await expect(rows(page).nth(0)).toContainText("この1年で解決した、最も難しかった問題について教えてください。");
  await expect(rows(page).nth(1)).toContainText("└ Follow-up");
  // 10 §10's sample row, which round feedback and Progress must agree with.
  expect(await scoresOf(page, 0)).toEqual(["4", "3", "4", "3", "4", "2", "3"]);
  expect(await scoresOf(page, 1)).toEqual(["3", "2", "4", "3", "4", "4", "3"]);
  await expect(page.getByTestId("history-follow-up-missing")).toHaveText("The follow-up was not generated. It is recorded as a gap.");
  await expect(rows(page).nth(3).getByTestId("history-score")).toHaveCount(0);
  await expect(rows(page).nth(3).getByTestId("history-play")).toHaveCount(0);

  await expect(page.getByTestId("history-stamp")).toContainText("Rubric v1.0");
  await expect(page.getByTestId("history-stamp")).toContainText("synthetic-fixture");
  await expect(page.getByText("Follow-ups are not counted in progress.")).toBeVisible();

  // The pill renames the dimensions and changes nothing else.
  await page.getByTestId("history-language").click();
  await expect(page.getByTestId("history-dimension").first()).toHaveText("Structure");
  await expect(page.getByTestId("history-dimension")).toHaveCount(7);
  expect(await scoresOf(page, 0)).toEqual(["4", "3", "4", "3", "4", "2", "3"]);
  await expect(page.getByTestId("history-language")).toHaveText("日本語");

  // An English round has six, and no pill.
  await page.goto(`/history/${id("failed-en")}`);
  await expect(page.getByTestId("history-dimension")).toHaveCount(6);
  await expect(page.getByTestId("history-language")).toHaveCount(0);
  // Nothing on the screen combines an answer's scores (refusal 1).
  await expect(page.locator("main")).not.toContainText(/total|average|overall/i);
});

test("every answered row opens its raw transcript beside the correction, and says when the recording is missing", async ({ page }) => {
  await signIn(page);
  await page.goto(`/history/${id("failed-en")}`);

  await expect(page.getByTestId("history-play")).toHaveCount(5);
  await page.getByRole("button", { name: "Open the recording and transcript for Q2" }).click();
  const record = page.getByTestId("history-record");
  await expect(record.getByTestId("history-raw")).toHaveText(
    "It treats refunds as a, as an afterthought. I built a refund service that processed 40,000 refunds a month, and most of the work was in the edge cases.",
  );
  await expect(record.getByTestId("history-corrected")).toContainText("It treats refunds as an afterthought.");
  await expect(record.getByText("Raw transcript — uncorrected")).toBeVisible();
  // The seed made no recording: a sentence, not a broken player (04 §5).
  await expect(record.getByTestId("history-audio-missing")).toHaveText("The recording could not be found.");
  await expect(record.getByTestId("history-audio")).toHaveCount(0);

  // One row open at a time; opening another closes this one.
  await page.getByRole("button", { name: "Open the recording and transcript for the follow-up to Q1" }).click();
  await expect(page.getByTestId("history-record")).toHaveCount(1);
  await expect(page.getByTestId("history-raw")).toHaveText("By asking where customers wait the longest today.");
  await page.getByRole("button", { name: "Close the recording and transcript for the follow-up to Q1" }).click();
  await expect(page.getByTestId("history-record")).toHaveCount(0);
});

test("a stored recording plays from a presigned URL minted when the row opens", async ({ page }) => {
  const key = await storeRecording(id("failed-en:q1"), wav(), "audio/wav");
  await signIn(page);
  await page.goto(`/history/${id("failed-en")}`);

  const minted = page.waitForResponse((response) => response.url().endsWith(`/api/answers/${id("failed-en:q1")}/audio`));
  await page.getByRole("button", { name: "Open the recording and transcript for Q1", exact: true }).click();
  const body = await (await minted).json();
  expect(Object.keys(body).sort()).toEqual(["duration_ms", "expires_at", "url"]);
  expect(body.url).toContain(`${MOCK_S3_ENDPOINT}/${getConfig().S3_BUCKET}/${key}`);
  expect(body.url).toContain("X-Amz-Signature=");

  const audio = page.getByTestId("history-audio");
  await expect(audio).toHaveAttribute("src", body.url);
  // The browser really loaded it: 0.2 s of audio, not an element pointed at nothing.
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeCloseTo(0.2, 1);
  await expect(page.getByTestId("history-audio-missing")).toHaveCount(0);
});

test("a recording the browser cannot play says so, and the transcripts stay", async ({ page }) => {
  await storeRecording(id("failed-en:q3"), Buffer.from("not audio at all"), "audio/webm");
  await signIn(page);
  await page.goto(`/history/${id("failed-en")}`);

  await page.getByRole("button", { name: "Open the recording and transcript for Q3" }).click();
  await expect(page.getByTestId("history-audio-missing")).toHaveText("The recording could not be played.");
  await expect(page.getByTestId("history-raw")).toContainText("Because I have done this migration once already");
});

test("a retry that fails says so and leaves the answer retryable", async ({ page }) => {
  // The run spends its three retries first, 14 s of backoff apart (07 §5.10).
  test.setTimeout(90_000);
  scoringFails = true;
  await signIn(page);
  await page.goto(`/history/${id("failed-en")}`);

  const row = rows(page).nth(2);
  await expect(row.getByTestId("history-unscored")).toContainText("Not scored");
  await row.getByTestId("history-retry").click();
  // Stated in words while it runs: no spinner (03 §8).
  await expect(row.getByRole("status")).toHaveText("Scoring this answer.");
  await expect(row.getByTestId("history-retry")).toBeDisabled();

  await expect(row.getByRole("alert")).toHaveText("Scoring failed. Your answer is saved, and it can be scored again later.", { timeout: 60_000 });
  await expect(row.getByTestId("history-retry")).toBeEnabled();
  await expect(row.getByTestId("history-score")).toHaveCount(0);
  await expect(rounds(page).nth(2).getByTestId("history-status-line")).toHaveText("Unscored — retry scoring");

  const attempts = await withDb((db) =>
    db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, id("failed-en:q2"))).orderBy(asc(s.scoringAttempts.createdAt)),
  );
  expect(attempts.map((attempt) => [attempt.status, attempt.isSuperseding])).toEqual([
    ["failed", false],
    ["failed", true],
  ]);
});

test("retrying a failed score scores that answer alone, and the round feedback is not regenerated", async ({ page }) => {
  const feedbackBefore = await withDb((db) => db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)));
  const scoringBefore = calls("answer_scores");
  await signIn(page);
  await page.goto(`/history/${id("failed-en")}`);

  const row = rows(page).nth(2);
  await expect(page.getByTestId("history-retry")).toHaveCount(1);
  await row.getByTestId("history-retry").click();

  await expect(row.getByTestId("history-score")).toHaveText(["5", "5", "5", "5", "5", "5"]);
  await expect(row.getByTestId("history-unscored")).toHaveCount(0);
  // An ok score is not re-rollable: the control is gone, for this answer and every other.
  await expect(page.getByTestId("history-retry")).toHaveCount(0);
  // The rail's line clears with it, and the stamp names the model that scored the retry.
  await expect(rounds(page).nth(2).getByTestId("history-status-line")).toHaveCount(0);
  await expect(page.getByTestId("history-stamp")).toContainText("gpt-5.6-sol");
  await expect(page.getByTestId("history-stamp")).toContainText("synthetic-fixture");
  // The other answers keep the scores they had.
  expect(await scoresOf(page, 0)).toEqual(["3", "3", "4", "4", "4", "3"]);

  // One scoring call, for one answer; and no feedback call, then or ever (06, 2026-09-28).
  expect(calls("answer_scores") - scoringBefore).toBe(1);
  expect(calls("round_feedback")).toBe(0);
  expect(await withDb((db) => db.select().from(s.roundFeedback).orderBy(asc(s.roundFeedback.id)))).toEqual(feedbackBefore);

  const attempts = await withDb((db) =>
    db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, id("failed-en:q2"))).orderBy(asc(s.scoringAttempts.createdAt)),
  );
  // Rows beside the first, never over it (04 `scoring_attempts`).
  expect(attempts.map((attempt) => attempt.status)).toEqual(["failed", "failed", "ok"]);

  // The API refuses a re-roll of the ok score all the same.
  const again = await page.request.post("/api/scoring-attempts", { data: { answer_id: id("failed-en:q2") } });
  expect(again.status()).toBe(422);
  expect((await again.json()).error.code).toBe("scoring_not_retryable");

  // Screen 8 still reads the feedback it was given.
  await page.getByRole("link", { name: "Round feedback" }).click();
  await expect(page.getByTestId("to-fix")).toContainText("Answer the question asked");
});

test("a score that never finished is run as it is: no new attempt", async ({ page }) => {
  await signIn(page);
  await page.goto(`/history/${id("pending-en")}`);

  const row = rows(page).nth(4);
  await expect(row).toContainText("Q3");
  await expect(row.getByTestId("history-unscored")).toContainText("Not scored yet");
  await row.getByTestId("history-retry").click();
  await expect(row.getByTestId("history-score")).toHaveText(["5", "5", "5", "5", "5", "5"]);
  await expect(rounds(page).nth(1).getByTestId("history-status-line")).toHaveCount(0);

  const attempts = await withDb((db) => db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.answerId, id("pending-en:q3"))));
  expect(attempts.map((attempt) => [attempt.id, attempt.status])).toEqual([[id("pending-en:q3:attempt"), "ok"]]);
  expect(calls("round_feedback")).toBe(0);
});

test("an abandoned round says so and shows what it reached: no resume, and no question it never asked", async ({ page }) => {
  await signIn(page);
  await page.goto(`/history/${id("abandoned-en")}`);

  await expect(page.getByTestId("history-abandoned")).toHaveText("Abandoned — not counted in progress");
  await expect(page.getByRole("link", { name: "Resume this round" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Round feedback" })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(4);
  expect(await scoresOf(page, 0)).toEqual(["4", "3", "4", "4", "4", "2"]);
  await expect(rows(page).nth(1)).toContainText("What was the hardest part of those six weeks?");
  await expect(rows(page).nth(1)).toContainText("Not answered");
  // Q2 and Q3 were fixed for the round and never asked: their text stays unseen (04 `round_questions`).
  await expect(rows(page).nth(2)).toHaveText(/^Q2\s*Not answered\s*—$/);
  await expect(page.locator("main")).not.toContainText("Describe a time you had to deliver");
});

test("no delete or share control anywhere on History, and nothing to edit", async ({ page }) => {
  await signIn(page);
  const forbidden = /delete|remove|discard|erase|share|export|publish|send|invite|copy link|download|削除|消去|共有|書き出/i;

  for (const name of ["complete-ja", "pending-en", "failed-en", "abandoned-en"]) {
    await page.goto(`/history/${id(name)}`);
    await expect(rows(page).first()).toBeVisible();
    await page.getByTestId("history-play").first().click();
    await expect(page.getByTestId("history-record")).toBeVisible();

    // Every control on the screen, by its accessible name: the pill, the play toggles, and nothing else.
    for (const role of ["button", "link", "menuitem", "checkbox", "switch"] as const) {
      for (const control of await page.getByRole(role).all()) {
        expect((await control.getAttribute("aria-label")) ?? (await control.textContent())).not.toMatch(forbidden);
      }
    }
    for (const button of await page.locator("main button").all()) {
      expect((await button.getAttribute("aria-label")) ?? (await button.textContent())).toMatch(
        /^(Open|Close) the recording and transcript for |^(English|日本語)$|^Retry scoring for |^Older rounds$/,
      );
    }
    await expect(page.locator("main")).not.toContainText(forbidden);
    // A past round is read-only: nothing on it takes input.
    await expect(page.locator("main").locator("input, textarea, select, form, [contenteditable]")).toHaveCount(0);
  }

  // And no route behind one (07 §6): a round, an answer and a score have no delete.
  for (const path of [
    `/api/rounds/${id("abandoned-en")}`,
    `/api/answers/${id("abandoned-en:q1")}`,
    `/api/scoring-attempts/${id("abandoned-en:q1:attempt")}`,
  ]) {
    expect([404, 405]).toContain((await page.request.delete(path)).status());
  }
  expect(await withDb((db) => db.$count(s.rounds, inArray(s.rounds.id, [id("abandoned-en")])))).toBe(1);
});

test("the newest open round started today is offered for resuming, with its scores held back", async ({ page }) => {
  await signIn(page);
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  const started = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: (await context.json()).id },
  });
  expect(started.status()).toBe(201);
  const roundId = (await started.json()).round.id as string;

  await page.goto("/history");
  await expect(page).toHaveURL(`/history/${roundId}`);
  await expect(page.getByTestId("history-count")).toHaveText("5");
  await expect(rounds(page).nth(0)).toHaveAttribute("data-status", "in_progress");
  const resume = rounds(page).nth(0).getByTestId("history-status-line");
  await expect(resume).toHaveText("In progress — resume");
  await expect(resume).toHaveAttribute("href", `/round/${roundId}`);
  await expect(page.getByRole("link", { name: "Resume this round" })).toHaveAttribute("href", `/round/${roundId}`);

  // Nothing answered yet, so nothing of the round is shown but its positions.
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveText(/^Q1\s*Not answered\s*—$/);
  await expect(page.getByTestId("history-play")).toHaveCount(0);
});
