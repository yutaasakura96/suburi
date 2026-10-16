import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import type { EnglishReadingResult } from "../ai/english-reading";
import {
  FIXTURE_FOLLOW_UP,
  fakeEmbedder,
  fakeEnglishReader,
  fakeFollowUpGenerator,
  fakeModelHealth,
  fakeQuestionGenerator,
  fakeScorer,
  fakeTranscriber,
  numberedQuestions,
  uniformScores,
} from "../ai/fake-round-ports";
import type { CallOptions } from "../ai/score";
import { ModelCallFailed } from "../ai/upstream";
import { RATE_LIMITS } from "../api/rate-limit";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { ENGLISH_READING_TIMEOUT_MS, createEnglishReading } from "./english-reading";
import { MAX_ENGLISH_READING_SOURCE_CODE_POINTS } from "./english-reading-limits";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";
import { createSubmit } from "./submit";
import { createTranscribe } from "./transcribe";

// 11 §3.25, the English reading (#106, #126): `POST /api/answers/{answerId}/english-reading` (07
// §5.20). Through the handlers, against the migrated test database, with a real Better Auth session;
// only the model ports and the bucket are faked (11 §2). Nothing the route is sent or returns is
// stored or logged (04 §6, item 16; 12 §7), and every refusal comes before the model.

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
const HEARD = "前職では、えー、請求処理の移行を担当しました。";
/** What the editor sends: the user's own words, with a sentinel no other row or line may hold. */
const SENT_SENTINEL = "ZEBRA-SENTINEL-6126";
const SENT = `前職では請求処理の移行を担当しました。${SENT_SENTINEL}`;
const RETURNED_SENTINEL = "HERON-SENTINEL-6126";
const READING: EnglishReadingResult = {
  english: `At my previous job, I was in charge of migrating invoice processing. ${RETURNED_SENTINEL}`,
  tokensIn: 50_000,
  tokensOut: 1_200,
};

let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

afterAll(closePool);

function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint english_reading_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint english_reading_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint english_reading_write`);
      throw error;
    }
  };
}

async function setUp(db: TestDb, respond: (text: string, options: CallOptions) => EnglishReadingResult | Promise<EnglishReadingResult> = () => READING) {
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
  const reader = fakeEnglishReader(respond);
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
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber: fakeTranscriber(() => ({ text: HEARD, durationMs: 60_000 })) }),
    submit: createSubmit({
      ...base,
      scorer,
      followUpGenerator: fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: "その移行で、ご自身が担った部分はどこですか。" })),
      sleep: async () => {},
      after: () => {},
      deadline: () => Date.now() + 280_000,
    }),
    reading: createEnglishReading({ ...base, englishReader: reader }),
  };
  const headers = { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` };
  async function call(handler: (request: Request, id: string) => Promise<Response>, id: string, body: unknown) {
    const response = await handler(new Request("http://localhost:3000/api/x", { method: "POST", headers, body: JSON.stringify(body) }), id);
    const text = await response.text();
    return { status: response.status, json: JSON.parse(text), text };
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
    return started.json.round.id as string;
  }
  /** The round's first answer, opened and — unless told not to — transcribed, never submitted. */
  async function open(roundId: string, { transcribe = true } = {}) {
    const opened = await call(handlers.open, roundId, TAKE);
    expect(opened.status).toBe(201);
    store.put(store.presigned.at(-1)!.key, AUDIO);
    if (transcribe) expect((await call(handlers.transcribe, opened.json.answer_id, {})).status).toBe(200);
    return opened.json.answer_id as string;
  }
  const read = (answerId: string, text: unknown = SENT) => call(handlers.reading, answerId, { text });
  const readings = () => db.select().from(s.englishReadings);
  const answerRow = async (answerId: string) => (await db.select().from(s.answers).where(eq(s.answers.id, answerId)))[0];

  return { userId: user.id, reader, handlers, call, start, open, read, readings, answerRow };
}

/** Every public table whose rows, as text, contain `needle` — any column, any table. */
async function tablesHolding(db: TestDb, needle: string) {
  const { rows } = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'`);
  const holding: string[] = [];
  for (const { table_name: table } of rows) {
    const found = await db.execute<{ found: boolean }>(
      sql`select exists (select 1 from ${sql.identifier(table)} t where t::text like ${`%${needle}%`}) as found`,
    );
    if (found.rows[0].found) holding.push(table);
  }
  return holding;
}

