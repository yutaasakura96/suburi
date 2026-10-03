import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// The round loop (#42, and its follow-ups, #44), end to end against the production build: a realistic
// English round from Setup to feedback. The microphone is Chromium's fake device; S3 and OpenAI are
// the local mocks, so nothing leaves the machine and no test calls OpenAI (11 §2).

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

// What the fake transcriber hears: an ASR slip ("pay mints") the correction screen exists to fix.
const RAW = "I led the pay mints migration, um, over six months and cut the failure rate by half.";
const CORRECTED = "I led the payments migration over six months and cut the failure rate by half.";

// What the fake generator asks after every answer.
const FOLLOW_UP = "What did you measure to know the failure rate had halved?";

const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];
const SCORES = { structure: 4, evidence: 3, relevance: 4, fluency: 3, accuracy: 4, length_pacing: 2 } as const;
const FINDINGS = {
  to_fix: [
    { title: "Lead with the result", body: "In answer 1, the outcome arrives last." },
    { title: "Name the number", body: "In answer 2, the scale of the change stays vague." },
  ],
  what_worked: "In answer 3, the example was concrete and your own.",
};

let s3: MockS3;
let openAi: MockOpenAi;
let feedbackFails = false;
// Scoring fails, past its retries, for an answer whose text carries UNSCORABLE — or for every answer.
const UNSCORABLE = "zebra-unscorable-sentinel";
let scoringFails = false;
let followUpFails = false;
let followUpMalformed = false;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

test.beforeAll(async () => {
  // Seeded here, not in global setup, so the CV screen's empty state stays real for cv.spec.ts; that
  // spec runs first (one worker, file order), and a CV it already saved is left as it is.
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    (body) => {
      if (formatOf(body) === "answer_scores") {
        if (scoringFails || JSON.stringify(body).includes(UNSCORABLE)) return { fail: 500 };
        return { scores: DIMENSIONS.map((dimension) => ({ dimension, value: SCORES[dimension as keyof typeof SCORES], justification: "e2e" })) };
      }
      if (formatOf(body) === "round_feedback") return feedbackFails ? { fail: 500 } : FINDINGS;
      if (formatOf(body) === "follow_up") return followUpFails ? { fail: 500 } : { follow_up: followUpMalformed ? "What changed? Who approved it?" : FOLLOW_UP };
      return { fail: 400 };
    },
    { transcription: () => ({ text: RAW, seconds: 18 }) },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  feedbackFails = false;
  scoringFails = false;
  followUpFails = false;
  followUpMalformed = false;
});

/** Starts a round through the API, as Setup does. */
async function startRound(page: Page) {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const round = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: (await context.json()).id },
  });
  expect(round.status()).toBe(201);
  return (await round.json()).round.id as string;
}

/** One answer through the API — slot, PUT, transcribe, submit — to the round's current prompt. */
async function answerByApi(page: Page, roundId: string, corrected = CORRECTED) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, {
    data: { content_type: "audio/webm", expected_bytes: 4 },
  });
  const slot = await opened.json();
  const put = await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) });
  expect(put.ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  const submitted = await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: corrected } });
  expect(submitted.ok()).toBe(true);
  return (await submitted.json()) as { next: { kind: string } };
}

/** A whole position through the API: the question, then its follow-up — for specs about what comes after. */
async function positionByApi(page: Page, roundId: string, corrected = CORRECTED) {
  const { next } = await answerByApi(page, roundId, corrected);
  expect(next.kind).toBe("follow_up");
  await answerByApi(page, roundId);
}

/** Screens 4 to 6 in the browser, for the prompt on screen: record, stop, correct, send. */
async function answerInBrowser(page: Page) {
  const asked = await page.getByTestId("round-question").boundingBox();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  // The question does not shrink or move when recording starts (10 §4).
  expect(await page.getByTestId("round-question").boundingBox()).toEqual(asked);
  await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
  await page.getByRole("button", { name: "Stop and transcribe" }).click();

  // Screen 5: the raw transcript with its slip intact, and figures that agree with each other.
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  await expect(page.getByTestId("take-figures")).toHaveText("0:18 · ~57 wpm · 17 words");
  await page.getByRole("button", { name: "Correct the transcript" }).click();

  // Screen 6: the raw text stays beside the editor, and the meter moves as the text does.
  await expect(page.getByTestId("rewrite-percent")).toHaveText("0%");
  await page.getByRole("textbox").fill(CORRECTED);
  await expect(page.getByTestId("rewrite-percent")).not.toHaveText("0%");
  await expect(page.getByTestId("raw-kept")).toHaveText(RAW);
  await page.getByRole("button", { name: "Send this answer" }).click();
}

