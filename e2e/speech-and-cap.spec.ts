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
import { generatedQuestions, silentMp3, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// What makes a realistic round realistic (#45), against the production build: the spoken question,
// the 4-minute cap and one take — and practice's 15-minute runaway guard, which is none of those. The
// microphone is Chromium's fake device and the page's clock is Playwright's, so a cap is reached by
// moving the clock, not by waiting for it (11 §4).

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
const SPOKEN = "Read aloud. The text stays on screen.";
const FOLLOW_UP = "What did you measure to know the failure rate had halved?";

/** The structured output a Responses call asks for, by its format's name. */
function formatOf(body: Record<string, unknown>) {
  return ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
}

let s3: MockS3;
let openAi: MockOpenAi;
let speechFails = false;

test.beforeAll(async () => {
  // As e2e/round.spec.ts seeds; every helper skips what is already there. This file sorts after that
  // one on purpose (one worker, file order): its tracer expects the first set piece still unseen.
  const userId = await seededUserId();
  await withDb(async (db) => {
    await db.transaction((tx) => seedSyntheticCv(tx, userId, "en"));
    await seedRubrics(db);
    await seedSetPieces(db, userId);
    await seedSyntheticQuestions(db, userId);
  });
  s3 = await startMockS3();
  openAi = await startMockOpenAi(
    // By the time this file runs the seeded questions are answered, so a round's are generated (07
    // §5.4), and each answer gets its follow-up. Scoring is not what is under test here: it fails.
    (body) => {
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      if (formatOf(body) === "follow_up") return { follow_up: FOLLOW_UP };
      return { fail: 500 };
    },
    {
      transcription: () => ({ text: RAW, seconds: 240 }),
      speech: () => (speechFails ? { fail: 503 } : silentMp3()),
    },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  speechFails = false;
});

async function startRound(page: Page, mode: "realistic" | "practice") {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const created = await page.request.post("/api/rounds", {
    data: { round_type: "hr", language: "en", mode, length: 3, role_context_id: (await context.json()).id },
  });
  expect(created.status()).toBe(201);
  return (await created.json()).round as { id: string; per_answer_cap_seconds: number };
}

/** Every request the page makes to the speech route, as path and query. */
function speechRequestsOf(page: Page) {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/speech")) requests.push(url.pathname + url.search);
  });
  return requests;
}

function takesOf(userId: string, roundId: string) {
  return [...s3.objects.entries()].filter(([key]) => key.startsWith(`dev/${userId}/${roundId}/`)).map(([, object]) => object);
}

test("the cap fires: a realistic take stops by itself at 4:00 and is kept, with no countdown", async ({ page }) => {
  await signIn(page);
  const round = await startRound(page, "realistic");
  expect(round.per_answer_cap_seconds).toBe(240);
  await page.clock.install();
  await page.goto(`/round/${round.id}`);

  // Screen 3 states the cap and the one take before anything is recorded.
  await expect(page.getByText("Up to 4 min")).toBeVisible();
  await expect(page.getByText("One take. There is no re-recording.")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("screen3-realistic.png"), fullPage: true });
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("Stops by itself at 4 minutes. What was recorded up to then is kept.")).toBeVisible();
  await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });

  // The clock counts up beside its limit, and never down: no warning, no grace, no prompt (10 §4).
  await page.clock.fastForward("03:50");
  await expect(page.getByTestId("record-timer")).toHaveText(/^3:5\d$/);
  await expect(page.getByRole("button", { name: "Stop and transcribe" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/remaining|left|seconds to go/i);

  // At 4:00 the take ends by itself — nobody pressed stop — and what was captured went to S3.
  await page.clock.fastForward("00:15");
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  const takes = takesOf(await seededUserId(), round.id);
  expect(takes).toHaveLength(1);
  expect(takes[0].bytes).toBeGreaterThan(0);

  // One take: the transcript screen offers the correction and no way back to the microphone.
  await expect(page.getByRole("button", { name: "Correct the transcript" })).toBeVisible();
  await expect(page.getByRole("button", { name: /record/i })).toHaveCount(0);
});

test("the runaway guard fires: a practice take is kept at 15 minutes, and is never drawn as a timer", async ({ page }) => {
  await signIn(page);
  const speech = speechRequestsOf(page);
  const before = openAi.requests.length;
  const round = await startRound(page, "practice");
  // Stored as the round's cap (03 §7), since the column is not null — and that is all it is.
  expect(round.per_answer_cap_seconds).toBe(900);
  await page.clock.install();
  await page.goto(`/round/${round.id}`);

  const frame = page.locator("main");
  await expect(page.getByTestId("round-question")).toBeVisible();
  await expect(frame).toContainText("English · Practice · 3 questions");
  // Practice is text only (10 §3): no speaker line, and nothing is asked of the speech route.
  await expect(page.getByTestId("speaker-line")).toBeEmpty();
  await page.screenshot({ path: test.info().outputPath("screen3-practice.png"), fullPage: true });
  const neverATimer = /\d:\d\d|\bmin(ute)?s?\b|up to|stops by itself|one take/i;
  await expect(frame).not.toContainText(neverATimer);

  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  await expect(page.getByTestId("waveform").locator("span > span").first()).toBeVisible();
  // Recording, with the guard armed — and no clock, no limit and no remainder to watch (03 §7).
  await expect(page.getByTestId("record-timer")).toHaveCount(0);
  await expect(frame).not.toContainText(neverATimer);

  await page.clock.fastForward("14:50");
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await expect(page.getByTestId("record-timer")).toHaveCount(0);
  await expect(frame).not.toContainText(neverATimer);

  // At 15:00 it behaves exactly like the cap: the take ends and is kept — held, as any practice take
  // is when it stops (10 §15), and transcribed when the user says so.
  await page.clock.fastForward("00:15");
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  await expect(frame).not.toContainText(neverATimer);
  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  const takes = takesOf(await seededUserId(), round.id);
  expect(takes).toHaveLength(1);
  expect(takes[0].bytes).toBeGreaterThan(0);

  expect(speech).toEqual([]);
  expect(openAi.requests.slice(before).filter((request) => request.path === "/v1/audio/speech")).toHaveLength(0);
  const refused = await page.request.get(`/api/rounds/${round.id}/speech?position=1&kind=question`);
  expect(refused.status()).toBe(404);
});

