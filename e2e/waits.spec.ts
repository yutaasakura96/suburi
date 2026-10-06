import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL, MOCK_S3_ENDPOINT } from "./database";
import { generatedQuestions, silentMp3, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// The round's two waits (#73, 10 §3–5 and §7), against the production build: the take on its way and
// the round closing. Each call is held open in the browser, so what the screen says while it waits
// can be read. The round closing waits on the mock's own calls — two scores, then the feedback — so
// the counts on screen are the ones the round's real read (07 §5.5) gave.

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

const RAW = "I led the payments migration over six months and cut the failure rate by half.";
const RAW_JA = "前職では決済基盤の移行を担当し、半年で完了いたしました。";
const WAIT_HINT = "Please wait. This screen moves on by itself.";
const WAIT_HINT_JA = "このままお待ちください。終わると自動で次へ進みます。";
const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];

/** The structured output a Responses call asks for, by its format's name. */
function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

let s3: MockS3;
let openAi: MockOpenAi;
let heard = RAW;
// A scoring call, and the feedback's, wait on these while a spec reads the closing wait.
let scoringHeld: Promise<void> | null = null;
let feedbackHeld: Promise<void> | null = null;

test.beforeAll(async () => {
  // As e2e/round.spec.ts seeds; every helper skips what is already there. This file sorts after that
  // one on purpose (one worker, file order): its tracer expects the first set piece still unseen.
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "ja"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    async (body) => {
      const japanese = String(body.input).includes("=== rubric ja ");
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      if (formatOf(body) === "follow_up") return { follow_up: japanese || String(body.instructions).includes("深掘り") ? "どのように測りましたか。" : "How did you measure it?" };
      if (formatOf(body) === "answer_scores") {
        await scoringHeld;
        return {
          scores: (japanese ? [...DIMENSIONS, "keigo"] : DIMENSIONS).map((dimension) => ({ dimension, value: 3, justification: "e2e" })),
          citations: [],
          unsupported: [],
          answered_language: japanese ? "ja" : "en",
        };
      }
      if (formatOf(body) === "round_feedback") {
        await feedbackHeld;
        const findings = {
          to_fix: [
            { title: "Lead with the result", body: "In answer 1, the outcome arrives last." },
            { title: "Name the number", body: "In answer 2, the scale of the change stays vague." },
          ],
          what_worked: "In answer 3, the example was concrete and your own.",
        };
        return { ...findings, untouched: [], ...(japanese ? { translated: findings } : {}) };
      }
      if (formatOf(body) === "model_answer") {
        const answer = { answer: RAW, unsupported: [] };
        return japanese ? { ...answer, translated: answer } : answer;
      }
      return { fail: 400 };
    },
    { transcription: () => ({ text: heard, seconds: 18 }), speech: silentMp3 },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  heard = RAW;
  scoringHeld = null;
  feedbackHeld = null;
});

async function startRound(page: Page, language: "ja" | "en" = "en", mode: "realistic" | "practice" = "realistic") {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language, mode, length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).round.id as string;
}

/** One answer through the API — slot, PUT, transcribe, submit — to the round's current prompt. */
async function answerByApi(page: Page, roundId: string) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, {
    data: { content_type: "audio/webm", expected_bytes: 4 },
  });
  const slot = await opened.json();
  expect((await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) })).ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  const submitted = await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: heard } });
  expect(submitted.ok()).toBe(true);
  return (await submitted.json()) as { next: { kind: string } };
}

/** How many of the round's submitted answers its read (07 §5.5) says are scored. */
async function scored(page: Page, roundId: string) {
  const read = (await (await page.request.get(`/api/rounds/${roundId}`)).json()) as { answers: { state: string; scoring?: { status: string } }[] };
  return read.answers.filter((answer) => answer.state === "submitted" && answer.scoring?.status === "ok").length;
}

/**
 * The rest of the round through the API, up to screen 7, `answered` of its six answers given already:
 * four are scored, and the scoring of the last two and the feedback's call are held open in the mock.
 */
