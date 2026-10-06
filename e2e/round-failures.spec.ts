import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, test, type Page } from "@playwright/test";
import * as s from "../db/schema";
import { seedSyntheticCv } from "../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions";
import { createAuth } from "../lib/auth/auth";
import { mintSessionCookie } from "../lib/auth/test/session";
import { getConfig } from "../lib/config";
import { E2E_URL, MOCK_S3_ENDPOINT } from "./database";
import { generatedQuestions, startMockOpenAi, type MockOpenAi } from "./mock-openai";
import { startMockS3, type MockS3 } from "./mock-s3";

// The round's failure paths (#48), end to end against the production build (11 §4): an upload held
// on the device, a take that cannot be transcribed, scores pending or failed on the feedback screen,
// resume, a denied microphone, and a spent OpenAI project. S3 and OpenAI are the local mocks.
//
// Every round here is `behavioural`: this file runs before round.spec.ts (one worker, file order),
// and that spec expects the HR bank's first set piece still unseen.

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

const RAW = "I led the pay mints migration, um, over six months and cut the failure rate by half.";
const CORRECTED = "I led the payments migration over six months and cut the failure rate by half.";
const TYPED = "I led the payments migration over six months. I typed this because the take could not be read.";
const FOLLOW_UP = "What did you measure to know the failure rate had halved?";
const FOLLOW_UP_JA = "その移行で、障害率はどのように測りましたか。";
const RAW_JA = "えー、前職では決済基盤の移行を担当しておりまして、半年で完了いたしました。";

const DIMENSIONS = ["structure", "evidence", "relevance", "fluency", "accuracy", "length_pacing"];
const FINDINGS = {
  to_fix: [
    { title: "Lead with the result", body: "In answer 1, the outcome arrives last." },
    { title: "Name the number", body: "In answer 2, the scale of the change stays vague." },
  ],
  what_worked: "In answer 3, the example was concrete and your own.",
};
const FINDINGS_JA = {
  to_fix: [
    { title: "結論を最初の一文に置く", body: "第1問で、結論が最後に出てくる。" },
    { title: "数値を一つ挙げる", body: "第2問で、成果が抽象的なままである。" },
  ],
  what_worked: "第3問で、具体的な場面を挙げて説明できている。",
  translated: {
    to_fix: [
      { title: "Put the conclusion first", body: "In answer 1, the conclusion arrives last." },
      { title: "Name one number", body: "In answer 2, the outcome stays abstract." },
    ],
    what_worked: "In answer 3, you explained with a concrete situation.",
  },
};

let s3: MockS3;
let openAi: MockOpenAi;
let heard = { text: RAW, seconds: 18 };
let transcriptionFails = false;
let projectSpent = false;

const formatOf = (body: Record<string, unknown>) => ((body.text as { format?: { name?: string } } | undefined)?.format?.name ?? "") as string;
const japanese = (body: Record<string, unknown>) => String(body.input).startsWith("=== rubric ja ");

test.beforeAll(async () => {
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
    (body) => {
      if (formatOf(body) === "answer_scores") {
        const dimensions = japanese(body) ? [...DIMENSIONS, "keigo"] : DIMENSIONS;
        return {
          scores: dimensions.map((dimension) => ({ dimension, value: 3, justification: "e2e" })),
          citations: [],
          unsupported: [],
          answered_language: japanese(body) ? "ja" : "en",
        };
      }
      if (formatOf(body) === "generated_questions") return generatedQuestions(body);
      if (formatOf(body) === "round_feedback") return { ...(japanese(body) ? FINDINGS_JA : FINDINGS), untouched: [] };
      if (formatOf(body) === "follow_up") return { follow_up: String(body.instructions).includes("深掘り") ? FOLLOW_UP_JA : FOLLOW_UP };
      return { fail: 400 };
    },
    {
      transcription: () => (transcriptionFails ? { fail: 500 } : heard),
      // 12 §6: what a project past its hard monthly limit answers.
      preflight: () => (projectSpent ? { fail: 429, code: "project_spend_limit_exceeded" } : null),
    },
  );
});

test.afterAll(async () => {
  await openAi?.close();
  await s3?.close();
});

test.beforeEach(() => {
  heard = { text: RAW, seconds: 18 };
  transcriptionFails = false;
  projectSpent = false;
});

async function startRound(page: Page, language: "ja" | "en" = "en", mode: "realistic" | "practice" = "realistic") {
  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  expect(context.ok()).toBe(true);
  const round = await page.request.post("/api/rounds", {
    data: { round_type: "behavioural", language, mode, length: 3, role_context_id: (await context.json()).id },
  });
  expect(round.status()).toBe(201);
  const roundId = (await round.json()).round.id as string;
  // 07 §2: a created row names where it is read back from, which is the resume read.
  expect(round.headers().location).toBe(`/api/rounds/${roundId}`);
  return roundId;
}

