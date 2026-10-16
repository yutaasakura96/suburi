import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
  vectorNear,
} from "../ai/fake-round-ports";
import type { Embedder } from "../ai/embed";
import { openAiFollowUpGenerator, type FollowUpGenerator } from "../ai/follow-up";
import { openAiQuestionGenerator, type QuestionGenerator } from "../ai/generate-questions";
import { FOLLOW_UP_MODEL, QUESTION_GENERATION_MODEL } from "../ai/models";
import { startMockResponses, type MockResponses } from "../ai/test/mock-responses";
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

interface Ports {
  readonly questionGenerator?: QuestionGenerator;
  readonly embedder?: Embedder;
  readonly followUpGenerator?: FollowUpGenerator;
}

async function setUp(db: TestDb, ports: Ports = {}) {
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
      questionGenerator: ports.questionGenerator ?? fakeQuestionGenerator(numberedQuestions()),
      embedder: ports.embedder ?? fakeEmbedder(),
    }),
    read: createGetRound(base),
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber: fakeTranscriber(() => ({ text: CORRECTED, durationMs: 60_000 })) }),
    submit: createSubmit({
      ...base,
      scorer,
      followUpGenerator:
        ports.followUpGenerator ?? fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: "その移行で、ご自身が担った部分はどこですか。" })),
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
  async function start(language: "ja" | "en", mode: "practice" | "realistic", roundType = "hr") {
    const context = await call((request) => handlers.roleContext(request), "", { kind: "general" });
    const started = await call((request) => handlers.round(request), "", {
      round_type: roundType,
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

  it("a Japanese practice round's prompts carry the newest English, null with none, and a follow-up's from its row", () =>
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

      // Its follow-up's is its own row's: null here, since the fake wrote none (Q106-4).
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

describe("English written by the call that writes the Japanese (11 §3.25, #125)", () => {
  // The real ports, parsing a mocked `ja-1.1` response from a local server: what is checked is the
  // port's own parse and checks, then the round's writes.
  let mock: MockResponses | null = null;
  afterEach(async () => {
    await mock?.close();
    mock = null;
  });
  const logged = (event: string) =>
    vi
      .mocked(console.error)
      .mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.event === event);
  const retireBehavioural = (db: TestDb) =>
    db
      .update(s.questions)
      .set({ retiredAt: new Date() })
      .where(and(eq(s.questions.language, "ja"), eq(s.questions.roundType, "behavioural")));
  const translationsOf = (db: TestDb, questionIds: readonly string[]) =>
    questionIds.length === 0 ? [] : db.select().from(s.questionTranslations).where(inArray(s.questionTranslations.questionId, [...questionIds]));

  it("the generator keeps a question whose English is missing or malformed, banks the one English, and counts the drops", () =>
    inRolledBackTransaction(async (db) => {
      const kept = { question: "これまでで最も難しかった調整について教えてください。", english: "Please tell us about the hardest coordination you have done." };
      mock = await startMockResponses(() => ({
        questions: [
          kept,
          // No English at all: the lenient parse reads it as missing, never a failed call.
          { question: "チームの方針に反対したときのことを教えてください。" },
          { question: "失敗から学んだことを具体的に教えてください。", english: "失敗から何を学びましたか。" },
        ],
      }));
      const world = await setUp(db, { questionGenerator: openAiQuestionGenerator({ apiKey: "integration-not-a-real-key", baseURL: mock.baseURL }) });
      await retireBehavioural(db);

      const started = await world.start("ja", "practice", "behavioural");
      const roundId: string = started.json.round.id;

      // The call asked for an English on every question.
      const format = (mock.requests[0].text as { format: { name: string; schema: { properties: { questions: { items: { required: string[] } } } } } }).format;
      expect(format.name).toBe("generated_questions");
      expect(format.schema.properties.questions.items.required).toEqual(["question", "english"]);

      // All three are banked and asked; one translation row, for the one valid English.
      const banked = await db
        .select({ id: s.questions.id, body: s.questions.body, tokensIn: s.questions.tokensIn })
        .from(s.questions)
        .where(and(eq(s.questions.userId, world.userId), eq(s.questions.generatorPromptVersion, "generate-behavioural-ja-1.1")));
      expect(banked).toHaveLength(3);
      expect((await world.asked(roundId)).sort()).toEqual(banked.map((row) => row.id).sort());
      const translations = await translationsOf(db, banked.map((row) => row.id));
      expect(translations).toHaveLength(1);
      expect(translations[0]).toMatchObject({
        questionId: banked.find((row) => row.body === kept.question)!.id,
        language: "en",
        body: kept.english,
        source: "generated",
        modelId: QUESTION_GENERATION_MODEL,
        promptVersion: "generate-behavioural-ja-1.1",
        tokensIn: null,
        tokensOut: null,
      });
      // The call's tokens stay on the questions row (04).
      expect(banked.filter((row) => row.tokensIn !== null).map((row) => row.tokensIn)).toEqual([900]);

      // The first prompt carries its English, read back from the row just written.
      expect(started.json.prompt).toMatchObject({ text: kept.question, text_en: kept.english });

      // Counted by class, and never the text (12 §7).
      expect(logged("question_english_dropped")).toEqual([
        { event: "question_english_dropped", round_id: roundId, error_class: "english_missing", count: 1 },
        { event: "question_english_dropped", round_id: roundId, error_class: "english_malformed", count: 1 },
      ]);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("失敗から何を学びましたか");
    }));

  it("a reused candidate's English is discarded with it", () =>
    inRolledBackTransaction(async (db) => {
      const generator = fakeQuestionGenerator(numberedQuestions(1, { english: true }));
      // The first candidate is the existing question in other words; the rest are new.
      const embedder = fakeEmbedder((text) => (text === "Generated fixture question 1?" ? vectorNear(1) : undefined));
      const world = await setUp(db, { questionGenerator: generator, embedder });
      await retireBehavioural(db);
      const [existing] = await db
        .insert(s.questions)
        .values({
          userId: world.userId,
          language: "ja",
          roundType: "behavioural",
          origin: "generated",
          body: "既存の質問について教えてください。",
          embedding: vectorNear(1),
          generatorModelId: "fake-generator-2026-01-01",
          generatorPromptVersion: "generate-behavioural-ja-1.0",
        })
        .returning({ id: s.questions.id });

      const started = await world.start("ja", "practice", "behavioural");
      expect(generator.calls).toBe(1);
      const asked = await world.asked(started.json.round.id);
      expect(asked).toContain(existing.id);

      const inserted = asked.filter((id) => id !== existing.id);
      expect(inserted).toHaveLength(2);
      const translations = await translationsOf(db, asked);
      expect(translations.map((row) => row.questionId).sort()).toEqual([...inserted].sort());
      expect(translations.map((row) => row.body)).not.toContain("The English of fixture question 1?");
      expect(translations.every((row) => row.source === "generated")).toBe(true);
    }));

  it("a Japanese follow-up's English is stored on its row and carried by its prompt, and by its answer-again", () =>
    inRolledBackTransaction(async (db) => {
      const followUp = { follow_up: "その移行で、ご自身が担った部分はどこですか。", english: "Which part of that migration was yours?" };
      mock = await startMockResponses(() => followUp);
      const world = await setUp(db, { followUpGenerator: openAiFollowUpGenerator({ apiKey: "integration-not-a-real-key", baseURL: mock.baseURL }) });
      const started = await world.start("ja", "practice");
      const roundId: string = started.json.round.id;

      const question = await world.answer(roundId);
      expect(question.submitted.json.next).toMatchObject({ kind: "follow_up", text: followUp.follow_up, text_en: followUp.english });
      expect((await world.read(roundId)).json.prompt).toMatchObject({ kind: "follow_up", text_en: followUp.english });
      const [row] = await db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, question.answerId));
      expect(row).toMatchObject({
        status: "generated",
        promptText: followUp.follow_up,
        promptTextTranslated: followUp.english,
        modelId: FOLLOW_UP_MODEL,
        promptVersion: "follow-up-ja-1.1",
      });

      // The page's own read gives the frame the same English.
      const frame = await roundFrame(db, world.userId, await world.roundRow(roundId));
      if (frame === "complete") throw new Error("the round is not complete");
      expect(frame.start).toMatchObject({ next: { kind: "follow_up", textEn: followUp.english } });

      // The follow-up answered, then asked again: the same English, from the same row.
      const answered = await world.answer(roundId);
      expect(answered.submitted.json.next.kind).toBe("question");
      const opened = await world.call(world.handlers.open, roundId, { ...TAKE, retry_of_answer_id: answered.answerId });
      expect(opened.status).toBe(201);
      expect((await world.read(roundId)).json.prompt).toMatchObject({
        kind: "follow_up",
        retry_of_answer_id: answered.answerId,
        text_en: followUp.english,
      });
    }));

  it("a follow-up whose English is malformed is generated, without one — never missing", () =>
    inRolledBackTransaction(async (db) => {
      const followUp = "その移行で、障害率はどのように測りましたか。";
      mock = await startMockResponses(() => ({ follow_up: followUp, english: "その移行で何を測りましたか?" }));
      const world = await setUp(db, { followUpGenerator: openAiFollowUpGenerator({ apiKey: "integration-not-a-real-key", baseURL: mock.baseURL }) });
      const started = await world.start("ja", "practice");
      const roundId: string = started.json.round.id;

      const question = await world.answer(roundId);
      expect(question.submitted.status).toBe(200);
      expect(question.submitted.json.next).toMatchObject({ kind: "follow_up", text: followUp, text_en: null });
      const [row] = await db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, question.answerId));
      expect(row).toMatchObject({ status: "generated", promptText: followUp, promptTextTranslated: null, errorClass: null });
      // One call: a dropped English is no reason to ask again.
      expect(mock.requests).toHaveLength(1);
      expect(logged("follow_up_english_dropped")).toEqual([
        { event: "follow_up_english_dropped", answer_id: question.answerId, error_class: "english_malformed", count: 1 },
      ]);
      expect(logged("follow_up_generation_failed")).toEqual([]);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("その移行で何を測りましたか");
    }));

  it("an English round's follow-up stores no English", () =>
    inRolledBackTransaction(async (db) => {
      mock = await startMockResponses(() => ({ follow_up: "How did you measure the six months?" }));
      const world = await setUp(db, { followUpGenerator: openAiFollowUpGenerator({ apiKey: "integration-not-a-real-key", baseURL: mock.baseURL }) });
      const started = await world.start("en", "practice");
      const question = await world.answer(started.json.round.id);
      const [row] = await db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, question.answerId));
      expect(row).toMatchObject({ status: "generated", promptTextTranslated: null });
      expect(logged("follow_up_english_dropped")).toEqual([]);
    }));
});
