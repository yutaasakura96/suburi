import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL } from "./database";
import { generatedQuestions, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// Practice mode (#49), end to end against the production build: Setup's mode, the re-take, the
// per-answer frame pending and then scored, "answer again", and a round that ends with no rating
// (10 §15, 11 §4). The microphone is Chromium's fake device; S3 and OpenAI are the local mocks, so
// nothing leaves the machine and no test calls OpenAI (11 §2).

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
// The answer given again: its own words, so a call that read it can be told from one that did not.
const AGAIN = "Said again: I led the payments migration and cut the failure rate by half within six months.";
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
// One span the server can verify in the answer, and one it cannot: the invented one never reaches the screen.
const UNSUPPORTED = "cut the failure rate by half";
const INVENTED_QUOTE = "doubled the company's revenue";

let s3: MockS3;
let openAi: MockOpenAi;
// A scoring call waits on this while a spec looks at the frame it has not landed on yet.
let scoringHeld: Promise<void> | null = null;

function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

const callsOf = (format: string) => openAi.requests.filter((request) => formatOf(request.body) === format);

test.beforeAll(async () => {
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    async (body) => {
      if (formatOf(body) === "answer_scores") {
        await scoringHeld;
        return {
          scores: DIMENSIONS.map((dimension) => ({ dimension, value: SCORES[dimension as keyof typeof SCORES], justification: "e2e" })),
          citations: [{ claim: 1, relation: "supported_by" }],
          unsupported: [
            { quote: UNSUPPORTED, start_hint: 50 },
            { quote: INVENTED_QUOTE, start_hint: 0 },
          ],
          answered_language: "en",
        };
      }
      if (formatOf(body) === "round_feedback") return { ...FINDINGS, untouched: [1] };
      if (formatOf(body) === "follow_up") return { follow_up: FOLLOW_UP };
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
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
  scoringHeld = null;
});

async function startPractice(page: Page) {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const round = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode: "practice", length: 3, role_context_id: (await context.json()).id },
  });
  expect(round.status()).toBe(201);
  return (await round.json()).round.id as string;
}

/** One answer through the API — slot, PUT, transcribe, submit — to the round's current prompt. */
async function answerByApi(page: Page, roundId: string) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, { data: { content_type: "audio/webm", expected_bytes: 4 } });
  const slot = await opened.json();
  const put = await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) });
  expect(put.ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  const submitted = await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: CORRECTED } });
  expect(submitted.ok()).toBe(true);
  return (await submitted.json()) as { next: { kind: string } };
}

const answersOf = (roundId: string) =>
  withDb((db) => db.select().from(s.answers).where(eq(s.answers.roundId, roundId)).orderBy(asc(s.answers.createdAt)));

