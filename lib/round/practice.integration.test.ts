import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { feedbackScreen, roundFrame } from "../../app/(app)/round/load";
import {
  FIXTURE_FEEDBACK,
  FIXTURE_FOLLOW_UP,
  fakeEmbedder,
  fakeFeedbackGenerator,
  fakeFollowUpGenerator,
  fakeModelHealth,
  fakeQuestionGenerator,
  fakeScorer,
  fakeTranscriber,
  numberedQuestions,
  uniformScores,
} from "../ai/fake-round-ports";
import { ModelCallFailed } from "../ai/upstream";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createComplete } from "./complete";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createGetRound } from "./read-round";
import { createPostRoleContext } from "./role-context";
import { createSubmit } from "./submit";
import { createTranscribe } from "./transcribe";

// Practice mode through its handlers (#49, 11 §3.20): the round's read, the re-take, answer again,
// and a round that completes with no rating — against the migrated test database, with a real Better
// Auth session. Only the model ports and the bucket are faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Recognisable text that must never reach a log line (11 §3.10): heard, corrected and asked.
const SENTINEL = "ZEBRA-SENTINEL-4471";
const FOLLOW_UP_SENTINEL = "OKAPI-SENTINEL-2093";
const FOLLOW_UP_TEXT = `How did you measure the ${FOLLOW_UP_SENTINEL} six months?`;
const CORRECTED = `I led the migration at ${SENTINEL} and I cut cloud costs by 30 percent.`;
const UNSUPPORTED = "I cut cloud costs by 30 percent";
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const TAKE = { content_type: "audio/webm", expected_bytes: AUDIO.byteLength };

let logged: string[];

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