const followUpCalls = () => openAi.requests.filter((request) => formatOf(request.body) === "follow_up");

test("practice asks one follow-up, then moves to the next question", async ({ page }) => {
  await signIn(page);
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode: "practice", length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  const roundId = (await created.json()).round.id as string;

  const first = await answerByApi(page, roundId);
  expect(first.next.kind).toBe("follow_up");
  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  await page.screenshot({ path: test.info().outputPath("screen4-practice-follow-up.png"), fullPage: true });

  const second = await answerByApi(page, roundId);
  expect(second.next.kind).toBe("question");
  await page.reload();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
  expect(followUpCalls()).toHaveLength(1);
});

test("a realistic English round: Setup → each question and its follow-up → pressure → feedback, all six rows", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const userId = await seededUserId();
  // The mock is shared across this file: count only the calls this round makes.
  const followUpsBefore = followUpCalls().length;

  await page.goto("/");
  await page.getByRole("link", { name: "Start a round" }).click();
  await expect(page).toHaveURL("/round/new");
  // v1 seeded here, or a later version cv.spec.ts saved: whichever is current.
  await expect(page.getByTestId("setup-cv")).toContainText(/^CV v\d+/);
  await expect(page.getByTestId("setup-estimate")).toContainText("3 questions + 3 follow-ups · up to about 24 min");
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;

  for (let position = 1; position <= 3; position += 1) {
    await expect(page.getByTestId("round-step")).toHaveText(`Question ${position} / 3`);
    // Realistic asks one unseen set piece first (07 §5.4).
    if (position === 1) await expect(page.getByTestId("round-question")).toHaveText("Could you start by introducing yourself?");
    await expect(page.getByText("The feedback comes together when the round ends. Nothing is shown along the way.")).toBeVisible();
    await answerInBrowser(page);

    // The one follow-up, generated from what was just sent, at the same position (07 §5.9).
    await expect(page.getByTestId("round-step")).toHaveText(`Question ${position} / 3 · follow-up`);
    await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
    if (position === 2) {
      // A reload asks the stored follow-up again; nothing generates it a second time (07 §5.5).
      const generated = followUpCalls().length;
      await page.reload();
      await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3 · follow-up");
      await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
      expect(followUpCalls()).toHaveLength(generated);
    }
    await answerInBrowser(page);
  }

  // Screen 7: not skippable — inert until a rating is picked, and no way round it.
  await expect(page.getByText("How tense did this round feel?")).toBeVisible();
  const toFeedback = page.getByRole("button", { name: "Go to the feedback" });
  await expect(toFeedback).toBeDisabled();
  await expect(page.getByText("Pick one to go on to the feedback.")).toBeVisible();
  await page.getByRole("radio", { name: /Very tense/ }).click();
  await expect(page.getByText("Records pressure 4 for this round.")).toBeVisible();
  await toFeedback.click();

  // Screen 8, rendered from stored rows at once.
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  const rows = page.getByTestId("score-row");
  await expect(rows).toHaveCount(6);
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2"]);
  await expect(page.getByTestId("to-fix")).toContainText("To fix 2");
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("what-worked")).toContainText("What worked 1");
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 4 recorded before the feedback");
  await expect(page.getByTestId("round-stamp")).toContainText("Rubric v1.0");
  await expect(page.getByTestId("answer-figures")).toContainText("0 min 18 s · ~57 wpm · rewrite");
  // The follow-up is a row under its answer's scores, with no scale of its own (10 §8).
  await expect(page.getByTestId("follow-up-row")).toHaveText(`└ Follow-up${FOLLOW_UP}Scored on 6 dimensions. Not counted in progress.`);
  await expect(page.getByTestId("round-stamp")).toContainText("follow-up-en-1.0");
  await page.screenshot({ path: test.info().outputPath("screen8-follow-up.png"), fullPage: true });
  // No composite, anywhere on the screen (AGENTS.md invariant 1).
  await expect(page.locator("main")).not.toContainText(/total|average|overall/i);
  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "2");

  // Six takes under dev/{user}/{round}/ — three questions, three follow-ups — each as the browser recorded it.
  const keys = [...s3.objects.keys()].filter((key) => key.startsWith(`dev/${userId}/${roundId}/`));
  expect(keys).toHaveLength(6);
  for (const key of keys) {
    expect(s3.objects.get(key)!.bytes).toBeGreaterThan(0);
    expect(s3.objects.get(key)!.contentType).toMatch(/^audio\/webm/);
  }
  // The scorer read the corrected text, never the raw one (03 §4).
  const scoring = openAi.requests.filter((request) => formatOf(request.body) === "answer_scores");
  expect(scoring.length).toBeGreaterThanOrEqual(6);
  // So did the follow-up generator: one call per question's answer, none for a follow-up's own.
  const generated = followUpCalls().slice(followUpsBefore).filter((request) => JSON.stringify(request.body).includes("payments migration"));
  expect(generated).toHaveLength(3);
  for (const request of [...scoring, ...generated]) {
    expect(JSON.stringify(request.body)).toContain("payments migration");
    expect(JSON.stringify(request.body)).not.toContain("pay mints");
  }

  // A completed round's page is its feedback.
  await page.goto(`/round/${roundId}`);
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
});