/** A practice take: record, stop, and the take is held until it is transcribed. */
async function recordTake(page: Page, start: "Start recording" | "Record again") {
  await page.getByRole("button", { name: start }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  // The runaway guard is never drawn (03 §7): no clock, no cap, nothing filling toward an end.
  await expect(page.getByTestId("record-timer")).toHaveCount(0);
  await expect(page.getByText(/Up to|Stops by itself/)).toHaveCount(0);
  // The waveform scrolls a bar a second; the second bar is a take with a second of sound in it.
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 5_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
}

const WRITES_FOLLOW_UP = "Sending writes one follow-up question from the text you just corrected.";
const SCORES_SHOWN = "Sending scores this answer. Its scores appear on the next screen once it is scored.";

/** From a held take to the per-answer frame: transcribe, correct, send — under the caption that says what sending does. */
async function sendHeldTake(page: Page, corrected: string, sendCaption: string) {
  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  await page.getByRole("button", { name: "Correct the transcript" }).click();
  await page.getByRole("textbox").fill(corrected);
  await expect(page.getByText(sendCaption)).toBeVisible();
  await page.getByRole("button", { name: "Send this answer" }).click();
  await expect(page.getByTestId("answered-frame")).toBeVisible();
}

test("a practice round: Setup's mode, a re-take, the per-answer frame pending then scored, answer again, and no rating", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  const userId = await seededUserId();

  // Two questions answered in an earlier practice round are seen for good (04): this round asks them first.
  const earlier = await startPractice(page);
  for (let answer = 1; answer <= 4; answer += 1) await answerByApi(page, earlier);
  const seen = [...new Set((await answersOf(earlier)).flatMap((answer) => answer.questionId ?? []))];
  expect(seen).toHaveLength(2);

  await page.goto("/round/new");
  // Setup opens on whatever is due (10 §2); this round is chosen, not inherited.
  for (const name of ["HR", "English", "3 questions"]) await page.getByRole("radio", { name, exact: true }).click();
  await expect(page.getByTestId("setup-estimate")).toContainText("3 questions + 3 follow-ups");
  await page.getByRole("radio", { name: "Practice", exact: true }).click();
  await expect(page.getByTestId("setup-modes")).toContainText(
    "Practice — re-takes, no time limit, each answer's scores once it is scored. Not counted in progress.",
  );
  // Practice has no pace to estimate: its cap is the runaway guard (10 §2).
  await expect(page.getByTestId("setup-estimate")).not.toContainText("questions");
  await page.screenshot({ path: test.info().outputPath("screen2-practice.png"), fullPage: true });
  await page.getByRole("radio", { name: "General practice" }).click();
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page).toHaveURL(/\/round\/[0-9a-f-]{36}$/);
  const roundId = page.url().split("/").at(-1)!;

  // Seen first (07 §5.4), and never a set piece.
  const asked = await withDb((db) =>
    db
      .select({ id: s.questions.id, origin: s.questions.origin })
      .from(s.roundQuestions)
      .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
      .where(eq(s.roundQuestions.roundId, roundId))
      .orderBy(asc(s.roundQuestions.position)),
  );
  expect(asked.slice(0, 2).map((question) => question.id).sort()).toEqual([...seen].sort());
  expect(asked.every((question) => question.origin !== "set_piece")).toBe(true);

  // The record frame, as practice draws it (10 §15).
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3");
  await expect(page.getByText("English · Practice · 3 questions")).toBeVisible();
  await expect(page.getByText("Each answer's scores appear once it is scored. The round's feedback comes at the end.")).toBeVisible();
  await expect(page.getByText("You can record again until the take is transcribed.")).toBeVisible();
  await expect(page.getByText("One take.")).toHaveCount(0);

  // A take, then a re-take: the same answer row and the same object key (07 §5.6).
  await recordTake(page, "Start recording");
  const [firstTake] = await answersOf(roundId);
  const key = `dev/${userId}/${roundId}/${firstTake.id}.webm`;
  expect(firstTake.audioS3Key).toBe(key);
  await page.screenshot({ path: test.info().outputPath("practice-take-held.png"), fullPage: true });
  await expect(page.getByText("Recording again replaces this take.")).toBeVisible();
  await recordTake(page, "Record again");
  const afterRetake = await answersOf(roundId);
  expect(afterRetake.map((answer) => answer.id)).toEqual([firstTake.id]);
  expect(afterRetake[0].audioS3Key).toBe(key);
  expect(afterRetake[0].transcriptRaw).toBeNull();
  expect([...s3.objects.keys()].filter((object) => object.startsWith(`dev/${userId}/${roundId}/`))).toEqual([key]);
  expect(callsOf("answer_scores").filter((request) => String(request.body.input).includes(AGAIN))).toHaveLength(0);

  // The per-answer frame says the score is pending, in words, and nothing on it waits (10 §15).
  let release!: () => void;
  scoringHeld = new Promise<void>((resolve) => (release = resolve));
  await sendHeldTake(page, CORRECTED, WRITES_FOLLOW_UP);
  const frame = page.getByTestId("answered-frame");
  await expect(frame).toHaveAttribute("data-scoring", "pending");
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3");
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("score-unscored")).toHaveText(Array(6).fill("Not scored yet"));
  await expect(page.getByTestId("scoring-pending")).toHaveText(
    "This answer is being scored. Its scores appear here once it is scored; you can go on without waiting.",
  );
  await expect(page.getByTestId("answer-flags")).toHaveCount(0);
  // The follow-up is ready beside it, and going on is not held behind the score.
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP);
  await expect(page.getByRole("button", { name: "Answer the follow-up" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Answer again" })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("practice-frame-pending.png"), fullPage: true });

  // Then the score lands: six rows, each its own dimension, and the answer's own words flagged.
  release();
  await expect(frame).toHaveAttribute("data-scoring", "ok", { timeout: 15_000 });
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2"]);
  await expect(page.getByTestId("scoring-pending")).toHaveCount(0);
  await expect(page.getByTestId("unsupported")).toHaveText([/^Unsupported — nothing in CV v\d+ backs “cut the failure rate by half”\.$/]);
  await expect(page.getByText(INVENTED_QUOTE)).toHaveCount(0);
  await expect(page.getByText(/overall|average|total/i)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("practice-frame-scored.png"), fullPage: true });

  // Answer again: the same question, a row beside the first, and no second follow-up (07 §5.6).
  const followUpsBefore = callsOf("follow_up").length;
  await page.getByRole("button", { name: "Answer again" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");
  await expect(page.getByRole("button", { name: "Back to the scores" })).toBeVisible();
  await recordTake(page, "Start recording");
  // An answer given again has no follow-up, and the caption says what sending does instead.
  await sendHeldTake(page, AGAIN, SCORES_SHOWN);
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");
  await expect(frame).toHaveAttribute("data-scoring", "ok", { timeout: 15_000 });
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP);
  const [original, again, ...others] = await answersOf(roundId);
  expect(others).toEqual([]);
  expect(original.id).toBe(firstTake.id);
  expect(original).toMatchObject({ position: 1, retryOfAnswerId: null, transcriptCorrected: CORRECTED, isFirstAttempt: false });
  expect(again).toMatchObject({
    position: 1,
    questionId: original.questionId,
    promptText: original.promptText,
    retryOfAnswerId: original.id,
    transcriptCorrected: AGAIN,
    isFirstAttempt: false,
  });
  expect(callsOf("follow_up")).toHaveLength(followUpsBefore);
  expect(await withDb((db) => db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, again.id)))).toEqual([]);
  expect(callsOf("answer_scores").filter((request) => String(request.body.input).includes(AGAIN))).toHaveLength(1);

  // A reload lands on the frame of the answer sent last, not on a question asked again.
  await page.reload();
  await expect(frame).toHaveAttribute("data-scoring", "ok");
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");

  // The follow-up, then the rest of the round through the API, up to its last follow-up.
  await page.getByRole("button", { name: "Answer the follow-up" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  for (let answer = 1; answer <= 4; answer += 1) await answerByApi(page, roundId);
  await page.reload();
  await expect(page.getByTestId("round-step")).toHaveText("Question 3 / 3");
  await expect(page.getByTestId("next-follow-up")).toContainText(FOLLOW_UP);
  await page.getByRole("button", { name: "Answer the follow-up" }).click();
  await recordTake(page, "Start recording");
  await sendHeldTake(page, CORRECTED, SCORES_SHOWN);

  // The round's last answer: `submit` said `feedback`, and the frame offers it — no rating is asked.
  await expect(page.getByTestId("round-step")).toHaveText("Question 3 / 3 · follow-up");
  await expect(page.getByText("Closes the round and writes its feedback. Practice asks for no pressure rating.")).toBeVisible();
  await expect(page.getByText("How tense did this round feel?")).toHaveCount(0);
  await expect(frame).toHaveAttribute("data-scoring", "ok", { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath("practice-frame-last.png"), fullPage: true });
  await page.getByRole("button", { name: "Go to the feedback" }).click();

  // Round feedback, without screen 7 (07 §5.12).
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByText("English · Practice · 3 questions")).toBeVisible();
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("what-worked")).toContainText("In answer 3, the example was concrete and your own.");
  await expect(page.getByTestId("pressure-stamp")).toHaveCount(0);
  const [round] = await withDb((db) => db.select().from(s.rounds).where(eq(s.rounds.id, roundId)));
  expect(round.completedAt).not.toBeNull();
  expect(round.feltPressure).toBeNull();
  // The feedback call read the first answers and the follow-ups: never the answer given again.
  const feedbackCall = callsOf("round_feedback").at(-1)!;
  expect(String(feedbackCall.body.input)).toContain("payments migration");
  expect(String(feedbackCall.body.input)).not.toContain("Said again");
  expect(String(feedbackCall.body.input).match(/^=== answer \d/gm)).toHaveLength(6);

  // The answer given again has a page of its own beside the first, with its own six rows.
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-again", "0");
  await page.getByRole("button", { name: "Question 1 · again", exact: true }).click();
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "1");
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-again", "1");
  await expect(page.getByTestId("score-value")).toHaveText(["4", "3", "4", "3", "4", "2"]);
  await expect(page.getByTestId("follow-up-row")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen8-practice-again.png"), fullPage: true });
  await page.getByRole("button", { name: "Question 1", exact: true }).click();
  await expect(page.getByTestId("follow-up-row")).toHaveCount(1);

  // A completed round's page is its feedback, and it never asks for the rating it did not take.
  await page.goto(`/round/${roundId}`);
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
});