/** A slot and its upload through the API, for the round's current prompt: the take is in S3 and not transcribed. */
async function uploadByApi(page: Page, roundId: string) {
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, { data: { content_type: "audio/webm", expected_bytes: 4 } });
  const slot = await opened.json();
  const put = await page.request.put(slot.upload.url, { headers: slot.upload.headers, data: Buffer.from([1, 2, 3, 4]) });
  expect(put.ok()).toBe(true);
  return slot.answer_id as string;
}

async function answerByApi(page: Page, roundId: string, corrected = CORRECTED) {
  const answerId = await uploadByApi(page, roundId);
  expect((await page.request.post(`/api/answers/${answerId}/transcribe`, { data: {} })).ok()).toBe(true);
  const submitted = await page.request.post(`/api/answers/${answerId}/submit`, { data: { transcript_corrected: corrected } });
  expect(submitted.ok()).toBe(true);
  return answerId;
}

/** A whole round through the API, scored and complete: every question and its follow-up. */
async function completeByApi(page: Page, roundId: string, corrected = CORRECTED) {
  const questions: string[] = [];
  for (let position = 1; position <= 3; position += 1) {
    questions.push(await answerByApi(page, roundId, corrected));
    await answerByApi(page, roundId, corrected);
  }
  await expect
    .poll(
      () =>
        withDb(async (db) => {
          const rows = await db
            .select({ status: s.scoringAttempts.status })
            .from(s.scoringAttempts)
            .innerJoin(s.answers, eq(s.answers.id, s.scoringAttempts.answerId))
            .where(eq(s.answers.roundId, roundId));
          return rows.length === 6 && rows.every((row) => row.status === "ok");
        }),
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  const completed = await page.request.post(`/api/rounds/${roundId}/complete`, { data: { felt_pressure: 3 } });
  expect(completed.status()).toBe(201);
  return questions;
}

/** Screen 4 in the browser: record a second of the fake microphone's tone, and stop. */
async function record(page: Page) {
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
}

/** What the browser holds in IndexedDB (03 §5): each held take's prompt, its size, and the answer it is given again beside. */
function heldTakes(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ roundId: string; position: number; followUp: boolean; bytes: number; again: string | null }[]>((resolve, reject) => {
        const request = indexedDB.open("suburi-round");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("held-takes")) {
            database.close();
            resolve([]);
            return;
          }
          const all = database.transaction("held-takes").objectStore("held-takes").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            database.close();
            resolve(
              (all.result as { roundId: string; position: number; followUp: boolean; blob: Blob; again?: string | null }[]).map((take) => ({
                roundId: take.roundId,
                position: take.position,
                followUp: take.followUp,
                bytes: take.blob.size,
                again: take.again ?? null,
              })),
            );
          };
        };
      }),
  );
}

/** Whether leaving the page now would be warned against: a cancelled `beforeunload` is the browser's prompt. */
function warnsBeforeUnload(page: Page) {
  return page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
}

const answersOf = (roundId: string) => withDb((db) => db.select().from(s.answers).where(eq(s.answers.roundId, roundId)));
const resumeOf = async (page: Page, roundId: string) => (await (await page.request.get(`/api/rounds/${roundId}`)).json()) as {
  round: { status: string };
  answers: { id: string; state: string }[];
  prompt: { text: string } | null;
  resume: { at: string; answer_id?: string } | null;
};

const HELD = "The take could not be uploaded. It is held on this device. Do not close this tab.";
const UNTRANSCRIBED = "Transcription failed. The take is kept — retry it, or type your answer instead.";

test("an upload that fails is held on this device, survives a reload, and the retry delivers it", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  let uploadsFail = true;
  await page.route(`${MOCK_S3_ENDPOINT}/**`, (route) => (uploadsFail ? route.abort("failed") : route.continue()));
  // A real unload prompt, if the browser raises one on the reload below, is accepted.
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`/round/${roundId}`);
  const question = (await page.getByTestId("round-question").textContent())!;
  expect(await warnsBeforeUnload(page)).toBe(false);
  await record(page);

  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The take is the answer: nothing offers to record over it.
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  await expect(page.getByTestId("round-question")).toHaveText(question);
  expect(await warnsBeforeUnload(page)).toBe(true);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1, followUp: false });
  expect(held.bytes).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath("screen4-upload-held.png"), fullPage: true });

  // The slot is open and nothing reached the bucket: the round stands at the same call.
  const [slot] = await answersOf(roundId);
  expect(slot.transcriptRaw).toBeNull();
  expect(s3.objects.has(slot.audioS3Key!)).toBe(false);

  // Still there after a reload, on the same question, and a second failure keeps it.
  await page.reload();
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  await expect(page.getByTestId("round-question")).toHaveText(question);
  expect(await heldTakes(page)).toEqual([held]);
  expect(await warnsBeforeUnload(page)).toBe(true);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  expect(await heldTakes(page)).toEqual([held]);

  uploadsFail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  // Delivered: one answer row, the held bytes in the bucket, and nothing left on the device.
  const answers = await answersOf(roundId);
  expect(answers).toHaveLength(1);
  expect(answers[0].id).toBe(slot.id);
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBe(held.bytes);
  expect(await heldTakes(page)).toEqual([]);
  expect(await warnsBeforeUnload(page)).toBe(false);
});