test("a reloaded realistic round asks for its prompt by position, and plays it when asked to", async ({ page }) => {
  await signIn(page);
  const speech = speechRequestsOf(page);
  const round = await startRound(page, "realistic");
  // A page opened by URL has had no gesture, so the browser will not play sound yet. Headless Chromium
  // on Linux plays it anyway, so the refusal is stated here; after the click the browser's own play runs.
  await page.addInitScript(() => {
    let gesture = false;
    document.addEventListener("click", () => { gesture = true; }, { capture: true });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!gesture) return Promise.reject(new DOMException("Playback requires a gesture", "NotAllowedError"));
      return play.call(this);
    };
  });
  await page.goto(`/round/${round.id}`);

  const line = page.getByTestId("speaker-line");
  await expect(line.getByRole("button", { name: "Hear the question" })).toBeVisible();
  const question = await page.getByTestId("round-question").boundingBox();
  await line.getByRole("button", { name: "Hear the question" }).click();
  await expect(line).toHaveText(SPOKEN);
  // …and still stands once the audio has played out: a stream the browser could not play would have
  // replaced it with the failure notice.
  await page.waitForTimeout(1_000);
  await expect(line).toHaveText(SPOKEN);
  // The line swaps in place: the question does not move (10 §4).
  expect(await page.getByTestId("round-question").boundingBox()).toEqual(question);

  expect(speech).toEqual([`/api/rounds/${round.id}/speech?position=1&kind=question`]);
  const upstream = openAi.requests.filter((request) => request.path === "/v1/audio/speech");
  expect(upstream.at(-1)!.body.input).toBe(await page.getByTestId("round-question").textContent());
});

test("pausing a pending spoken question to record does not show a speech failure", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await signIn(page);
  const round = await startRound(page, "realistic");
  await page.route(`**/api/rounds/${round.id}/speech?*`, (route) =>
    route.fulfill({ status: 200, contentType: "audio/mpeg", body: Buffer.from(silentMp3()) }),
  );
  await page.addInitScript(() => {
    let gesture = false;
    let rejectPlayback: (error: DOMException) => void = () => {};
    document.addEventListener("click", () => { gesture = true; }, { capture: true });
    HTMLMediaElement.prototype.play = function () {
      if (!gesture) return Promise.reject(new DOMException("Playback requires a gesture", "NotAllowedError"));
      return new Promise<void>((_resolve, reject) => {
        rejectPlayback = reject;
      });
    };
    HTMLMediaElement.prototype.pause = function () {
      rejectPlayback(new DOMException("Playback was paused", "AbortError"));
    };
    navigator.mediaDevices.getUserMedia = async () => {
      // Not a refusal: #48 gives a blocked microphone its own sentence.
      throw new DOMException("Microphone unavailable", "NotFoundError");
    };
  });
  await page.goto(`/round/${round.id}`);

  const line = page.getByTestId("speaker-line");
  await line.getByRole("button", { name: "Hear the question" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("The microphone is not available. Nothing was recorded, and the question stays unseen.")).toBeVisible();
  await expect(line).toHaveText(SPOKEN);
  await page.screenshot({ path: test.info().outputPath("screen3-paused-speech.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("a failed speech request shows the notice, and the round goes on as text", async ({ page }) => {
  await signIn(page);
  speechFails = true;
  const speech = speechRequestsOf(page);
  const round = await startRound(page, "realistic");
  const failed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/speech"));
  await page.goto(`/round/${round.id}`);

  const response = await failed;
  expect(response.status()).toBe(502);
  // The envelope is read from a request of the test's own, never from the page's: the audio element
  // drops a load that answered 502, and Chromium keeps no body for a request cancelled before it
  // finished — which this one is, some of the time.
  const refused = await page.request.get(response.url());
  expect(refused.status()).toBe(502);
  expect((await refused.json()).error).toMatchObject({
    code: "speech_failed",
    detail: { round_id: round.id, position: 1, error_class: "upstream_503" },
  });

  // The speaker line is replaced by the catalogue's sentence; the question is still there to answer.
  const line = page.getByTestId("speaker-line");
  await expect(line).toHaveText("The question could not be read aloud. It stays as text; answer it as usual.");
  await expect(line.getByRole("button")).toHaveCount(0);
  await expect(page.getByTestId("round-question")).not.toBeEmpty();
  await page.screenshot({ path: test.info().outputPath("screen3-speech-failed.png"), fullPage: true });

  // The round goes on: the take is recorded, uploaded and transcribed as usual.
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  await page.getByRole("button", { name: "Correct the transcript" }).click();
  await page.getByRole("button", { name: "Send this answer" }).click();
  // Its follow-up is asked as text: nothing is requested of the route for it, so nothing has failed.
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");
  await expect(page.getByTestId("round-question")).toHaveText(FOLLOW_UP);
  await expect(line).toBeEmpty();
  expect(speech).toEqual([`/api/rounds/${round.id}/speech?position=1&kind=question`]);
});