test("two generated questions are recorded as a missing follow-up", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  followUpMalformed = true;
  await page.goto(`/round/${roundId}`);
  await answerInBrowser(page);
  await expect(page.getByTestId("follow-up-notice")).toContainText("could not be generated");
  await page.screenshot({ path: test.info().outputPath("screen6-malformed-follow-up.png"), fullPage: true });
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status, errorClass: s.followUps.errorClass })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "missing", errorClass: "malformed_output" }]);
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
});

test("screen 7 cannot be skipped: the feedback URL sends an unrated round back to it", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);

  await page.goto(`/round/${roundId}/feedback`);
  await expect(page).toHaveURL(`/round/${roundId}`);
  await expect(page.getByText("How tense did this round feel?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to the feedback" })).toBeDisabled();
  // Nothing on the screen leads out of the round.
  await expect(page.getByRole("link")).toHaveCount(0);
  // Nor does the API close it without a rating.
  const refused = await page.request.post(`/api/rounds/${roundId}/complete`, { data: {} });
  expect(refused.status()).toBe(422);
  expect((await refused.json()).error.code).toBe("pressure_required");
});

test("feedback not ready: the scores render, one sentence says so, and the retry writes the findings", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);

  feedbackFails = true;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();

  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-not-ready")).toContainText("The findings for this round are not ready.");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 3 recorded before the feedback");
  await expect(page.getByTestId("to-fix")).toHaveCount(0);

  feedbackFails = false;
  await page.getByRole("button", { name: "Write the findings" }).click();
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("findings-not-ready")).toHaveCount(0);
});

test("a follow-up that could not be generated: the answer is saved, the screen says so, and the round goes on", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);

  followUpFails = true;
  await page.goto(`/round/${roundId}`);
  await answerInBrowser(page);
  // Said, not skipped silently (02 US-7): the answer is locked, and one control goes on.
  await expect(page.getByTestId("follow-up-notice")).toHaveText("The follow-up question could not be generated. Your answer is saved.");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen6-follow-up-missing.png"), fullPage: true });
  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");

  // The hole is a row, with the class of the failure and no text.
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status, promptText: s.followUps.promptText, errorClass: s.followUps.errorClass })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "missing", promptText: null, errorClass: "upstream_500" }]);

  followUpFails = false;
  await positionByApi(page, roundId);
  await positionByApi(page, roundId);
  await page.reload();
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);

  // Screen 8 shows the gap on the answer it belongs to, and the follow-ups that were asked on theirs.
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "1");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("follow-up-missing")).toHaveText("The follow-up was not generated. It is recorded as a gap.");
  await page.screenshot({ path: test.info().outputPath("screen8-follow-up-missing.png"), fullPage: true });
  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("follow-up-missing")).toHaveCount(0);
  await expect(page.getByTestId("follow-up-row")).toContainText(FOLLOW_UP);
});