test("a practice take whose upload fails is held like any other, and the retry lands on the frame that keeps it or records again", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page, "en", "practice");
  let uploadsFail = true;
  await page.route(`${MOCK_S3_ENDPOINT}/**`, (route) => (uploadsFail ? route.abort("failed") : route.continue()));
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`/round/${roundId}`);
  await page.getByRole("button", { name: "Start recording" }).click();
  // The waveform scrolls a bar a second; the second bar is a take with a second of sound in it.
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 5_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();

  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  expect(await heldTakes(page)).toMatchObject([{ roundId, position: 1 }]);
  await page.reload();
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);

  uploadsFail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  // The PUT landed: practice's own frame, with the take in the bucket and no copy left on the device.
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  await expect(page.getByRole("button", { name: "Record again" })).toBeVisible();
  const [slot] = await answersOf(roundId);
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBeGreaterThan(0);
  expect(await heldTakes(page)).toEqual([]);
  expect(await warnsBeforeUnload(page)).toBe(false);

  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  expect(await answersOf(roundId)).toHaveLength(1);
});

test("an audio-missing response keeps the original take for upload retry", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await page.route("**/api/answers/*/transcribe", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "audio_missing", message: "No take has been uploaded.", detail: {} } }),
    }),
  );
  await page.goto(`/round/${roundId}`);
  await record(page);
  await expect(page.getByTestId("take-notice")).toContainText(HELD);
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1 });
  await page.unroute("**/api/answers/*/transcribe");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  expect(await heldTakes(page)).toEqual([]);
  expect(await answersOf(roundId)).toHaveLength(1);
});

test("a take that cannot be transcribed is kept: retry and typing are both offered, and a typed answer is stored as typed", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  transcriptionFails = true;
  await page.goto(`/round/${roundId}`);
  const question = (await page.getByTestId("round-question").textContent())!;
  await record(page);

  await expect(page.getByTestId("take-notice")).toHaveText(UNTRANSCRIBED);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Type the answer instead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  const [slot] = await answersOf(roundId);
  // The take is kept, in the bucket, and its raw transcript is still to come.
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBeGreaterThan(0);
  expect(slot.transcriptRaw).toBeNull();
  await page.screenshot({ path: test.info().outputPath("screen5-transcription-failed.png"), fullPage: true });

  // The retry fails the same way, and so does a reload, which resumes at the same call (07 §5.5).
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("take-notice")).toHaveText(UNTRANSCRIBED);
  await page.reload();
  await expect(page.getByTestId("take-notice")).toHaveText(UNTRANSCRIBED);
  await expect(page.getByTestId("round-question")).toHaveText(question);
  expect(await answersOf(roundId)).toHaveLength(1);

  await page.getByRole("button", { name: "Type the answer instead" }).click();
  await expect(page.getByRole("button", { name: "Save the typed answer" })).toBeDisabled();
  await page.getByRole("textbox").fill(TYPED);
  await page.screenshot({ path: test.info().outputPath("screen5-typing.png"), fullPage: true });
  await page.getByRole("button", { name: "Save the typed answer" }).click();

  // Screen 5 with the typed text as the raw transcript, and no figures: there was no delivery to measure.
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  await expect(page.getByTestId("take-figures")).toHaveText("");
  await page.getByRole("button", { name: "Correct the transcript" }).click();
  await expect(page.getByTestId("rewrite-percent")).toHaveText("0%");
  await page.getByRole("button", { name: "Send this answer" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · follow-up");

  const [stored] = await withDb((db) => db.select().from(s.answers).where(eq(s.answers.id, slot.id)));
  expect(stored).toMatchObject({
    transcriptRaw: TYPED,
    transcriptCorrected: TYPED,
    transcriberModelId: null,
    wordsPerMinute: null,
    audioDurationMs: null,
    audioS3Key: slot.audioS3Key,
  });
});

