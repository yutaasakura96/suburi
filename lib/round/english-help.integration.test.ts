import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieceEnglish, seedSetPieces, seedSyntheticEnglish, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { roundFrame } from "../../app/(app)/round/load";
import {
  FIXTURE_FOLLOW_UP,
  fakeEmbedder,
  fakeFollowUpGenerator,
  fakeModelHealth,
  fakeQuestionGenerator,
  fakeScorer,
  fakeTranscriber,
  numberedQuestions,
  uniformScores,
} from "../ai/fake-round-ports";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createGetRound } from "./read-round";
import { createPostRoleContext } from "./role-context";
import { createSubmit } from "./submit";
import { createTranscribe } from "./transcribe";

// 11 §3.25 and §3.26, English help (#106) in what a round's routes read: `prompt.text_en` in a
// Japanese practice round, and no such key at all anywhere else (07 §5.4, §5.5, §5.9). Through the
// handlers, against the migrated test database, with a real Better Auth session; only the model ports
// and the bucket are faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const TAKE = { content_type: "audio/webm", expected_bytes: AUDIO.byteLength };
const CORRECTED = "前職では請求処理の移行を担当しました。";

beforeEach(() => {
  for (const level of ["log", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

afterAll(closePool);

function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint english_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint english_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint english_write`);
      throw error;
    }
  };
}

async function setUp(db: TestDb) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  for (const language of ["ja", "en"] as const) await seedSyntheticCv(db, user.id, language);
  await seedRubrics(db);
  await seedSetPieces(db, user.id);
  await seedSyntheticQuestions(db, user.id);

  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const store = fakeAudioStore();
  const scorer = fakeScorer(uniformScores(3));
  const base = { auth, db, transaction: savepointTransaction(db) };
  const handlers = {
    roleContext: createPostRoleContext(base),
    round: createPostRound({
      ...base,
      health: fakeModelHealth(true),
      scorer,
      questionGenerator: fakeQuestionGenerator(numberedQuestions()),
      embedder: fakeEmbedder(),
    }),
    read: createGetRound(base),
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber: fakeTranscriber(() => ({ text: CORRECTED, durationMs: 60_000 })) }),
    submit: createSubmit({
      ...base,
      scorer,
      followUpGenerator: fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: "その移行で、ご自身が担った部分はどこですか。" })),
      sleep: async () => {},
      after: () => {},
      deadline: () => Date.now() + 280_000,
    }),
  };
  const headers = { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` };
  async function call(handler: (request: Request, id: string) => Promise<Response>, id: string, body: unknown) {
    const response = await handler(new Request("http://localhost:3000/api/x", { method: "POST", headers, body: JSON.stringify(body) }), id);
    return { status: response.status, json: await response.json() };
  }
  async function read(roundId: string) {
    const response = await handlers.read(new Request("http://localhost:3000/api/x", { headers }), roundId);
    return { status: response.status, json: await response.json() };
  }
  async function start(language: "ja" | "en", mode: "practice" | "realistic") {
    const context = await call((request) => handlers.roleContext(request), "", { kind: "general" });
    const started = await call((request) => handlers.round(request), "", {
      round_type: "hr",
      language,
      mode,
      length: 3,
      role_context_id: context.json.id,
    });
    expect(started.status).toBe(201);
    return started;
  }
  async function answer(roundId: string, body: object = {}) {
    const opened = await call(handlers.open, roundId, { ...TAKE, ...body });
    expect(opened.status).toBe(201);
    await db.execute(sql`update answers set created_at = clock_timestamp() where id = ${opened.json.answer_id}`);
    store.put(store.presigned.at(-1)!.key, AUDIO);
    await call(handlers.transcribe, opened.json.answer_id, {});
    const submitted = await call(handlers.submit, opened.json.answer_id, { transcript_corrected: CORRECTED });
    return { answerId: opened.json.answer_id as string, submitted };
  }
  const asked = async (roundId: string) =>
    (
      await db
        .select({ id: s.roundQuestions.questionId })
        .from(s.roundQuestions)
        .where(eq(s.roundQuestions.roundId, roundId))
        .orderBy(asc(s.roundQuestions.position))
    ).map((row) => row.id);
  const roundRow = async (roundId: string) => (await db.select().from(s.rounds).where(eq(s.rounds.id, roundId)))[0];
  const setting = (englishHelp: boolean) => db.insert(s.userSettings).values({ userId: user.id, englishHelp });

  return { userId: user.id, call, read, start, answer, asked, roundRow, setting, handlers };
}

/** A translated English for a question, dated `at` milliseconds from now. */
function english(db: TestDb, userId: string, questionId: string, body: string, at = 0) {
  return db.insert(s.questionTranslations).values({
    questionId,
    userId,
    language: "en",
    body,
    source: "translated",
    modelId: "fake-translate-2026-01-01",
    promptVersion: "translate-question-en-fake",
    createdAt: new Date(Date.now() + at),
  });
}

// Every key of a JSON value, at any depth.
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("English help in a round's reads (11 §3.25)", () => {
  // **May not be deleted to make a refactor pass** (11 §3.25): Q106-2 is the measurement's. No
  // English reaches a realistic round before its feedback, asserted as an absence — with an English
  // stored for every question, and the setting on (§3.26: a starting state, never a gate).
  it("a Japanese realistic round's POST, read and submit `next` carry no text_en key at all", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.setting(true);
      await seedSetPieceEnglish(db, world.userId);
      await seedSyntheticEnglish(db, world.userId);
      const japanese = await db.select({ id: s.questions.id }).from(s.questions).where(eq(s.questions.language, "ja"));
      for (const question of japanese) await english(db, world.userId, question.id, "Stored English.");

      const started = await world.start("ja", "realistic");
      const roundId: string = started.json.round.id;
      expect(started.json.prompt.text).toBeTruthy();
      expect(keysOf(started.json)).not.toContain("text_en");
      expect(keysOf((await world.read(roundId)).json)).not.toContain("text_en");

      // The bank question, its follow-up, then the next question.
      const question = await world.answer(roundId);
      expect(question.submitted.json.next.kind).toBe("follow_up");
      expect(keysOf(question.submitted.json)).not.toContain("text_en");
      expect(keysOf((await world.read(roundId)).json)).not.toContain("text_en");
      const followUp = await world.answer(roundId);
      expect(followUp.submitted.json.next.kind).toBe("question");
      expect(keysOf(followUp.submitted.json)).not.toContain("text_en");
      expect(keysOf((await world.read(roundId)).json)).not.toContain("text_en");

      // The page's own read: no pill, and no English in what its frames are given.
      const frame = await roundFrame(db, world.userId, await world.roundRow(roundId));
      if (frame === "complete") throw new Error("the round is not complete");
      expect(frame.englishHelp).toBeNull();
      expect(keysOf(frame)).not.toContain("textEn");
      expect(JSON.stringify(frame)).not.toContain("Stored English.");
    }));

  it("a Japanese practice round's prompts carry the newest English, null with none, and a follow-up's null", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const started = await world.start("ja", "practice");
      const roundId: string = started.json.round.id;
      const [first] = await world.asked(roundId);
      // None is stored yet: the key is there, and null.
      expect(started.json.prompt).toMatchObject({ question_id: first, text_en: null });

      // Two rows for one question: the later is its English (04 §5).
      await english(db, world.userId, first, "The older English.", -60_000);
      await english(db, world.userId, first, "The newer English.");
      expect((await world.read(roundId)).json.prompt).toMatchObject({ question_id: first, text_en: "The newer English." });

      // Its follow-up's English stays null until follow-ups are written with one (#125).
      const question = await world.answer(roundId);
      expect(question.submitted.json.next).toMatchObject({ kind: "follow_up", text_en: null });
      expect((await world.read(roundId)).json.prompt).toMatchObject({ kind: "follow_up", text_en: null });

      // An answer-again is asked with its question's English.
      const opened = await world.call(world.handlers.open, roundId, { ...TAKE, retry_of_answer_id: question.answerId });
      expect(opened.status).toBe(201);
      expect((await world.read(roundId)).json.prompt).toMatchObject({
        retry_of_answer_id: question.answerId,
        question_id: first,
        text_en: "The newer English.",
      });
    }));

  it("a Japanese practice round's next question carries its English, and the page's frame starts from the setting", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const started = await world.start("ja", "practice");
      const roundId: string = started.json.round.id;
      const [, second] = await world.asked(roundId);
      await english(db, world.userId, second, "The second question's English.");

      await world.answer(roundId);
      const followUp = await world.answer(roundId);
      expect(followUp.submitted.json.next).toMatchObject({ kind: "question", position: 2, text_en: "The second question's English." });

      // No user_settings row is every default: the pill starts off.
      const off = await roundFrame(db, world.userId, await world.roundRow(roundId));
      if (off === "complete") throw new Error("the round is not complete");
      expect(off.englishHelp).toBe(false);
      expect(off.start).toMatchObject({ kind: "answered", next: { kind: "question", textEn: "The second question's English." } });

      await world.setting(true);
      const on = await roundFrame(db, world.userId, await world.roundRow(roundId));
      if (on === "complete") throw new Error("the round is not complete");
      expect(on.englishHelp).toBe(true);
    }));

  it("an English round's prompts have no text_en key, in either mode", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      await world.setting(true);
      for (const mode of ["practice", "realistic"] as const) {
        const started = await world.start("en", mode);
        expect(keysOf(started.json)).not.toContain("text_en");
        expect(keysOf((await world.read(started.json.round.id)).json)).not.toContain("text_en");
      }
    }));
});