describe("the English reading stores no text (11 §3.25)", () => {
  it("returns the English and writes one row of counts — no table holds what was sent or returned", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "practice"));
      const before = await world.answerRow(answerId);

      const response = await world.read(answerId);

      expect(response.status).toBe(200);
      expect(response.json).toEqual({ answer_id: answerId, english: READING.english });
      expect(world.reader.texts).toEqual([SENT]);
      expect(world.reader.options[0].timeoutMs).toBe(ENGLISH_READING_TIMEOUT_MS);
      expect(await world.readings()).toEqual([
        expect.objectContaining({
          answerId,
          userId: world.userId,
          status: "ok",
          sourceCodePoints: Array.from(SENT).length,
          modelId: "fake-english-reading-2026-01-01",
          promptVersion: "english-reading-fake",
          tokensIn: 50_000,
          tokensOut: 1_200,
          errorClass: null,
        }),
      ]);
      // It changes nothing else: not the answer, not its transcripts, not the rewrite meter.
      expect(await world.answerRow(answerId)).toEqual(before);
      expect(await tablesHolding(db, SENT_SENTINEL)).toEqual([]);
      expect(await tablesHolding(db, RETURNED_SENTINEL)).toEqual([]);
      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(SENT_SENTINEL);
        expect(line).not.toContain(RETURNED_SENTINEL);
      }
    }));

  it("is 502 english_reading_failed on a failed call, once, with a failed row and no text", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db, () => {
        throw new ModelCallFailed("English reading", "upstream_503");
      });
      const answerId = await world.open(await world.start("ja", "practice"));
      const before = await world.answerRow(answerId);

      const response = await world.read(answerId);

      expect(response.status).toBe(502);
      expect(response.json.error.code).toBe("english_reading_failed");
      expect(response.json.error.detail).toEqual({ answer_id: answerId, error_class: "upstream_503" });
      // No retry: the user asks again.
      expect(world.reader.calls).toBe(1);
      expect(await world.readings()).toEqual([
        expect.objectContaining({ status: "failed", errorClass: "upstream_503", tokensIn: null, tokensOut: null, sourceCodePoints: Array.from(SENT).length }),
      ]);
      expect(await world.answerRow(answerId)).toEqual(before);
      expect(await tablesHolding(db, SENT_SENTINEL)).toEqual([]);
      expect(response.text).not.toContain(SENT_SENTINEL);
      for (const line of logged) expect(line).not.toContain(SENT_SENTINEL);

      // Asking again is allowed, and is a call of its own.
      await world.read(answerId);
      expect(world.reader.calls).toBe(2);
      expect(await world.readings()).toHaveLength(2);
    }));

  it("is bounded: a call that outlives its budget fails as upstream_timeout, and the row says so", () =>
    inRolledBackTransaction(async (db) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const world = await setUp(
          db,
          (_, { signal }) =>
            new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new ModelCallFailed("English reading", "aborted")))),
        );
        const answerId = await world.open(await world.start("ja", "practice"));
        const pending = world.read(answerId);
        await vi.waitFor(() => expect(world.reader.calls).toBe(1));
        await vi.advanceTimersByTimeAsync(ENGLISH_READING_TIMEOUT_MS);
        const response = await pending;

        expect(response.status).toBe(502);
        expect(response.json.error.detail.error_class).toBe("upstream_timeout");
        expect(await world.readings()).toEqual([expect.objectContaining({ status: "failed", errorClass: "upstream_timeout" })]);
      } finally {
        vi.useRealTimers();
      }
    }));
});