test("a practice round sent to its end through the API opens on its last answer, and finishes without a rating", async ({ page }) => {
  await signIn(page);
  const roundId = await startPractice(page);
  let last = { next: { kind: "" } };
  for (let answer = 1; answer <= 6; answer += 1) last = await answerByApi(page, roundId);
  // What #44's review found: this `feedback` used to open screen 7, whose rating the API refuses.
  expect(last.next.kind).toBe("feedback");

  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("answered-frame")).toBeVisible();
  await expect(page.getByTestId("round-step")).toHaveText("Question 3 / 3 · follow-up");
  await expect(page.getByText("How tense did this round feel?")).toHaveCount(0);
  const rated = await page.request.post(`/api/rounds/${roundId}/complete`, { data: { felt_pressure: 3 } });
  expect(rated.status()).toBe(422);
  expect((await rated.json()).error.code).toBe("pressure_not_applicable");

  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page).toHaveURL(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("score-row")).toHaveCount(6);
  await expect(page.getByTestId("pressure-stamp")).toHaveCount(0);
});

test("a realistic round's read carries no score mid-round, and a practice round's carries them", async ({ page }) => {
  await signIn(page);
  const practice = await startPractice(page);
  await answerByApi(page, practice);
  await expect
    .poll(async () => (await (await page.request.get(`/api/rounds/${practice}`)).json()).answers[0].scoring.status, { timeout: 15_000 })
    .toBe("ok");
  const shown = await (await page.request.get(`/api/rounds/${practice}`)).json();
  expect(shown.answers[0].scoring.scores.map((score: { dimension: string }) => score.dimension)).toEqual(DIMENSIONS);
  expect(shown.answers[0].scoring.flags).toHaveLength(1);

  // Behavioural: no later spec counts on its bank, and it has no set piece to make seen (07 §5.4).
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "behavioural", language: "en", mode: "realistic", length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  const realistic = (await created.json()).round.id as string;
  await answerByApi(page, realistic);
  await expect
    .poll(async () => (await (await page.request.get(`/api/rounds/${realistic}`)).json()).answers[0].scoring.status, { timeout: 15_000 })
    .toBe("ok");
  const withheld = await page.request.get(`/api/rounds/${realistic}`);
  expect(withheld.headers()["cache-control"]).toBe("no-store");
  const text = await withheld.text();
  expect(JSON.parse(text).answers[0].scoring).toEqual({ attempt_id: expect.any(String), status: "ok" });
  for (const field of ['"scores"', '"flags"', '"answered_language"']) expect(text).not.toContain(field);
});