// The handler's transaction, as a savepoint inside the test's rolled-back transaction.
function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint practice_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint practice_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint practice_write`);
      throw error;
    }
  };
}

async function setUp(db: TestDb) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedSyntheticCv(db, user.id, "en");
  await seedRubrics(db);
  await seedSetPieces(db, user.id);
  await seedSyntheticQuestions(db, user.id);

  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const scheduled: (() => Promise<unknown>)[] = [];
  const store = fakeAudioStore();
  // One unsupported span and a detected language, so the read has a flag and a language to carry.
  const scorer = fakeScorer(uniformScores(3, { unsupported: [{ quote: UNSUPPORTED, startHint: 0 }] }));
  const transcriber = fakeTranscriber(() => ({ text: `I led the migration at ${SENTINEL}, um.`, durationMs: 90_000 }));
  const generator = fakeFeedbackGenerator(() => FIXTURE_FEEDBACK);
  const followUps = fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: FOLLOW_UP_TEXT }));
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
    transcribe: createTranscribe({ ...base, store, transcriber }),
    submit: createSubmit({
      ...base,
      scorer,
      followUpGenerator: followUps,
      sleep: async () => {},
      after: (work) => void scheduled.push(work),
      deadline: () => Date.now() + 280_000,
    }),
    complete: createComplete({ ...base, generator, waitBoundMs: 50, sleep: async () => {} }),
  };

  const headers = (signedIn: boolean) => ({
    "content-type": "application/json",
    ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}),
  });
  async function call(handler: (request: Request, id: string) => Promise<Response>, id: string, body: unknown) {
    const response = await handler(
      new Request("http://localhost:3000/api/x", { method: "POST", headers: headers(true), body: JSON.stringify(body) }),
      id,
    );
    return { status: response.status, json: await response.json() };
  }
  async function read(roundId: string, { signedIn = true } = {}) {
    const response = await handlers.read(new Request("http://localhost:3000/api/x", { headers: headers(signedIn) }), roundId);
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, json: JSON.parse(text) };
  }

  /** Runs everything `submit` scheduled in `after()`, as Vercel's waitUntil would. */
  async function drainAfter() {
    while (scheduled.length > 0) await scheduled.shift()!();
  }

  async function startRound(overrides: object = {}) {
    const context = await call((request) => handlers.roleContext(request), "", { kind: "general" });
    const started = await call((request) => handlers.round(request), "", {
      round_type: "hr",
      language: "en",
      mode: "practice",
      length: 3,
      role_context_id: context.json.id,
      ...overrides,
    });
    return started.json.round.id as string;
  }

  /**
   * Opens a slot and uploads a take to it. Every row of a test shares one `now()` — the test is one
   * transaction — so the row is dated by the wall clock here, as separate requests would date it.
   */
  async function record(roundId: string, body: object = {}) {
    const opened = await call(handlers.open, roundId, { ...TAKE, ...body });
    if (opened.status === 201) {
      await db.execute(sql`update answers set created_at = clock_timestamp() where id = ${opened.json.answer_id}`);
    }
    if (opened.status < 300) store.put(store.presigned.at(-1)!.key, AUDIO);
    return opened;
  }

  /** Record → transcribe → submit, for the round's current prompt or, with `again`, beside an answer. */
  async function answer(roundId: string, { again, corrected = CORRECTED }: { again?: string; corrected?: string } = {}) {
    const opened = await record(roundId, again ? { retry_of_answer_id: again } : {});
    await call(handlers.transcribe, opened.json.answer_id, {});
    const submitted = await call(handlers.submit, opened.json.answer_id, { transcript_corrected: corrected });
    return { answerId: opened.json.answer_id as string, opened, submitted };
  }

  /** A whole position: the bank question, then its follow-up. */
  async function answerPosition(roundId: string) {
    const question = await answer(roundId);
    const followUp = question.submitted.json.next?.kind === "follow_up" ? await answer(roundId) : null;
    return { ...question, followUp };
  }

  const rowOf = async (answerId: string) => (await db.select().from(s.answers).where(eq(s.answers.id, answerId)))[0];
  const roundOf = async (roundId: string) => (await db.select().from(s.rounds).where(eq(s.rounds.id, roundId)))[0];
  const asked = (roundId: string) =>
    db
      .select({ id: s.questions.id, origin: s.questions.origin })
      .from(s.roundQuestions)
      .innerJoin(s.questions, eq(s.questions.id, s.roundQuestions.questionId))
      .where(eq(s.roundQuestions.roundId, roundId))
      .orderBy(asc(s.roundQuestions.position));

  return {
    userId: user.id,
    store,
    scorer,
    transcriber,
    generator,
    followUps,
    handlers,
    call,
    read,
    drainAfter,
    startRound,
    record,
    answer,
    answerPosition,
    rowOf,
    roundOf,
    asked,
  };
}

const count = async (db: TestDb, table: typeof s.answers | typeof s.followUps | typeof s.roundFeedback | typeof s.scoringAttempts) =>
  (await db.select({ id: table.id }).from(table)).length;

// Every key of a JSON value, at any depth: what a composite would have to be spelled as (11 §3.3).
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

describe("GET /api/rounds/{id} (07 §5.5)", () => {
  it("is 401 with no session, and 404 for no round, a malformed id and another user's round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();

      const signedOut = await world.read(roundId, { signedIn: false });
      expect(signedOut.status).toBe(401);
      expect(signedOut.json.error.code).toBe("unauthenticated");
      expect((await world.read(crypto.randomUUID())).status).toBe(404);
      expect((await world.read("not-a-uuid")).status).toBe(404);

      const other = crypto.randomUUID();
      await db.insert(s.users).values({ id: other, name: "other", email: `${other}@example.test` });
      await db.update(s.rounds).set({ userId: other }).where(eq(s.rounds.id, roundId));
      const theirs = await world.read(roundId);
      expect(theirs.status).toBe(404);
      expect(theirs.json.error.code).toBe("not_found");
    }));

  it("says where a new round is: its first question, and the slot still to open", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const [first] = await world.asked(roundId);

      const { status, headers, json } = await world.read(roundId);

      expect(status).toBe(200);
      expect(headers.get("cache-control")).toBe("no-store");
      expect(json.round).toMatchObject({
        id: roundId,
        round_type: "hr",
        language: "en",
        mode: "practice",
        length: 3,
        per_answer_cap_seconds: 900,
        completed_at: null,
        status: "in_progress",
      });
      expect(json.answers).toEqual([]);
      expect(json.prompt).toMatchObject({ kind: "question", position: 1, question_id: first.id, speak: false });
      expect(json.resume).toEqual({ at: "answers", answer_id: null });
    }));

  it("names the next call for each state of the open answer, then the follow-up, then complete", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();

      const opened = await world.record(roundId);
      const answerId = opened.json.answer_id;
      let { json } = await world.read(roundId);
      // The key is assigned when the slot opens, so an open slot already reads `uploaded`.
      expect(json.answers).toEqual([{ id: answerId, position: 1, kind: "question", state: "uploaded", retry_of_answer_id: null }]);
      expect(json.resume).toEqual({ at: "transcribe", answer_id: answerId });

      await world.call(world.handlers.transcribe, answerId, {});
      ({ json } = await world.read(roundId));
      expect(json.answers[0].state).toBe("transcribed");
      expect(json.resume).toEqual({ at: "submit", answer_id: answerId });
      expect(json.prompt).toMatchObject({ kind: "question", position: 1 });

      const submitted = await world.call(world.handlers.submit, answerId, { transcript_corrected: CORRECTED });
      ({ json } = await world.read(roundId));
      expect(json.answers[0]).toMatchObject({ state: "submitted", scoring: { status: "pending" } });
      expect(json.prompt).toEqual(submitted.json.next);
      expect(json.prompt).toMatchObject({ kind: "follow_up", position: 1, parent_answer_id: answerId, text: FOLLOW_UP_TEXT });
      expect(json.resume).toEqual({ at: "answers", answer_id: null });

      await world.answer(roundId);
      ({ json } = await world.read(roundId));
      expect(json.answers.map((answer: { kind: string }) => answer.kind)).toEqual(["question", "follow_up"]);
      expect(json.prompt).toMatchObject({ kind: "question", position: 2 });
      // Reading generated nothing: the follow-up was written once, by submit.
      expect(world.followUps.calls).toBe(1);

      for (let position = 2; position <= 3; position += 1) await world.answerPosition(roundId);
      ({ json } = await world.read(roundId));
      expect(json.answers.map((answer: { position: number }) => answer.position)).toEqual([1, 1, 2, 2, 3, 3]);
      expect(json.prompt).toBeNull();
      expect(json.resume).toEqual({ at: "complete", answer_id: null });
    }));

  it("resumes at submit when the answer is submitted and its follow-up is not stored yet", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const { answerId } = await world.answer(roundId);
      await db.delete(s.followUps).where(eq(s.followUps.parentAnswerId, answerId));

      const { json } = await world.read(roundId);

      expect(json.prompt).toBeNull();
      expect(json.resume).toEqual({ at: "submit", answer_id: answerId });
      expect(world.followUps.calls).toBe(1);
    }));

  it("carries a practice answer's scores, flags and answered language once it is scored", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const { answerId } = await world.answer(roundId);

      const pending = (await world.read(roundId)).json.answers[0].scoring;
      expect(pending).toEqual({ attempt_id: expect.any(String), status: "pending" });

      await world.drainAfter();
      const { json } = await world.read(roundId);
      const [{ dimensions }] = await db.select({ dimensions: s.rubricVersions.dimensions }).from(s.rubricVersions);
      const start = CORRECTED.indexOf(UNSUPPORTED);

      expect(json.answers[0]).toEqual({
        id: answerId,
        position: 1,
        kind: "question",
        state: "submitted",
        retry_of_answer_id: null,
        scoring: {
          attempt_id: pending.attempt_id,
          status: "ok",
          // An array in the rubric's own order, never an object (07 §4).
          scores: (dimensions as { key: string }[]).map((dimension) => ({ dimension: dimension.key, value: 3 })),
          flags: [{ kind: "unsupported", span_start: start, span_end: start + UNSUPPORTED.length }],
          answered_language: "en",
        },
      });
    }));

  it("carries a failed attempt as its status alone", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      world.scorer.score = async () => {
        throw new ModelCallFailed("Scoring", "upstream_500");
      };
      await world.answer(roundId);
      await world.drainAfter();

      const { json } = await world.read(roundId);

      expect(json.answers[0].scoring).toEqual({ attempt_id: expect.any(String), status: "failed" });
    }));

  // 11 §3.15, US-8: the silence is the response's shape, not something the client is asked to keep.
  it("carries no score, flag or language for a realistic round until it is complete", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound({ mode: "realistic" });
      for (let position = 1; position <= 3; position += 1) await world.answerPosition(roundId);
      await world.drainAfter();

      const during = await world.read(roundId);
      expect(during.json.resume).toEqual({ at: "complete", answer_id: null });
      expect(during.json.answers).toHaveLength(6);
      for (const answer of during.json.answers) {
        expect(answer.scoring).toEqual({ attempt_id: expect.any(String), status: "ok" });
      }
      expect(keysOf(during.json)).not.toEqual(expect.arrayContaining(["scores"]));
      expect(keysOf(during.json)).not.toEqual(expect.arrayContaining(["flags"]));
      expect(keysOf(during.json)).not.toEqual(expect.arrayContaining(["answered_language"]));

      expect((await world.call(world.handlers.complete, roundId, { felt_pressure: 3 })).status).toBe(201);
      const after = await world.read(roundId);
      expect(after.json.round.status).toBe("complete");
      expect(after.json.resume).toBeNull();
      expect(after.json.prompt).toBeNull();
      for (const answer of after.json.answers) {
        expect(answer.scoring.scores).toHaveLength(6);
        expect(answer.scoring.flags).toHaveLength(1);
      }
    }));

  it("is read-only for an abandoned round: no prompt and no resume", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      await world.answer(roundId);
      await db.execute(sql`update rounds set started_at = now() - interval '1 minute' where id = ${roundId}`);
      await world.startRound();

      const { json } = await world.read(roundId);

      expect(json.round.status).toBe("abandoned");
      expect(json.prompt).toBeNull();
      expect(json.resume).toBeNull();
      expect(json.answers).toHaveLength(1);
    }));

  it("has no composite anywhere, and puts no answer or prompt text in a log line", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      await world.answerPosition(roundId);
      await world.drainAfter();

      const { json, text } = await world.read(roundId);

      expect(keysOf(json).filter((key) => /overall|average|total|composite|^mean$|^sum$/i.test(key))).toEqual([]);
      // The corrected answer never leaves in the read: flags are spans into it, not quotes from it.
      expect(text).not.toContain(SENTINEL);
      for (const line of logged) {
        expect(line).not.toContain(SENTINEL);
        expect(line).not.toContain(FOLLOW_UP_SENTINEL);
      }
    }));
});

describe("practice's re-take (07 §5.6)", () => {
  it("lands on the same row and the same object key until the take is transcribed, then is refused", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();

      const first = await world.record(roundId);
      const second = await world.record(roundId);
      const third = await world.record(roundId);

      expect([first.status, second.status, third.status]).toEqual([201, 200, 200]);
      expect(second.json.answer_id).toBe(first.json.answer_id);
      expect(third.json.answer_id).toBe(first.json.answer_id);
      const key = `dev/${world.userId}/${roundId}/${first.json.answer_id}.webm`;
      expect(world.store.presigned.map((entry) => entry.key)).toEqual([key, key, key]);
      expect(await count(db, s.answers)).toBe(1);

      await world.call(world.handlers.transcribe, first.json.answer_id, {});
      const late = await world.call(world.handlers.open, roundId, TAKE);
      expect(late.status).toBe(422);
      expect(late.json.error.code).toBe("transcript_already_final");
      expect(late.json.error.detail).toEqual({ answer_id: first.json.answer_id });
      expect(world.store.presigned).toHaveLength(3);
      expect(world.transcriber.calls).toBe(1);
    }));
});

describe("practice's answer again (07 §5.6)", () => {
  it("opens a new row beside the first: the same prompt and position, never a first attempt, and no follow-up", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);
      const before = await world.rowOf(first.answerId);

      const again = await world.answer(roundId, { again: first.answerId, corrected: "I led it, said better." });

      expect(again.opened.status).toBe(201);
      expect(again.opened.json).toMatchObject({
        position: 1,
        kind: "question",
        question_id: before.questionId,
        parent_answer_id: null,
        retry_of_answer_id: first.answerId,
        is_first_attempt: false,
      });
      expect(again.answerId).not.toBe(first.answerId);
      expect(await world.rowOf(again.answerId)).toMatchObject({
        position: 1,
        questionId: before.questionId,
        promptText: before.promptText,
        retryOfAnswerId: first.answerId,
        isFirstAttempt: false,
        audioS3Key: `dev/${world.userId}/${roundId}/${again.answerId}.webm`,
        transcriptCorrected: "I led it, said better.",
      });
      // The first answer is untouched, and the round is where it was: at the first answer's follow-up.
      expect(await world.rowOf(first.answerId)).toEqual(before);
      expect(again.submitted.status).toBe(200);
      expect(again.submitted.json.next).toEqual(first.submitted.json.next);
      expect(world.followUps.calls).toBe(1);
      expect(await count(db, s.followUps)).toBe(1);
      // It is scored on its own, with its own attempt.
      expect(await count(db, s.scoringAttempts)).toBe(2);
    }));

  it("answers a follow-up again beside the follow-up's answer", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const { answerId, followUp } = await world.answerPosition(roundId);

      const again = await world.answer(roundId, { again: followUp!.answerId });

      expect(again.opened.json).toMatchObject({
        position: 1,
        kind: "follow_up",
        question_id: null,
        parent_answer_id: answerId,
        retry_of_answer_id: followUp!.answerId,
      });
      expect((await world.rowOf(again.answerId)).promptText).toBe(FOLLOW_UP_TEXT);
      expect(again.submitted.json.next).toMatchObject({ kind: "question", position: 2 });
      expect(world.followUps.calls).toBe(1);
    }));

  it("points every further retry at the original, never at a retry", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);
      const second = await world.answer(roundId, { again: first.answerId });

      const third = await world.answer(roundId, { again: second.answerId });

      expect(third.opened.json.retry_of_answer_id).toBe(first.answerId);
      expect((await world.rowOf(third.answerId)).retryOfAnswerId).toBe(first.answerId);
      expect(await count(db, s.answers)).toBe(3);
    }));

  it("keeps one open retry per answer: a repeat is its re-take, on the same row and key", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);

      const opened = await world.record(roundId, { retry_of_answer_id: first.answerId });
      const repeated = await world.record(roundId, { retry_of_answer_id: first.answerId });

      expect([opened.status, repeated.status]).toEqual([201, 200]);
      expect(repeated.json.answer_id).toBe(opened.json.answer_id);
      expect(world.store.presigned.at(-1)!.key).toBe(world.store.presigned.at(-2)!.key);
      expect(await count(db, s.answers)).toBe(2);

      await world.call(world.handlers.transcribe, opened.json.answer_id, {});
      const late = await world.call(world.handlers.open, roundId, { ...TAKE, retry_of_answer_id: first.answerId });
      expect(late.status).toBe(422);
      expect(late.json.error.code).toBe("transcript_already_final");
    }));

  it("is refused in a realistic round, for an answer not yet sent, and for an answer the round does not have", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const practice = await world.startRound();
      const unsent = await world.record(practice);
      const notSent = await world.call(world.handlers.open, practice, { ...TAKE, retry_of_answer_id: unsent.json.answer_id });
      expect(notSent.status).toBe(400);
      expect(notSent.json.error).toMatchObject({ code: "invalid_request", detail: { fields: ["retry_of_answer_id"] } });

      const unknown = await world.call(world.handlers.open, practice, { ...TAKE, retry_of_answer_id: crypto.randomUUID() });
      expect(unknown.status).toBe(404);
      expect(unknown.json.error.code).toBe("not_found");
      const malformed = await world.call(world.handlers.open, practice, { ...TAKE, retry_of_answer_id: "mine" });
      expect(malformed.status).toBe(400);

      const realistic = await world.startRound({ mode: "realistic" });
      const sent = await world.answer(realistic);
      const refused = await world.call(world.handlers.open, realistic, { ...TAKE, retry_of_answer_id: sent.answerId });
      expect(refused.status).toBe(400);
      expect(refused.json.error).toMatchObject({ code: "invalid_request", detail: { fields: ["retry_of_answer_id"] } });
      // Another round's answer is no answer of this one.
      const realisticAgain = await world.startRound();
      const foreign = await world.call(world.handlers.open, realisticAgain, { ...TAKE, retry_of_answer_id: sent.answerId });
      expect(foreign.status).toBe(404);

      expect((await db.select().from(s.answers)).filter((row) => row.retryOfAnswerId !== null)).toEqual([]);
    }));

  it("shows in the read beside the first, and an open one is what the round resumes on", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);
      const opened = await world.record(roundId, { retry_of_answer_id: first.answerId });

      const { json } = await world.read(roundId);

      expect(json.answers).toEqual([
        expect.objectContaining({ id: first.answerId, position: 1, retry_of_answer_id: null, state: "submitted" }),
        expect.objectContaining({ id: opened.json.answer_id, position: 1, retry_of_answer_id: first.answerId, state: "uploaded" }),
      ]);
      expect(json.prompt).toMatchObject({
        kind: "question",
        position: 1,
        retry_of_answer_id: first.answerId,
        text: (await world.rowOf(first.answerId)).promptText,
        speak: false,
      });
      expect(json.resume).toEqual({ at: "transcribe", answer_id: opened.json.answer_id });
    }));
});

describe("a practice round ends without a rating (07 §5.12)", () => {
  it("completes with an empty body and writes round feedback, with no felt pressure on the row", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      for (let position = 1; position <= 3; position += 1) await world.answerPosition(roundId);
      await world.drainAfter();

      const response = await world.call(world.handlers.complete, roundId, {});

      expect(response.status).toBe(201);
      expect(response.json.round).toMatchObject({ id: roundId, felt_pressure: null });
      expect(response.json.feedback).not.toBeNull();
      expect(world.generator.calls).toBe(1);
      expect(await count(db, s.roundFeedback)).toBe(1);
      const round = await world.roundOf(roundId);
      expect(round.feltPressure).toBeNull();
      expect(round.completedAt).not.toBeNull();
    }));

  // The defect #44's review left for this slice: the last follow-up's submit says `feedback`, and
  // the page must not then ask for a rating the API refuses.
  it("never lands on the felt-pressure screen: after the last answer the frame's next step is the feedback", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      for (let position = 1; position <= 2; position += 1) await world.answerPosition(roundId);
      const { followUp } = await world.answerPosition(roundId);
      expect(followUp!.submitted.json.next).toEqual({ kind: "feedback" });

      const frame = await roundFrame(db, world.userId, await world.roundOf(roundId));

      expect(frame).not.toBe("complete");
      if (frame === "complete") return;
      expect(frame.round.mode).toBe("practice");
      expect(frame.start).toMatchObject({
        kind: "answered",
        answer: { answerId: followUp!.answerId, position: 3, text: FOLLOW_UP_TEXT, again: false },
        next: { kind: "feedback" },
      });
      // What the page would have sent from the screen it used to show is still refused.
      await world.drainAfter();
      const rated = await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      expect(rated.json.error.code).toBe("pressure_not_applicable");
      expect((await world.call(world.handlers.complete, roundId, {})).status).toBe(201);
      expect(await roundFrame(db, world.userId, await world.roundOf(roundId))).toBe("complete");
    }));

  it("still asks a realistic round for its rating", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound({ mode: "realistic" });
      for (let position = 1; position <= 3; position += 1) await world.answerPosition(roundId);

      const frame = await roundFrame(db, world.userId, await world.roundOf(roundId));

      expect(frame !== "complete" && frame.start).toEqual({ kind: "pressure" });
      const unrated = await world.call(world.handlers.complete, roundId, {});
      expect(unrated.json.error.code).toBe("pressure_required");
    }));

  it("writes the feedback from the first answers and the follow-ups, never from an answer given again", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const { answerId, followUp } = await world.answerPosition(roundId);
      await world.answer(roundId, { again: answerId, corrected: "I led it, said a second time." });
      // A follow-up's answer given again has no page, as the follow-up's own answer has none (10 §8).
      await world.answer(roundId, { again: followUp!.answerId, corrected: "It was my call, said a second time." });
      for (let position = 2; position <= 3; position += 1) await world.answerPosition(roundId);
      await world.drainAfter();

      expect((await world.call(world.handlers.complete, roundId, {})).status).toBe(201);

      const [input] = world.generator.inputs;
      expect(input.answers.map((answer) => [answer.position, answer.followUp])).toEqual([
        [1, false],
        [1, true],
        [2, false],
        [2, true],
        [3, false],
        [3, true],
      ]);
      expect(input.answers.filter((answer) => answer.answer.includes("a second time"))).toEqual([]);

      // Screen 8 still shows it: a page of its own straight after the answer it stands beside.
      const screen = await feedbackScreen(db, await world.roundOf(roundId));
      expect(screen.round.mode).toBe("practice");
      expect(screen.answers.map((answer) => [answer.position, answer.again, answer.status])).toEqual([
        [1, 0, "ok"],
        [1, 1, "ok"],
        [2, 0, "ok"],
        [3, 0, "ok"],
      ]);
      // The answer given again has no follow-up of its own; the first keeps its one.
      expect(screen.answers.map((answer) => answer.followUp?.kind ?? null)).toEqual(["asked", null, "asked", "asked"]);
      // The CV region lists the first answers' spans alone: one per question, none from the answer given again.
      expect(screen.grounding?.unsupported.map((span) => span.position)).toEqual([1, 2, 3]);
    }));
});

describe("where a practice round's page opens (10 §15)", () => {
  it("opens on the answer sent last, with the next prompt beside it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);
      await world.drainAfter();

      let frame = await roundFrame(db, world.userId, await world.roundOf(roundId));
      expect(frame !== "complete" && frame.dimensions).toHaveLength(6);
      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "answered",
        answer: {
          answerId: first.answerId,
          position: 1,
          followUpVersion: null,
          again: false,
          corrected: CORRECTED,
          scoring: { status: "ok", flags: [{ kind: "unsupported" }] },
        },
        next: { kind: "follow_up", position: 1, text: FOLLOW_UP_TEXT, promptVersion: "follow-up-en-fake" },
      });

      const followUp = await world.answer(roundId);
      frame = await roundFrame(db, world.userId, await world.roundOf(roundId));
      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "answered",
        answer: { answerId: followUp.answerId, followUpVersion: "follow-up-en-fake", scoring: { status: "pending" } },
        next: { kind: "question", position: 2 },
      });
    }));

  it("opens on the take being recorded once the next slot is open, and on an answer-again before either", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);

      const slot = await world.record(roundId);
      await world.call(world.handlers.transcribe, slot.json.answer_id, {});
      let frame = await roundFrame(db, world.userId, await world.roundOf(roundId));
      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "question",
        position: 1,
        text: FOLLOW_UP_TEXT,
        again: null,
        transcript: { answerId: slot.json.answer_id },
      });

      const again = await world.record(roundId, { retry_of_answer_id: first.answerId });
      frame = await roundFrame(db, world.userId, await world.roundOf(roundId));
      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "question",
        position: 1,
        text: (await world.rowOf(first.answerId)).promptText,
        followUpVersion: null,
        again: first.answerId,
        transcript: null,
      });
      expect(again.status).toBe(201);
    }));

  it("opens on an answer given again once it is sent, marked as one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const first = await world.answer(roundId);
      const again = await world.answer(roundId, { again: first.answerId });

      const frame = await roundFrame(db, world.userId, await world.roundOf(roundId));

      expect(frame !== "complete" && frame.start).toMatchObject({
        kind: "answered",
        answer: { answerId: again.answerId, position: 1, again: true },
        next: { kind: "follow_up", position: 1 },
      });
    }));
});

describe("practice prefers seen questions, end to end (07 §5.4)", () => {
  it("asks first what a realistic round's answers made seen, and those answers are not first attempts", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const realistic = await world.startRound({ mode: "realistic" });
      const answered = [(await world.answerPosition(realistic)).answerId, (await world.answerPosition(realistic)).answerId];
      const realisticAsked = await world.asked(realistic);
      const seen = realisticAsked.slice(0, 2).filter((question) => question.origin !== "set_piece");
      expect(await Promise.all(answered.map(async (id) => (await world.rowOf(id)).isFirstAttempt))).toEqual([true, true]);

      const practice = await world.startRound();
      const practiceAsked = await world.asked(practice);

      // Practice takes no set piece; everything else answered above comes first, then the unseen.
      expect(practiceAsked.every((question) => question.origin !== "set_piece")).toBe(true);
      expect(practiceAsked.slice(0, seen.length).map((question) => question.id)).toEqual(seen.map((question) => question.id));
      const unanswered = realisticAsked[2].id;
      expect(practiceAsked.slice(0, seen.length).map((question) => question.id)).not.toContain(unanswered);

      const practised = await world.answer(practice);
      expect((await world.rowOf(practised.answerId)).isFirstAttempt).toBe(false);
      expect((await world.rowOf(practised.answerId)).questionId).toBe(seen[0].id);
      // The realistic first attempt stays the first attempt.
      expect((await world.rowOf(answered[1])).isFirstAttempt).toBe(true);
    }));
});