async function answerToClosing(page: Page, roundId: string, answered = 0) {
  for (let given = answered; given < 4; given += 1) await answerByApi(page, roundId);
  await expect.poll(() => scored(page, roundId), { timeout: 15_000 }).toBe(4);
  let releaseScoring!: () => void;
  let releaseFeedback!: () => void;
  scoringHeld = new Promise<void>((resolve) => (releaseScoring = resolve));
  feedbackHeld = new Promise<void>((resolve) => (releaseFeedback = resolve));
  let next = "question";
  while (next !== "pressure") next = (await answerByApi(page, roundId)).next.kind;
  return { releaseScoring, releaseFeedback };
}

/** Holds every matching request in the browser until `release` is called; it then goes on unchanged. */
async function hold(page: Page, matches: (url: URL, method: string) => boolean) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const handler = async (route: Route) => {
    if (!matches(new URL(route.request().url()), route.request().method())) return route.fallback();
    await released;
    await route.continue();
  };
  await page.route("**/*", handler);
  return { release, remove: () => page.unroute("**/*", handler) };
}

const isUpload = (url: URL, method: string) => url.origin === MOCK_S3_ENDPOINT && method === "PUT";
const isTranscribe = (url: URL) => url.pathname.endsWith("/transcribe");

const segments = (page: Page, testId: string) =>
  page.getByTestId(testId).getByTestId("wait-track").locator("[data-segment]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-segment")));

/** The wait's clock, in whole seconds. */
async function elapsed(wait: Locator) {
  const [minutes, seconds] = (await wait.getByTestId("wait-elapsed").innerText()).split(":").map(Number);
  return minutes * 60 + seconds;
}

async function recordAndStop(page: Page, start: string, stop: string) {
  await page.getByRole("button", { name: start }).click();
  await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
  await page.getByRole("button", { name: stop }).click();
}

test("the take on its way: the screen names the upload, then the transcription, and counts the time", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await page.goto(`/round/${roundId}`);
  const asked = await page.getByTestId("round-question").boundingBox();
  const upload = await hold(page, isUpload);
  const transcription = await hold(page, isTranscribe);
  await recordAndStop(page, "Start recording", "Stop and transcribe");

  // Step one of two: the upload is running, the transcription has not started.
  const wait = page.getByTestId("take-wait");
  await expect(wait.getByRole("status")).toHaveText("Uploading your recording.");
  await expect(wait.getByText(WAIT_HINT)).toBeVisible();
  expect(await segments(page, "take-wait")).toEqual(["running", "waiting"]);
  // The record controls are gone while it waits, and the question has not moved (10 §3–5).
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  expect(await page.getByTestId("round-question").boundingBox()).toEqual(asked);
  await expect.poll(() => elapsed(wait), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  // Never a percentage (05 §5.10).
  await expect(wait).not.toContainText("%");
  await page.screenshot({ path: test.info().outputPath("take-wait-upload.png"), fullPage: true });
  const uploading = await elapsed(wait);

  // Step two: the first segment fills only now that the upload has returned, and the clock runs on.
  upload.release();
  await expect(wait.getByRole("status")).toHaveText("Transcribing your answer.");
  expect(await elapsed(wait)).toBeGreaterThanOrEqual(uploading);
  expect(await segments(page, "take-wait")).toEqual(["done", "running"]);
  await expect.poll(() => elapsed(wait), { timeout: 10_000 }).toBeGreaterThan(uploading);
  await page.screenshot({ path: test.info().outputPath("take-wait-transcribe.png"), fullPage: true });

  transcription.release();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  await expect(wait).toHaveCount(0);
});

test("a failed transcription ends the wait, and trying again starts it and its clock again", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await page.goto(`/round/${roundId}`);
  let failing = true;
  let fail!: () => void;
  const failed = new Promise<void>((resolve) => (fail = resolve));
  await page.route("**/transcribe", async (route) => {
    if (!failing) return route.fallback();
    await failed;
    await route.abort();
  });
  await recordAndStop(page, "Start recording", "Stop and transcribe");

  // The first wait runs long enough that a clock starting again reads below it.
  const wait = page.getByTestId("take-wait");
  await expect.poll(() => elapsed(wait), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  const before = await elapsed(wait);
  fail();
  await expect(page.getByText("The request did not reach the server, or its answer did not come back. Try again.")).toBeVisible();
  await expect(wait).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start recording" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("take-wait-failed.png"), fullPage: true });

  failing = false;
  const transcription = await hold(page, isTranscribe);
  await page.getByRole("button", { name: "Try again" }).click();
  // The retry is the transcription alone (07 §5.7): the upload's segment is already done.
  await expect(wait.getByRole("status")).toHaveText("Transcribing your answer.");
  expect(await segments(page, "take-wait")).toEqual(["done", "running"]);
  expect(await elapsed(wait)).toBeLessThan(before);
  transcription.release();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
});