test("a take that cannot be transcribed at first is transcribed by the retry, with no new take", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  transcriptionFails = true;
  await page.goto(`/round/${roundId}`);
  await record(page);
  await expect(page.getByTestId("take-notice")).toHaveText(UNTRANSCRIBED);
  const [slot] = await answersOf(roundId);
  const uploaded = s3.objects.get(slot.audioS3Key!)?.bytes;

  transcriptionFails = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  await expect(page.getByTestId("take-figures")).toHaveText("0:18 · ~57 wpm · 17 words");
  const [stored] = await answersOf(roundId);
  expect(stored).toMatchObject({ id: slot.id, transcriptRaw: RAW });
  expect(stored.transcriberModelId).not.toBeNull();
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBe(uploaded);
});

test("a held take whose upload the server confirmed resumes at transcribe, not as a failed upload", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  // The server reads the object and confirms the upload; the response the page gets is a failure that keeps the take held.
  transcriptionFails = true;
  await page.route("**/api/answers/*/transcribe", async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "write_failed", message: "The write failed.", detail: {} } }),
    });
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/round/${roundId}`);
  await record(page);
  await expect(page.getByText("Try again")).toBeVisible();
  expect(await warnsBeforeUnload(page)).toBe(false);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1 });
  const [slot] = await answersOf(roundId);
  expect(slot.audioUploadedAt).not.toBeNull();
  expect(slot.transcriptRaw).toBeNull();
  const uploaded = s3.objects.get(slot.audioS3Key!)?.bytes;

  transcriptionFails = false;
  await page.unroute("**/api/answers/*/transcribe");
  let slotCalls = 0;
  await page.route("**/api/rounds/*/answers", (route) => {
    slotCalls += 1;
    return route.continue();
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/answers/*/transcribe", async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload();
  // The take is in S3: the page says it is transcribing, not uploading, and leaving loses nothing.
  await expect(page.getByText("Transcribing your answer.")).toBeVisible();
  await expect(page.getByText("Uploading your recording.")).toHaveCount(0);
  expect(await warnsBeforeUnload(page)).toBe(false);
  release();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  expect(slotCalls).toBe(0);
  expect(await heldTakes(page)).toEqual([]);
  const answers = await answersOf(roundId);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ id: slot.id, transcriptRaw: RAW });
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBe(uploaded);
});

test("a practice take recorded again and held beats the older take the server confirmed: the reload sends the held one", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page, "en", "practice");
  page.on("dialog", (dialog) => void dialog.accept());
  const recordTake = async (start: string, bars: number) => {
    await page.getByRole("button", { name: start }).click();
    await expect(page.getByTestId("waveform").locator("span > span").nth(bars)).toBeAttached({ timeout: 10_000 });
    await page.getByRole("button", { name: "Stop recording" }).click();
  };

  // Take 1 reaches S3 and is kept; the server confirms the upload, and the page is told the call failed.
  await page.goto(`/round/${roundId}`);
  await recordTake("Start recording", 1);
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  transcriptionFails = true;
  await page.route("**/api/answers/*/transcribe", async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "write_failed", message: "The write failed.", detail: {} } }),
    });
  });
  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByRole("button", { name: "Record again" })).toBeEnabled();
  const [slot] = await answersOf(roundId);
  expect(slot.audioUploadedAt).not.toBeNull();
  expect(slot.transcriptRaw).toBeNull();
  const first = s3.objects.get(slot.audioS3Key!)!.bytes;
  transcriptionFails = false;
  await page.unroute("**/api/answers/*/transcribe");

  // Take 2, longer, is recorded instead, and its upload fails: it is held on the device.
  let uploadsFail = true;
  await page.route(`${MOCK_S3_ENDPOINT}/**`, (route) => (uploadsFail ? route.abort("failed") : route.continue()));
  await recordTake("Record again", 3);
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1 });
  expect(held.bytes).toBeGreaterThan(first);
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBe(first);

  // The reload sends the held take rather than transcribing take 1, and nothing is transcribed unasked.
  let transcribeCalls = 0;
  await page.route("**/api/answers/*/transcribe", (route) => {
    transcribeCalls += 1;
    return route.continue();
  });
  uploadsFail = false;
  await page.reload();
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  expect(transcribeCalls).toBe(0);
  expect(s3.objects.get(slot.audioS3Key!)?.bytes).toBe(held.bytes);
  expect(await heldTakes(page)).toEqual([]);

  await page.getByRole("button", { name: "Transcribe this take" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  const answers = await answersOf(roundId);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ id: slot.id, transcriptRaw: RAW });
});

test("a practice answer-again take whose slot never opened is held across a reload and offered again", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page, "en", "practice");
  page.on("dialog", (dialog) => void dialog.accept());

  // Question 1 is answered, and the round stands on its per-answer frame.
  const first = await answerByApi(page, roundId);
  await page.goto(`/round/${roundId}`);
  await page.getByRole("button", { name: "Answer again" }).click();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");

  // The call that opens the slot never reaches the server: no answer-again row exists.
  await page.route("**/api/rounds/*/answers", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 10_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("take-notice")).toContainText(HELD);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1, again: first });
  expect(await answersOf(roundId)).toHaveLength(1);

  // The reload offers that take again, on the question it answers again, and the retry delivers it.
  await page.unroute("**/api/rounds/*/answers");
  await page.reload();
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");
  expect(await warnsBeforeUnload(page)).toBe(true);
  expect(await heldTakes(page)).toEqual([held]);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("take-held")).toHaveText("Take recorded — not transcribed yet");
  const answers = await answersOf(roundId);
  expect(answers).toHaveLength(2);
  expect(answers.find((answer) => answer.id !== first)).toMatchObject({ position: 1, retryOfAnswerId: first });
  expect(await heldTakes(page)).toEqual([]);
});

test("a retry of a held take whose answer was transcribed meanwhile shows that transcript", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await page.route(`${MOCK_S3_ENDPOINT}/**`, (route) => route.abort("failed"));
  await page.goto(`/round/${roundId}`);
  await record(page);
  await expect(page.getByTestId("take-notice")).toHaveText(HELD);

  // The same slot, uploaded and transcribed from elsewhere while this page still holds its take.
  const answerId = await uploadByApi(page, roundId);
  expect((await page.request.post(`/api/answers/${answerId}/transcribe`, { data: {} })).ok()).toBe(true);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  expect(await heldTakes(page)).toEqual([]);
  expect(await answersOf(roundId)).toHaveLength(1);
});

const REFUSED = {
  upload_too_large: {
    en: "This recording is too large to be uploaded. Type your answer instead.",
    ja: "この録音はサイズが大きすぎるため、アップロードできません。回答を入力してください。",
  },
  unsupported_content_type: {
    en: "This recording is in an audio format that cannot be uploaded. Type your answer instead.",
    ja: "この録音は対応していない音声形式のため、アップロードできません。回答を入力してください。",
  },
} as const;
const TYPED_CAPTION = {
  en: "A typed answer is recorded as typed. It has no duration and no pace, and it is not counted in progress.",
  ja: "入力した回答は、入力したものとして記録します。時間と話す速さは記録せず、進捗にも入れません。",
};
const TAKE_KEPT = { en: " The take is kept.", ja: "録音は残ります。" };
const REFUSALS = ["upload_too_large", "unsupported_content_type"] as const;

/** What the slot route answers a take it can never accept (07 §5.6); the typed slot still goes through. */
const refuseTakes = (page: Page, code: (typeof REFUSALS)[number]) =>
  page.route("**/api/rounds/*/answers", (route) => {
    if (route.request().postDataJSON()?.source === "typed") return route.continue();
    return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: { code, message: "The take was refused.", detail: {} } }),
    });
  });