describe("the English reading's refusals, each before the model (07 §5.20)", () => {
  // **May not be deleted to make a refactor pass** (11 §3.25): Q106-2 is the measurement's. No English
  // reaches a realistic round before its feedback, so its correction screen cannot be read in English.
  it("refuses a Japanese realistic round's answer 422 english_reading_not_applicable", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "realistic"));

      const response = await world.read(answerId);

      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("english_reading_not_applicable");
      expect(response.json.error.detail).toMatchObject({ answer_id: answerId, mode: "realistic", language: "ja" });
      expect(world.reader.calls).toBe(0);
      expect(await world.readings()).toEqual([]);
    }));

  it("refuses an English round's answer 422 english_reading_not_applicable", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("en", "practice"));

      const response = await world.read(answerId, "At my last job I led the migration.");

      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("english_reading_not_applicable");
      expect(world.reader.calls).toBe(0);
      expect(await world.readings()).toEqual([]);
    }));

  it("refuses an answer with no transcript yet, naming it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "practice"), { transcribe: false });

      const response = await world.read(answerId);

      expect(response.status).toBe(400);
      expect(response.json.error).toMatchObject({ code: "invalid_request", detail: { fields: ["transcript_raw"] } });
      expect(world.reader.calls).toBe(0);
    }));

  it("refuses a submitted answer 422 answer_already_submitted", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "practice"));
      expect((await world.call(world.handlers.submit, answerId, { transcript_corrected: HEARD })).status).toBe(200);

      const response = await world.read(answerId);

      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe("answer_already_submitted");
      expect(world.reader.calls).toBe(0);
    }));

  it("refuses a complete round's answer 409 round_already_complete", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.start("ja", "practice");
      const answerId = await world.open(roundId);
      await db.update(s.rounds).set({ completedAt: new Date() }).where(eq(s.rounds.id, roundId));

      const response = await world.read(answerId);

      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("round_already_complete");
      expect(world.reader.calls).toBe(0);
    }));

  it("refuses an abandoned round's answer 409 round_abandoned", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.start("ja", "practice");
      const answerId = await world.open(roundId);
      await db.execute(sql`update rounds set started_at = now() - interval '1 minute' where id = ${roundId}`);
      await world.start("ja", "practice");

      const response = await world.read(answerId);

      expect(response.status).toBe(409);
      expect(response.json.error.code).toBe("round_abandoned");
      expect(world.reader.calls).toBe(0);
    }));

  it("is a 404 for another user's answer, and for an id that is not a uuid", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.start("ja", "practice");
      const answerId = await world.open(roundId);
      await seedUser(db, "someone-else@example.test");
      const [other] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "someone-else@example.test"));
      await db.update(s.rounds).set({ userId: other.id }).where(eq(s.rounds.id, roundId));
      await db.update(s.answers).set({ userId: other.id }).where(eq(s.answers.id, answerId));

      expect((await world.read(answerId)).status).toBe(404);
      expect((await world.read("not-a-uuid")).status).toBe(404);
      expect(world.reader.calls).toBe(0);
    }));

  it("refuses text over 8,000 code points, or blank, with a 400 — and takes exactly 8,000", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "practice"));

      // Code points, not UTF-16 units: 8,000 of a character outside the BMP is 16,000 units, and fits.
      const longest = "𠮷".repeat(MAX_ENGLISH_READING_SOURCE_CODE_POINTS);
      for (const text of [`${longest}あ`, "  \n ", ""]) {
        const response = await world.read(answerId, text);
        expect(response.status).toBe(400);
        expect(response.json.error.detail.fields).toEqual(["text"]);
        expect(response.text).not.toContain("𠮷");
      }
      expect((await world.call(world.handlers.reading, answerId, {})).status).toBe(400);
      expect(world.reader.calls).toBe(0);

      expect((await world.read(answerId, longest)).status).toBe(200);
      expect(await world.readings()).toEqual([expect.objectContaining({ sourceCodePoints: MAX_ENGLISH_READING_SOURCE_CODE_POINTS })]);
    }));

  it("counts every request in its own bucket, refused ones included, before the body is read", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const answerId = await world.open(await world.start("ja", "practice"));
      const { limit } = RATE_LIMITS["english-reading"];
      expect(limit).toBe(30);

      for (let request = 0; request < limit; request += 1) expect((await world.read(answerId, "")).status).toBe(400);
      const response = await world.read(answerId);

      expect(response.status).toBe(429);
      expect(world.reader.calls).toBe(0);
      const windows = await db.select().from(s.rateLimitWindows).where(eq(s.rateLimitWindows.route, "english-reading"));
      expect(windows).toEqual([expect.objectContaining({ count: limit + 1 })]);
    }));
});