test("the round closing: answers scored N of M, then the feedback being written, then screen 8", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  const closing = await answerToClosing(page, roundId);
  await page.goto(`/round/${roundId}`);

  await page.getByRole("radio", { name: "Fairly tense" }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();

  const wait = page.getByTestId("closing-wait");
  await expect(wait.getByRole("status")).toHaveText("Scoring your answers: 4 of 6 done.");
  await expect(wait.getByText(WAIT_HINT)).toBeVisible();
  // A segment per answer, filled for each score that landed, and one for the feedback, not started.
  expect(await segments(page, "closing-wait")).toEqual(["done", "done", "done", "done", "running", "running", "waiting"]);
  await expect(wait).not.toContainText("%");
  // The rating shown is the one being recorded: the options no longer change.
  await page.getByRole("radio", { name: "Very tense" }).click({ force: true });
  await expect(page.getByRole("radio", { name: "Fairly tense" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Very tense" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Go to the feedback" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("closing-wait-scoring.png"), fullPage: true });

  // The next read finds no score pending: every answer's segment is done and the feedback's runs.
  closing.releaseScoring();
  await expect(wait.getByRole("status")).toHaveText("Scoring is finished. Writing the feedback.", { timeout: 15_000 });
  expect(await segments(page, "closing-wait")).toEqual(["done", "done", "done", "done", "done", "done", "running"]);
  await expect(wait.getByTestId("wait-elapsed")).not.toHaveText("0:00");
  await page.screenshot({ path: test.info().outputPath("closing-wait-feedback.png"), fullPage: true });

  closing.releaseFeedback();
  await page.waitForURL(`**/round/${roundId}/feedback`);
  await expect(page.getByTestId("score-row").first()).toBeVisible();
});

test("a failed close leaves the rating changeable, and trying again sends the one picked then", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  let next = "question";
  while (next !== "pressure") next = (await answerByApi(page, roundId)).next.kind;
  await page.goto(`/round/${roundId}`);
  const sent: unknown[] = [];
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/complete", async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) return route.abort();
    await released;
    await route.fallback();
  });

  await page.getByRole("radio", { name: "Fairly tense" }).click();
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  await expect(page.getByText("The request did not reach the server, or its answer did not come back. Try again.")).toBeVisible();
  await expect(page.getByTestId("closing-wait")).toHaveCount(0);

  await page.getByRole("radio", { name: "Very tense" }).click();
  await expect(page.getByRole("radio", { name: "Very tense" })).toBeChecked();
  await page.getByRole("button", { name: "Try again" }).click();
  // The rating shown while the round closes is the one this call carries.
  await expect(page.getByTestId("closing-wait")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Very tense" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Fairly tense" })).not.toBeChecked();
  expect(sent).toEqual([{ felt_pressure: 3 }, { felt_pressure: 4 }]);

  release();
  await page.waitForURL(`**/round/${roundId}/feedback`);
  const [round] = await withDb((db) => db.select({ feltPressure: s.rounds.feltPressure }).from(s.rounds).where(eq(s.rounds.id, roundId)));
  expect(round.feltPressure).toBe(4);
});