test("a reload between an answer's commit and its follow-up: the saved answer, and going on writes the follow-up", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await answerByApi(page, roundId);
  // A submit that died after committing the answer and before storing its follow-up leaves no row.
  // Nothing in the app removes one; this is the throwaway database standing in for that crash.
  await withDb(async (db) => {
    const [parent] = await db.select({ id: s.answers.id }).from(s.answers).where(eq(s.answers.roundId, roundId));
    await db.delete(s.followUps).where(eq(s.followUps.parentAnswerId, parent.id));
  });

  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3");
  await expect(page.getByTestId("follow-up-notice")).toHaveText(
    "Your answer is saved. Its follow-up question had not been written when this page loaded.",
  );
  // The answer is committed: no recorder and no editor, only the way on.
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen6-follow-up-not-stored.png"), fullPage: true });

  await page.getByRole("button", { name: "Go on" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  await page.screenshot({ path: test.info().outputPath("screen4-follow-up.png"), fullPage: true });
  const rows = await withDb((db) =>
    db
      .select({ status: s.followUps.status })
      .from(s.followUps)
      .innerJoin(s.answers, eq(s.answers.id, s.followUps.parentAnswerId))
      .where(eq(s.answers.roundId, roundId)),
  );
  expect(rows).toEqual([{ status: "generated" }]);
});

/** Waits until every answer of the round has a finished latest scoring attempt. */
async function scoringSettled(roundId: string) {
  await expect
    .poll(
      () =>
        withDb(async (db) => {
          const rows = await db
            .select({ status: s.scoringAttempts.status })
            .from(s.scoringAttempts)
            .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
            .where(eq(s.answers.roundId, roundId));
          return rows.length >= 6 && rows.every((row) => row.status !== "pending");
        }),
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);
}

test("an answer whose scoring failed never reaches the feedback generator", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  await positionByApi(page, roundId);
  await positionByApi(page, roundId, `I could not be scored ${UNSCORABLE}.`);
  await positionByApi(page, roundId);
  await scoringSettled(roundId);

  const before = openAi.requests.length;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");

  const feedbackCalls = openAi.requests.slice(before).filter((request) => formatOf(request.body) === "round_feedback");
  expect(feedbackCalls).toHaveLength(1);
  const sent = JSON.stringify(feedbackCalls[0].body);
  expect(sent).not.toContain(UNSCORABLE);
  expect(sent).toContain("=== answer 1 ===");
  expect(sent).not.toContain("=== answer 2 ===");
  expect(sent).toContain("=== answer 3 ===");
  // Its follow-up's answer was scored on its own, and is sent under the same number.
  expect(sent).toContain("=== answer 2, follow-up ===");
  await page.screenshot({ path: test.info().outputPath("screen8-one-failed.png"), fullPage: true });
});

test("no answer scored: screen 8 says so, offers no retry, and the API refuses as no_scores", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  scoringFails = true;
  for (let position = 1; position <= 3; position += 1) await positionByApi(page, roundId);
  await scoringSettled(roundId);

  const before = openAi.requests.length;
  await page.goto(`/round/${roundId}`);
  await page.getByRole("radio", { name: /Fairly tense/ }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("findings-unavailable")).toHaveText(
    "No answer in this round could be scored, so there are no findings for this round. The round is complete and its rating is recorded.",
  );
  await expect(page.getByRole("button", { name: "Write the findings" })).toHaveCount(0);
  await expect(page.getByTestId("findings-not-ready")).toHaveCount(0);
  await expect(page.getByTestId("pressure-stamp")).toHaveText("Pressure 3 recorded before the feedback");
  await page.screenshot({ path: test.info().outputPath("screen8-no-scores.png"), fullPage: true });

  const retried = await page.request.post(`/api/rounds/${roundId}/feedback`, { data: {} });
  expect(retried.status()).toBe(502);
  const error = (await retried.json()).error;
  expect(error).toMatchObject({ code: "feedback_generation_failed", detail: { error_class: "no_scores" } });
  expect(openAi.requests.slice(before).filter((request) => formatOf(request.body) === "round_feedback")).toHaveLength(0);
  await page.reload();
  await expect(page.getByTestId("findings-unavailable")).toBeVisible();
});