for (const code of REFUSALS) {
  for (const onDevice of [true, false]) {
    for (const language of ["en", "ja"] as const) {
      test(`a take refused as ${code}, ${onDevice ? "held on the device" : "only in the tab"}, says once why and to type instead: ${language}`, async ({ page }) => {
        await signIn(page);
        const roundId = await startRound(page, language);
        await refuseTakes(page, code);
        // A browser that cannot store the take: it is then only in the tab.
        if (!onDevice) await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }));
        await page.goto(`/round/${roundId}`);
        await page.getByRole("button", { name: language === "ja" ? "録音を開始" : "Start recording" }).click();
        await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
        await page.getByRole("button", { name: language === "ja" ? "停止して文字起こし" : "Stop and transcribe" }).click();

        // The whole of what the frame says: nothing about trying again, or about the tab.
        await expect(page.getByTestId("take-notice")).toHaveText(REFUSED[code][language]);
        await expect(page.getByRole("button", { name: language === "ja" ? "もう一度試す" : "Try again" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: language === "ja" ? "回答を入力する" : "Type the answer instead" })).toBeVisible();
        expect(await answersOf(roundId)).toEqual([]);
      });
    }
  }
}

for (const code of REFUSALS) test(`a take refused as ${code} is kept on the device, says why, and is answered by typing`, async ({ page }) => {
  const message = REFUSED[code].en;
  await signIn(page);
  const roundId = await startRound(page);
  await refuseTakes(page, code);
  await page.goto(`/round/${roundId}`);
  await record(page);

  await expect(page.getByTestId("take-notice")).toHaveText(message);
  await expect(page.getByRole("button", { name: "Type the answer instead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1 });
  expect(await warnsBeforeUnload(page)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("take-notice")).toHaveText(message);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(await heldTakes(page)).toEqual([held]);
  await page.getByRole("button", { name: "Type the answer instead" }).click();
  await page.getByLabel("Your answer — typed, not spoken").fill(TYPED);
  await page.getByRole("button", { name: "Save the typed answer" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  expect(await heldTakes(page)).toEqual([held]);
  const [answer] = await answersOf(roundId);
  expect(answer).toMatchObject({ transcriptRaw: TYPED, transcriberModelId: null, audioS3Key: null });
  await page.reload();
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  expect(await heldTakes(page)).toEqual([held]);
});

test("a refused practice answer-again take answered by typing is not offered again once that answer is sent", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page, "en", "practice");
  page.on("dialog", (dialog) => void dialog.accept());
  const first = await answerByApi(page, roundId);
  await page.goto(`/round/${roundId}`);
  await page.getByRole("button", { name: "Answer again" }).click();

  // The slot route refuses the take: no answer-again row exists, and the held take names the answer it is beside.
  await refuseTakes(page, "upload_too_large");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("waveform").locator("span > span").nth(1)).toBeAttached({ timeout: 10_000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByTestId("take-notice")).toHaveText(REFUSED.upload_too_large.en);
  const [held] = await heldTakes(page);
  expect(held).toMatchObject({ roundId, position: 1, again: first });

  // Typed instead: the answer-again row exists, and the take is kept without naming an answer still to be given.
  await page.getByRole("button", { name: "Type the answer instead" }).click();
  await page.getByLabel("Your answer — typed, not spoken").fill(TYPED);
  await page.getByRole("button", { name: "Save the typed answer" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  expect(await heldTakes(page)).toEqual([{ ...held, again: null }]);
  const typed = (await answersOf(roundId)).find((answer) => answer.id !== first);
  expect(typed).toMatchObject({ position: 1, retryOfAnswerId: first, transcriptRaw: TYPED });

  // Once that answer is sent, a reload opens on its per-answer frame, not on the refusal again.
  expect((await page.request.post(`/api/answers/${typed!.id}/submit`, { data: { transcript_corrected: TYPED } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Answer again" })).toBeVisible();
  await expect(page.getByTestId("round-step")).toHaveText("Question 1 / 3 · again");
  await expect(page.getByTestId("take-notice")).toHaveCount(0);
  expect(await answersOf(roundId)).toHaveLength(2);
});

test("a typed answer whose response was lost is shown by saving it again, not refused as already final", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await refuseTakes(page, "upload_too_large");
  await page.goto(`/round/${roundId}`);
  await record(page);
  await page.getByRole("button", { name: "Type the answer instead" }).click();
  await page.getByLabel("Your answer — typed, not spoken").fill(TYPED);

  // The text is stored and the response never arrives.
  let lost = 0;
  await page.route("**/api/answers/*/transcript", async (route) => {
    if (lost > 0) return route.fallback();
    lost += 1;
    await route.fetch();
    await route.abort();
  });
  await page.getByRole("button", { name: "Save the typed answer" }).click();
  await expect.poll(async () => (await answersOf(roundId))[0]?.transcriptRaw).toBe(TYPED);
  await expect(page.getByTestId("raw-transcript")).toHaveCount(0);

  await page.getByRole("button", { name: "Save the typed answer" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  expect(await answersOf(roundId)).toHaveLength(1);
});

test("a reload onto a slot opened as typed opens the typing box, never the record frame, and saves onto that slot", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  const opened = await page.request.post(`/api/rounds/${roundId}/answers`, { data: { source: "typed" } });
  expect(opened.status()).toBe(201);
  const { answer_id: answerId } = (await opened.json()) as { answer_id: string };
  expect((await resumeOf(page, roundId)).resume).toEqual({ at: "transcript", answer_id: answerId });

  await page.goto(`/round/${roundId}`);
  await expect(page.getByLabel("Your answer — typed, not spoken")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Type the answer instead" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save the typed answer" })).toBeDisabled();
  // No take is held: the caption does not say one is kept.
  expect(await heldTakes(page)).toEqual([]);
  await expect(page.getByTestId("typed-caption")).toHaveText(TYPED_CAPTION.en);

  await page.getByLabel("Your answer — typed, not spoken").fill(TYPED);
  await page.getByRole("button", { name: "Save the typed answer" }).click();
  await expect(page.getByTestId("raw-transcript")).toHaveText(TYPED);
  const answers = await answersOf(roundId);
  expect(answers).toHaveLength(1);
  expect(answers[0]).toMatchObject({ id: answerId, transcriptRaw: TYPED, transcriberModelId: null, audioS3Key: null });
});

for (const language of ["en", "ja"] as const) {
  test(`a reload onto a typed slot says the take is kept only when one is held: ${language}`, async ({ page }) => {
    await signIn(page);
    const roundId = await startRound(page, language);
    await refuseTakes(page, "upload_too_large");
    await page.goto(`/round/${roundId}`);
    await page.getByRole("button", { name: language === "ja" ? "録音を開始" : "Start recording" }).click();
    await expect(page.getByTestId("record-timer")).toHaveText("0:01", { timeout: 5_000 });
    await page.getByRole("button", { name: language === "ja" ? "停止して文字起こし" : "Stop and transcribe" }).click();
    await expect(page.getByTestId("take-notice")).toHaveText(REFUSED.upload_too_large[language]);
    expect(await heldTakes(page)).toHaveLength(1);
    expect((await page.request.post(`/api/rounds/${roundId}/answers`, { data: { source: "typed" } })).status()).toBe(201);

    await page.reload();
    await expect(page.getByTestId("typed-caption")).toHaveText(TYPED_CAPTION[language] + TAKE_KEPT[language]);
    await expect(page.getByRole("button", { name: language === "ja" ? "録音を開始" : "Start recording" })).toHaveCount(0);

    // The same slot in a browser holding nothing: the sentence about the take is gone, and nothing else.
    await page.evaluate(() => new Promise((done) => (indexedDB.deleteDatabase("suburi-round").onsuccess = done)));
    await page.reload();
    await expect(page.getByTestId("typed-caption")).toHaveText(TYPED_CAPTION[language]);
  });
}

test("an unconfirmed upload resumes at upload, then transcription completes without a new take", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  const answerId = await uploadByApi(page, roundId);
  expect((await resumeOf(page, roundId)).resume).toEqual({ at: "upload", answer_id: answerId });

  transcriptionFails = true;
  const failed = await page.request.post(`/api/answers/${answerId}/transcribe`, { data: {} });
  expect((await failed.json()).error.code).toBe("transcription_failed");
  expect((await resumeOf(page, roundId)).resume).toEqual({ at: "transcribe", answer_id: answerId });
  transcriptionFails = false;

  await page.goto(`/round/${roundId}`);
  await expect(page.getByTestId("raw-transcript")).toHaveText(RAW);
  expect((await resumeOf(page, roundId)).resume).toEqual({ at: "submit", answer_id: answerId });
  expect(await answersOf(roundId)).toHaveLength(1);
});

test("a denied microphone pauses the round: the fix is on screen, nothing is written, and the question stays unseen", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  // What a browser answers once the user, or a policy, has refused the microphone for the site.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  const opened: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/")) opened.push(request.url());
  });

  await page.goto(`/round/${roundId}`);
  const question = (await page.getByTestId("round-question").textContent())!;
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("recording-failed")).toHaveText(
    "The microphone is blocked for this site. Allow it from the icon in the address bar, then start recording again. Nothing was recorded, and the question stays unseen.",
  );
  // Paused, not ended: the same question, and the way to record it still there.
  await expect(page.getByTestId("round-question")).toHaveText(question);
  await expect(page.getByRole("button", { name: "Start recording" })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("screen3-mic-denied.png"), fullPage: true });

  expect(opened).toEqual([]);
  expect(await answersOf(roundId)).toEqual([]);
  expect(await heldTakes(page)).toEqual([]);
  const resumed = await resumeOf(page, roundId);
  expect(resumed.resume).toEqual({ at: "answers" });
  expect(resumed.prompt?.text).toBe(question);
});

test("resume: a reload returns to the same question with the earlier answers intact, and an abandoned round is read-only", async ({ page }) => {
  await signIn(page);
  const first = await startRound(page);
  await answerByApi(page, first);
  await answerByApi(page, first);

  await page.goto(`/round/${first}`);
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
  const question = (await page.getByTestId("round-question").textContent())!;
  const before = await answersOf(first);
  expect(before).toHaveLength(2);
  await page.reload();
  await expect(page.getByTestId("round-step")).toHaveText("Question 2 / 3");
  await expect(page.getByTestId("round-question")).toHaveText(question);
  expect(await answersOf(first)).toEqual(before);
  expect(await resumeOf(page, first)).toMatchObject({ round: { status: "in_progress" }, prompt: { text: question }, resume: { at: "answers" } });

  // A newer round abandons it (04 `rounds`): opening it again shows it as it was left, and no way to write.
  await startRound(page);
  await page.goto(`/round/${first}`);
  await expect(page.getByText("This round was left when a newer one started. It stays as it is.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByTestId("round-question")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("round-abandoned.png"), fullPage: true });
  const abandoned = await resumeOf(page, first);
  expect(abandoned).toMatchObject({ round: { status: "abandoned" }, prompt: null, resume: null });
  expect(abandoned.answers.map((answer) => answer.state)).toEqual(["submitted", "submitted"]);
  const refused = await page.request.post(`/api/rounds/${first}/answers`, { data: { content_type: "audio/webm", expected_bytes: 4 } });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("round_abandoned");
  expect(await answersOf(first)).toEqual(before);
});

test("resume: the newest round is abandoned too once its Asia/Tokyo day has passed, and says why", async ({ page }) => {
  await signIn(page);
  const roundId = await startRound(page);
  await page.goto(`/round/${roundId}`);
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();

  // The throwaway database standing in for a night's sleep: every round started a day earlier, so this
  // one is still the newest and its day has passed.
  await withDb((db) => db.update(s.rounds).set({ startedAt: sql`${s.rounds.startedAt} - interval '1 day'` }));
  await page.reload();
  await expect(page.getByText("This round was not finished on the day it started, so it was left. It stays as it is.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  expect(await resumeOf(page, roundId)).toMatchObject({ round: { status: "abandoned" }, resume: null });
});

/** The throwaway database standing in for a scorer that has not finished, or gave up: one answer's attempt is set to `status`. */
async function setScoring(answerId: string, status: "pending" | "failed") {
  await withDb((db) =>
    db
      .update(s.scoringAttempts)
      .set({ status, answeredLanguage: null, errorClass: status === "failed" ? "upstream_500" : null })
      .where(eq(s.scoringAttempts.answerId, answerId)),
  );
}

const NO_SPINNER = '[class*="animate-spin"], [role="progressbar"], [aria-busy="true"]';

test("a pending score and a failed one are stated plainly on the feedback screen, beside the findings, with no spinner", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const roundId = await startRound(page);
  const [first, second] = await completeByApi(page, roundId);
  await setScoring(first, "pending");
  await setScoring(second, "failed");

  await page.goto(`/round/${roundId}/feedback`);
  // The round feedback was not held back by either: it is on the screen.
  await expect(page.getByTestId("to-fix")).toContainText("Lead with the result");
  await expect(page.getByTestId("answer-region")).toHaveAttribute("data-position", "1");
  await expect(page.getByTestId("score-unscored")).toHaveText(Array(6).fill("Not scored yet"));
  await expect(page.getByTestId("score-value")).toHaveCount(0);
  await expect(page.locator(NO_SPINNER)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen8-pending.png"), fullPage: true });

  await page.getByRole("button", { name: "Question 2" }).click();
  await expect(page.getByTestId("score-unscored")).toHaveText(Array(6).fill("Not scored"));
  await page.getByRole("button", { name: "Question 3" }).click();
  await expect(page.getByTestId("score-value")).toHaveText(Array(6).fill("3"));
  await expect(page.locator(NO_SPINNER)).toHaveCount(0);
  // Nothing on the screen is waiting: a reload a moment later shows the same thing.
  await page.reload();
  await expect(page.getByTestId("score-unscored")).toHaveText(Array(6).fill("Not scored yet"));
});

test("a Japanese round's failed score reads 未採点, and its 講評 is on the screen without it", async ({ page }) => {
  test.setTimeout(120_000);
  heard = { text: RAW_JA, seconds: 12 };
  await signIn(page);
  const roundId = await startRound(page, "ja");
  const [first] = await completeByApi(page, roundId, RAW_JA);
  await setScoring(first, "failed");

  await page.goto(`/round/${roundId}/feedback`);
  await expect(page.getByTestId("to-fix")).toContainText("結論を最初の一文に置く");
  await expect(page.getByTestId("score-unscored")).toHaveText(Array(7).fill("未採点"));
  await expect(page.locator(NO_SPINNER)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("screen8-ja-unscored.png"), fullPage: true });
});

test("a spent OpenAI project refuses the round at Setup as model_unavailable, and the preflight is not retried", async ({ page }) => {
  await signIn(page);
  const rounds = () => withDb(async (db) => (await db.select({ id: s.rounds.id }).from(s.rounds)).length);
  const before = await rounds();
  const preflights = () => openAi.requests.filter((request) => request.path.startsWith("/v1/models/")).length;
  const probed = preflights();
  projectSpent = true;

  await page.goto("/round/new");
  await page.getByRole("radio", { name: /^General practice/ }).click();
  await page.getByRole("button", { name: "Start this round" }).click();
  await expect(page.getByText("The scoring model is unreachable. A round cannot start until it recovers.")).toBeVisible();
  await expect(page).toHaveURL("/round/new");
  expect(await rounds()).toBe(before);
  // One probe, one refusal: a 429 that is a spent budget is not waited out and tried again.
  expect(preflights() - probed).toBe(1);

  const context = await page.request.post("/api/role-contexts", { data: { kind: "general" } });
  const refused = await page.request.post("/api/rounds", {
    data: { round_type: "behavioural", language: "en", mode: "realistic", length: 3, role_context_id: (await context.json()).id },
  });
  expect(refused.status()).toBe(503);
  expect((await refused.json()).error).toMatchObject({ code: "model_unavailable", detail: { error_class: "project_spend_limit_exceeded" } });
  expect(await rounds()).toBe(before);
});