test("a practice round closing says the same, counting a question given again once", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page, "en", "practice");
  // Four answers scored, one of them given again and scored too: five scored rows for four questions.
  for (let given = 0; given < 4; given += 1) await answerByApi(page, roundId);
  const read = async () =>
    (await (await page.request.get(`/api/rounds/${roundId}`)).json()) as { answers: { id: string; state: string; scoring?: { status: string } }[] };
  await expect.poll(async () => (await read()).answers.filter((answer) => answer.scoring?.status === "ok").length, { timeout: 15_000 }).toBe(4);
  const [first] = (await read()).answers;
  const again = await page.request.post(`/api/rounds/${roundId}/answers`, {
    data: { content_type: "audio/webm", expected_bytes: 4, retry_of_answer_id: first.id },
  });
  expect(again.status()).toBe(201);
  const slot = await again.json();
  expect((await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) })).ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/transcribe`, { data: {} })).ok()).toBe(true);
  expect((await page.request.post(`/api/answers/${slot.answer_id}/submit`, { data: { transcript_corrected: heard } })).ok()).toBe(true);
  await expect.poll(async () => (await read()).answers.filter((answer) => answer.scoring?.status === "ok").length, { timeout: 15_000 }).toBe(5);

  let releaseScoring!: () => void;
  let releaseFeedback!: () => void;
  scoringHeld = new Promise<void>((resolve) => (releaseScoring = resolve));
  feedbackHeld = new Promise<void>((resolve) => (releaseFeedback = resolve));
  let next = "question";
  while (next !== "feedback") next = (await answerByApi(page, roundId)).next.kind;

  await page.goto(`/round/${roundId}`);
  await page.getByRole("button", { name: "Go to the feedback" }).click();
  const wait = page.getByTestId("closing-wait");
  // Seven submitted rows, six questions: the retry does not make a seventh, and its score is not a fifth.
  await expect(wait.getByRole("status")).toHaveText("Scoring your answers: 4 of 6 done.");
  await expect(wait.getByText(WAIT_HINT)).toBeVisible();
  expect(await segments(page, "closing-wait")).toEqual(["done", "done", "done", "done", "running", "running", "waiting"]);
  await expect(wait).not.toContainText("%");
  await expect(page.getByRole("button", { name: "Go to the feedback" })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("practice-closing-wait-scoring.png"), fullPage: true });

  releaseScoring();
  await expect(wait.getByRole("status")).toHaveText("Scoring is finished. Writing the feedback.", { timeout: 15_000 });
  expect(await segments(page, "closing-wait")).toEqual(["done", "done", "done", "done", "done", "done", "running"]);
  await expect(wait.getByTestId("wait-elapsed")).not.toHaveText("0:00");

  releaseFeedback();
  await page.waitForURL(`**/round/${roundId}/feedback`);
});

test("a Japanese round says both waits in Japanese", async ({ page }) => {
  heard = RAW_JA;
  await signIn(page);
  const roundId = await startRound(page, "ja");
  await page.goto(`/round/${roundId}`);
  const upload = await hold(page, isUpload);
  const transcription = await hold(page, isTranscribe);
  await recordAndStop(page, "録音を開始", "停止して文字起こし");

  const take = page.getByTestId("take-wait");
  await expect(take.getByRole("status")).toHaveText("録音をアップロードしています。");
  await expect(take.getByText(WAIT_HINT_JA)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ja-take-wait-upload.png"), fullPage: true });
  upload.release();
  await expect(take.getByRole("status")).toHaveText("回答を文字起こししています。");
  await page.screenshot({ path: test.info().outputPath("ja-take-wait-transcribe.png"), fullPage: true });
  transcription.release();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW_JA);

  // The rest through the API: the take above is this round's first answer, transcribed and unsent.
  await page.getByRole("button", { name: "文字起こしを直す" }).click();
  await page.getByRole("button", { name: "この回答を送る" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("第1問 / 3問・深掘り");
  const held = await answerToClosing(page, roundId, 1);
  await page.reload();

  await page.getByRole("radio", { name: "それなりに緊張した" }).click();
  await page.getByRole("button", { name: "講評に進む" }).click();
  const closing = page.getByTestId("closing-wait");
  await expect(closing.getByRole("status")).toHaveText("回答を採点しています。6件中4件が終わりました。");
  await expect(closing.getByText(WAIT_HINT_JA)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ja-closing-wait-scoring.png"), fullPage: true });
  held.releaseScoring();
  await expect(closing.getByRole("status")).toHaveText("採点が終わりました。講評をまとめています。", { timeout: 15_000 });
  await page.screenshot({ path: test.info().outputPath("ja-closing-wait-feedback.png"), fullPage: true });

  held.releaseFeedback();
  await page.waitForURL(`**/round/${roundId}/feedback`);
});
