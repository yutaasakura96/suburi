import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import {
  FIXTURE_FEEDBACK,
  FIXTURE_FOLLOW_UP,
  fakeFeedbackGenerator,
  fakeFollowUpGenerator,
  fakeModelHealth,
  fakeScorer,
  fakeTranscriber,
  uniformScores,
} from "../ai/fake-round-ports";
import { ModelCallFailed } from "../ai/upstream";
import { fakeAudioStore } from "../audio/fake-store";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createComplete, createFeedbackRetry } from "./complete";
import { createGetRound } from "./get-round";
import { createOpenAnswer } from "./open-answer";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";
import { runScoringAttempt } from "./run-scoring";
import { createSubmit } from "./submit";
import { createTranscribe } from "./transcribe";
import { createTypedTranscript } from "./typed-transcript";

// The round's failure paths (#48), through the handlers against the migrated test database: resume
// (07 §5.5), the typed answer (§5.8), `write_failed` at every database call of every round route
// (11 §3.16), and what no envelope or log line may carry (11 §3.10). Only the model ports and the
// bucket are faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Recognisable text that must never reach an error envelope or a log line (11 §3.10): one in the raw
// transcript, one in the corrected text, one in a typed answer, one in a follow-up — and one in the
// message of the database failure itself, where pg puts a query's parameters.
const RAW_SENTINEL = "ZEBRA-SENTINEL-4471";
const CORRECTED_SENTINEL = "IBEX-SENTINEL-8830";
const TYPED_SENTINEL = "TAPIR-SENTINEL-5512";
const FOLLOW_UP_SENTINEL = "OKAPI-SENTINEL-2093";
const FAILURE_SENTINEL = "QUOKKA-SENTINEL-7765";

const HEARD = `I led the migration at ${RAW_SENTINEL}, um, in six months.`;
const CORRECTED = `I led the migration at ${CORRECTED_SENTINEL} in six months.`;
const TYPED = `I led the migration at ${TYPED_SENTINEL} in six months.`;
const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);

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

/**
 * The database, failing on demand: armed with `n`, its nth call from then on throws what pg raises
 * for a lost connection — a SQLSTATE, and a message that carries text. Every way a handler reaches
 * the database goes through it, so a route can be failed at each call it makes, one at a time.
 */
function faultyDb(db: TestDb) {
  const calls = new Set(["select", "selectDistinct", "insert", "update", "delete", "execute"]);
  let countdown = 0;
  let fired = false;
  const proxy = new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!calls.has(String(property))) return value.bind(target);
      return (...args: unknown[]) => {
        if (countdown > 0 && (countdown -= 1) === 0) {
          fired = true;
          throw Object.assign(new Error(`connection lost near ${FAILURE_SENTINEL}`), { code: "08006" });
        }
        return (value as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return {
    db: proxy as TestDb,
    arm(n: number) {
      countdown = n;
      fired = false;
    },
    /** Whether the armed failure was reached. */
    disarm() {
      countdown = 0;
      return fired;
    },
  };
}

// The handler's transaction, as a savepoint inside the test's rolled-back transaction, so a failed
// write really is undone.
function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint round_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint round_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint round_write`);
      throw error;
    }
  };
}

async function setUp(raw: TestDb) {
  await seedUser(raw, getConfig().ALLOWED_EMAIL);
  const [user] = await raw.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedSyntheticCv(raw, user.id, "en");
  await seedRubrics(raw);
  await seedSetPieces(raw, user.id);
  await seedSyntheticQuestions(raw, user.id);

  const faults = faultyDb(raw);
  const db = faults.db;
  // The session is read through the database as it is: Better Auth owns that read and its own logging.
  const auth = createAuth({ db: raw, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const scheduled: (() => Promise<unknown>)[] = [];
  const store = fakeAudioStore();
  const scorer = fakeScorer(uniformScores(3));
  const transcriber = fakeTranscriber(() => ({ text: HEARD, durationMs: 90_000 }));
  const generator = fakeFeedbackGenerator(() => FIXTURE_FEEDBACK);
  const followUps = fakeFollowUpGenerator(() => ({ ...FIXTURE_FOLLOW_UP, text: `How did you measure the ${FOLLOW_UP_SENTINEL} six months?` }));
  const base = { auth, db, transaction: savepointTransaction(db) };
  const timing = { waitBoundMs: 50, sleep: async () => {} };
  const scoring = { ...base, scorer, sleep: async () => {} };

  const handlers = {
    roleContext: createPostRoleContext(base),
    round: createPostRound({ ...base, health: fakeModelHealth(), scorer }),
    read: createGetRound(base),
    open: createOpenAnswer({ ...base, store, prefix: "dev/" }),
    transcribe: createTranscribe({ ...base, store, transcriber }),
    typed: createTypedTranscript(base),
    submit: createSubmit({
      ...scoring,
      followUpGenerator: followUps,
      after: (work) => void scheduled.push(work),
      deadline: () => Date.now() + 280_000,
    }),
    complete: createComplete({ ...base, generator, ...timing }),
    feedback: createFeedbackRetry({ ...base, generator, ...timing }),
  };

  const responses: string[] = [];
  async function send(handler: (request: Request, id: string) => Promise<Response>, id: string, init: RequestInit, query = "") {
    const response = await handler(
      new Request(`http://localhost:3000/api/x${query}`, {
        ...init,
        headers: { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` },
      }),
      id,
    );
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text), text };
  }
  const call = (handler: (request: Request, id: string) => Promise<Response>, id: string, body: unknown) =>
    send(handler, id, { method: "POST", body: JSON.stringify(body) });
  const post = (handler: (request: Request) => Promise<Response>, body: unknown) => call((request) => handler(request), "", body);
  const read = (roundId: string, query = "") => send(handlers.read, roundId, { method: "GET" }, query);

  async function drainAfter() {
    while (scheduled.length > 0) await scheduled.shift()!();
  }
  const general = async () => (await post(handlers.roleContext, { kind: "general" })).json.id as string;
  let started = 0;
  async function startRound(overrides: object = {}) {
    const body = { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: await general(), ...overrides };
    const roundId = (await post(handlers.round, body)).json.round.id as string;
    // One transaction shares one now(): each round is dated as a later request would date it.
    await raw
      .update(s.rounds)
      .set({ startedAt: sql`${s.rounds.startedAt} + make_interval(secs => ${started})` })
      .where(eq(s.rounds.id, roundId));
    started += 1;
    return roundId;
  }
  /** A take, its slot and its upload, for the round's current prompt. */
  async function upload(roundId: string) {
    const opened = await call(handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
    store.put(store.presigned.at(-1)!.key, AUDIO);
    return opened.json.answer_id as string;
  }
  async function answerCurrent(roundId: string, corrected = CORRECTED) {
    const answerId = await upload(roundId);
    await call(handlers.transcribe, answerId, {});
    const submitted = await call(handlers.submit, answerId, { transcript_corrected: corrected });
    return { answerId, submitted };
  }
  /** Every position: the bank question, then its follow-up. */
  async function answerAll(roundId: string) {
    for (let position = 1; position <= 3; position += 1) {
      await answerCurrent(roundId);
      await answerCurrent(roundId);
    }
  }

  return {
    userId: user.id,
    raw,
    base,
    faults,
    scoring,
    store,
    scorer,
    transcriber,
    generator,
    followUps,
    handlers,
    call,
    post,
    read,
    responses,
    scheduled,
    drainAfter,
    general,
    startRound,
    upload,
    answerCurrent,
    answerAll,
  };
}

type World = Awaited<ReturnType<typeof setUp>>;
type Reply = Awaited<ReturnType<World["call"]>>;

async function makeReadOnly(world: World, db: TestDb, roundId: string, status: "newer" | "earlier_day" | "complete") {
  if (status === "newer") await world.startRound();
  else if (status === "earlier_day") await db.update(s.rounds).set({ startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) }).where(eq(s.rounds.id, roundId));
  else await db.update(s.rounds).set({ completedAt: new Date() }).where(eq(s.rounds.id, roundId));
}

async function count(db: TestDb, table: typeof s.rounds | typeof s.answers | typeof s.followUps | typeof s.roundFeedback | typeof s.scoringAttempts) {
  return (await db.select({ id: table.id }).from(table)).length;
}

describe("GET /api/rounds/{id} — resume (07 §5.5)", () => {
  it("names each next call with the stored prompt and each answer's derived state", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();

      const fresh = await world.read(roundId);
      expect(fresh.status).toBe(200);
      expect(fresh.json.round).toMatchObject({ id: roundId, mode: "realistic", length: 3, completed_at: null, status: "in_progress" });
      expect(fresh.json.answers).toEqual([]);
      expect(fresh.json.prompt).toMatchObject({ kind: "question", position: 1, speak: true });
      expect(fresh.json.resume).toEqual({ at: "answers" });
      const asked = fresh.json.prompt.text as string;

      const answerId = await world.upload(roundId);
      const uploaded = await world.read(roundId);
      expect(uploaded.json.answers).toEqual([{ id: answerId, position: 1, kind: "question", state: "open" }]);
      expect(uploaded.json.resume).toEqual({ at: "upload", answer_id: answerId });
      // The same prompt on every read: it was fixed when the round started.
      expect(uploaded.json.prompt.text).toBe(asked);

      await world.call(world.handlers.transcribe, answerId, {});
      const transcribed = await world.read(roundId);
      expect(transcribed.json.answers[0].state).toBe("transcribed");
      expect(transcribed.json.resume).toEqual({ at: "submit", answer_id: answerId });
      expect(transcribed.json.prompt.text).toBe(asked);

      await world.call(world.handlers.submit, answerId, { transcript_corrected: CORRECTED });
      const followUp = await world.read(roundId);
      expect(followUp.json.answers[0]).toMatchObject({ state: "submitted", scoring: { status: "pending" } });
      // The follow-up shares its question's position, and is read from its stored row.
      expect(followUp.json.prompt).toMatchObject({ kind: "follow_up", position: 1, parent_answer_id: answerId });
      expect(followUp.json.prompt.text).toContain(FOLLOW_UP_SENTINEL);
      expect(followUp.json.resume).toEqual({ at: "answers" });
      expect(world.followUps.calls).toBe(1);

      await world.answerCurrent(roundId);
      for (let position = 2; position <= 3; position += 1) {
        await world.answerCurrent(roundId);
        await world.answerCurrent(roundId);
      }
      const answered = await world.read(roundId);
      expect(answered.json.prompt).toBeNull();
      expect(answered.json.resume).toEqual({ at: "complete" });
      expect(answered.json.answers).toHaveLength(6);
      // Reading never generates: one follow-up call per question, whatever was read.
      expect(world.followUps.calls).toBe(3);
    }));

  it("keeps an unconfirmed upload at upload after a failed PUT and confirms one before a failed transcription", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const opened = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      const answerId = opened.json.answer_id as string;
      expect((await world.read(roundId)).json.resume).toEqual({ at: "upload", answer_id: answerId });
      const missing = await world.call(world.handlers.transcribe, answerId, {});
      expect(missing.json.error.code).toBe("audio_missing");
      world.store.put(world.store.presigned.at(-1)!.key, AUDIO);
      world.transcriber.transcribe = async () => { throw new ModelCallFailed("Transcription", "upstream_500"); };
      const failed = await world.call(world.handlers.transcribe, answerId, {});
      expect(failed.json.error.code).toBe("transcription_failed");
      expect((await world.read(roundId)).json).toMatchObject({
        answers: [{ state: "uploaded" }], resume: { at: "transcribe", answer_id: answerId },
      });
    }));

  it("resumes a submitted answer whose follow-up is not stored at `submit`, with no prompt", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const { answerId } = await world.answerCurrent(roundId);
      await db.delete(s.followUps).where(eq(s.followUps.parentAnswerId, answerId));
      const { json } = await world.read(roundId);
      expect(json.prompt).toBeNull();
      expect(json.resume).toEqual({ at: "submit", answer_id: answerId });
    }));

  it("gives an abandoned round no resume and no prompt, and keeps its answers (11 §3.15)", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      await world.answerCurrent(first);
      expect((await world.read(first)).json.round.status).toBe("in_progress");

      const second = await world.startRound();
      const abandoned = await world.read(first);
      expect(abandoned.json.round.status).toBe("abandoned");
      expect(abandoned.json.resume).toBeNull();
      expect(abandoned.json.prompt).toBeNull();
      expect(abandoned.json.answers).toHaveLength(1);
      expect((await world.read(second)).json).toMatchObject({ round: { status: "in_progress" }, resume: { at: "answers" } });
    }));

  it("abandons a round started at 23:50 JST once it is 00:10 JST, whatever the server's zone", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      // 14:50 UTC is 23:50 in Tokyo; twenty minutes later is the next day there, and the same day in UTC.
      await db.update(s.rounds).set({ startedAt: new Date("2026-10-01T14:50:00Z") }).where(eq(s.rounds.id, roundId));
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-01T14:55:00Z") });
      try {
        expect((await world.read(roundId)).json).toMatchObject({ round: { status: "in_progress" }, resume: { at: "answers" } });
        vi.setSystemTime(new Date("2026-10-01T15:10:00Z"));
        expect((await world.read(roundId)).json).toMatchObject({ round: { status: "abandoned" }, resume: null, prompt: null });
      } finally {
        vi.useRealTimers();
      }
    }));

  it("carries no score, flag or scores field for a realistic round until it is complete (US-8)", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      await world.answerAll(roundId);
      await world.drainAfter();

      const open = await world.read(roundId);
      expect(open.json.answers).toHaveLength(6);
      for (const answer of open.json.answers) {
        expect(Object.keys(answer.scoring).sort()).toEqual(["attempt_id", "status"]);
        expect(answer.scoring.status).toBe("ok");
      }
      expect(open.text).not.toMatch(/"scores"|"flags"|"value"/);

      await world.call(world.handlers.complete, roundId, { felt_pressure: 3 });
      const complete = await world.read(roundId);
      expect(complete.json).toMatchObject({ round: { status: "complete" }, resume: null, prompt: null });
      expect(complete.json.answers[0].scoring.scores).toHaveLength(6);
    }));

  it("carries a practice round's scores, in the rubric's order, and its flags once each answer is ok", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      world.scorer.score = async (input) => ({
        ...uniformScores(4)(input),
        unsupported: [{ quote: "in six months", startHint: 0 }],
      });
      const roundId = await world.startRound({ mode: "practice" });
      await world.answerCurrent(roundId);

      const pending = await world.read(roundId);
      expect(pending.json.answers[0].scoring).toEqual({ attempt_id: expect.any(String), status: "pending" });

      await world.drainAfter();
      const scored = await world.read(roundId);
      const [rubric] = await db.select().from(s.rubricVersions).where(eq(s.rubricVersions.language, "en"));
      const order = (rubric.dimensions as { key: string }[]).map((dimension) => dimension.key);
      expect(scored.json.answers[0].scoring.status).toBe("ok");
      expect(scored.json.answers[0].scoring.scores).toEqual(order.map((dimension) => ({ dimension, value: 4 })));
      const start = CORRECTED.indexOf("in six months");
      expect(scored.json.answers[0].scoring.flags).toEqual([
        { kind: "unsupported", span_start: start, span_end: start + "in six months".length },
      ]);
      // No composite, here or anywhere (refusal #1).
      expect(scored.text).not.toMatch(/total|average|overall|composite/i);
    }));

  it("is 404 for another user's round and for no round, 400 for an unknown parameter, 401 with no session", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();

      const unknown = await world.read(roundId, "?include=scores");
      expect(unknown.status).toBe(400);
      expect(unknown.json.error).toMatchObject({ code: "invalid_request", detail: { fields: ["include"] } });

      expect((await world.read(crypto.randomUUID())).status).toBe(404);
      expect((await world.read("not-a-uuid")).status).toBe(404);

      const other = crypto.randomUUID();
      await db.insert(s.users).values({ id: other, name: "other", email: `${other}@example.test` });
      await db.update(s.rounds).set({ userId: other }).where(eq(s.rounds.id, roundId));
      const theirs = await world.read(roundId);
      expect(theirs.status).toBe(404);
      expect(theirs.json.error.code).toBe("not_found");

      const anonymous = await world.handlers.read(new Request("http://localhost:3000/api/x"), roundId);
      expect(anonymous.status).toBe(401);
    }));
});

describe("POST /api/answers/{id}/transcribe — round writability", () => {
  it.each(["newer", "earlier_day", "complete"] as const)("refuses an unconfirmed take after the round becomes %s", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      await makeReadOnly(world, db, roundId, status);
      const refused = await world.call(world.handlers.transcribe, answerId, {});
      expect(refused.json.error.code).toBe(status === "complete" ? "round_already_complete" : "round_abandoned");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row).toMatchObject({ audioUploadedAt: null, transcriptRaw: null });
      expect(world.transcriber.calls).toBe(0);
    }));

  it.each(["newer", "complete"] as const)("refuses confirmation if the round becomes %s while reading S3", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      const get = world.store.get;
      world.store.get = async (key) => {
        await makeReadOnly(world, db, roundId, status);
        return get(key);
      };
      const refused = await world.call(world.handlers.transcribe, answerId, {});
      expect(refused.json.error.code).toBe(status === "complete" ? "round_already_complete" : "round_abandoned");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row).toMatchObject({ audioUploadedAt: null, transcriptRaw: null });
      expect(world.transcriber.calls).toBe(0);
    }));

  it.each(["newer", "complete"] as const)("refuses the transcript if the round becomes %s during transcription", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      world.transcriber.transcribe = async () => {
        await makeReadOnly(world, db, roundId, status);
        return { text: HEARD, durationMs: 90_000 };
      };
      const refused = await world.call(world.handlers.transcribe, answerId, {});
      expect(refused.json.error.code).toBe(status === "complete" ? "round_already_complete" : "round_abandoned");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.audioUploadedAt).not.toBeNull();
      expect(row.transcriptRaw).toBeNull();
    }));

  it.each(["newer", "complete"] as const)("refuses an idempotent read after the round becomes %s", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      expect((await world.call(world.handlers.transcribe, answerId, {})).status).toBe(200);
      await makeReadOnly(world, db, roundId, status);
      const refused = await world.call(world.handlers.transcribe, answerId, {});
      expect(refused.json.error.code).toBe(status === "complete" ? "round_already_complete" : "round_abandoned");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBe(HEARD);
    }));
});

describe("POST /api/answers/{id}/transcript — the typed answer (07 §5.8)", () => {
  /** A take uploaded and unreadable: transcription fails, and the take is kept. */
  async function failedTake(world: World) {
    const roundId = await world.startRound();
    const answerId = await world.upload(roundId);
    world.transcriber.transcribe = async () => {
      throw new ModelCallFailed("Transcription", "upstream_500");
    };
    const failed = await world.call(world.handlers.transcribe, answerId, {});
    expect(failed.status).toBe(502);
    expect(failed.json.error.code).toBe("transcription_failed");
    return { roundId, answerId };
  }

  it("refuses writes to abandoned and completed rounds without changing the transcript", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      const opened = await world.call(world.handlers.open, first, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      const answerId = opened.json.answer_id as string;
      await world.startRound();
      const abandoned = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(abandoned.json.error.code).toBe("round_abandoned");
      expect((await db.select().from(s.answers).where(eq(s.answers.id, answerId)))[0].transcriptRaw).toBeNull();

      const current = await world.startRound();
      const next = await world.call(world.handlers.open, current, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      const nextId = next.json.answer_id as string;
      await db.update(s.rounds).set({ completedAt: new Date() }).where(eq(s.rounds.id, current));
      const completed = await world.call(world.handlers.typed, nextId, { source: "typed", text: TYPED });
      expect(completed.json.error.code).toBe("round_already_complete");
      expect((await db.select().from(s.answers).where(eq(s.answers.id, nextId)))[0].transcriptRaw).toBeNull();
    }));

  it.each(["newer", "earlier_day", "complete"] as const)("refuses a repeated typed transcript after a round becomes %s", (status) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const opened = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      const answerId = opened.json.answer_id as string;
      expect((await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED })).status).toBe(201);
      await makeReadOnly(world, db, roundId, status);
      const repeated = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(repeated.json.error.code).toBe(status === "complete" ? "round_already_complete" : "round_abandoned");
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBe(TYPED);
    }));

  it("stores the typed text as the raw transcript, with no transcriber, no duration and no pace", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { roundId, answerId } = await failedTake(world);

      const typed = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(typed.status).toBe(201);
      expect(typed.json).toEqual({ answer_id: answerId, transcript_raw: TYPED, transcriber_model_id: null, words_per_minute: null });

      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row).toMatchObject({ transcriptRaw: TYPED, transcriberModelId: null, wordsPerMinute: null, audioDurationMs: null });
      // The take is kept: typing does not replace the audio.
      expect(row.audioS3Key).not.toBeNull();
      expect(world.store.objects.has(row.audioS3Key!)).toBe(true);
      expect((await world.read(roundId)).json.resume).toEqual({ at: "submit", answer_id: answerId });
    }));

  it("goes on through submit and scoring like any answer, and the scorer is told there was no delivery", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      const inputs: { durationMs: number | null; pace: number | null }[] = [];
      world.scorer.score = async (input) => {
        inputs.push({ durationMs: input.durationMs, pace: input.pace });
        return uniformScores(3)(input);
      };

      const submitted = await world.call(world.handlers.submit, answerId, { transcript_corrected: TYPED });
      expect(submitted.status).toBe(200);
      expect(submitted.json.rewrite_magnitude).toBe(0);
      await world.drainAfter();
      expect(inputs).toEqual([{ durationMs: null, pace: null }]);
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      // Both texts persist, and the mark that keeps it out of pace and Progress is still there.
      expect(row).toMatchObject({ transcriptRaw: TYPED, transcriptCorrected: TYPED, transcriberModelId: null, wordsPerMinute: null });
    }));

  it("returns the same row for the same text again, and refuses a different one", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });

      const again = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(again.status).toBe(200);
      expect(again.json.transcript_raw).toBe(TYPED);

      const other = await world.call(world.handlers.typed, answerId, { source: "typed", text: "Something else." });
      expect(other.status).toBe(422);
      expect(other.json.error).toMatchObject({ code: "transcript_already_final", detail: { answer_id: answerId } });
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBe(TYPED);
    }));

  it("refuses a typed answer once the transcriber's transcript is stored: a raw transcript is final", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      await world.call(world.handlers.transcribe, answerId, {});

      // Even the very text the transcriber heard: it was not typed.
      for (const text of [TYPED, HEARD]) {
        const refused = await world.call(world.handlers.typed, answerId, { source: "typed", text });
        expect(refused.status).toBe(422);
        expect(refused.json.error.code).toBe("transcript_already_final");
      }
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row).toMatchObject({ transcriptRaw: HEARD, transcriberModelId: "fake-transcriber" });
    }));

  it("makes no model call when transcribe is sent after typing: the stored text is returned", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      const transcriber = fakeTranscriber(() => ({ text: HEARD, durationMs: 90_000 }));
      const transcribe = createTranscribe({ ...world.base, store: world.store, transcriber });
      const response = await world.call(transcribe, answerId, {});
      expect(response.status).toBe(200);
      expect(response.json).toMatchObject({ transcript_raw: TYPED, transcriber_model_id: null, words_per_minute: null });
      expect(transcriber.calls).toBe(0);
    }));

  it.each([
    [{ source: "typed", text: "   " }, ["text"]],
    [{ source: "spoken", text: TYPED }, ["source"]],
    [{ source: "typed", text: TYPED, transcriber_model_id: "mine" }, ["transcriber_model_id"]],
  ])("is 400 naming the field, never its value, and writes nothing: %#", (body, fields) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      const response = await world.call(world.handlers.typed, answerId, body);
      expect(response.status).toBe(400);
      expect(response.json.error).toMatchObject({ code: "invalid_request", detail: { fields } });
      expect(response.text).not.toContain(TYPED_SENTINEL);
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBeNull();
    }));

  it("accepts typed text beyond the removed character cap", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      const text = "x".repeat(20_001);
      const response = await world.call(world.handlers.typed, answerId, { source: "typed", text });
      expect(response.status).toBe(201);
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBe(text);
    }));

  it("opens a slot with no key for a take the route refused, and the typed answer lands on it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const refused = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: 20 * 1024 * 1024 + 1 });
      expect(refused.json.error.code).toBe("upload_too_large");
      expect(await db.select().from(s.answers).where(eq(s.answers.roundId, roundId))).toHaveLength(0);

      const opened = await world.call(world.handlers.open, roundId, { source: "typed" });
      expect(opened.status).toBe(201);
      const answerId = opened.json.answer_id as string;
      expect(opened.json).toEqual({ answer_id: answerId });
      expect(world.store.presigned).toHaveLength(0);
      const again = await world.call(world.handlers.open, roundId, { source: "typed" });
      expect(again.status).toBe(200);
      expect(again.json.answer_id).toBe(answerId);
      expect((await world.read(roundId)).json.resume).toEqual({ at: "upload", answer_id: answerId });

      const typed = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(typed.status).toBe(201);
      const rows = await db.select().from(s.answers).where(eq(s.answers.roundId, roundId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: answerId,
        position: 1,
        transcriptRaw: TYPED,
        transcriberModelId: null,
        audioS3Key: null,
        audioUploadedAt: null,
        wordsPerMinute: null,
      });
      expect((await world.read(roundId)).json.resume).toEqual({ at: "submit", answer_id: answerId });
    }));

  it("refuses a take sent to a slot opened for typing: the slot keeps no key and nothing is presigned", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const typed = await world.call(world.handlers.open, roundId, { source: "typed" });
      const answerId = typed.json.answer_id as string;
      const taken = await world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      expect(taken.status).toBe(422);
      expect(taken.json.error).toMatchObject({ code: "unsupported_content_type", detail: { answer_id: answerId } });
      expect(world.store.presigned).toHaveLength(0);
      const rows = await db.select().from(s.answers).where(eq(s.answers.roundId, roundId));
      expect(rows).toHaveLength(1);
      expect(rows[0].audioS3Key).toBeNull();
      expect((await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED })).status).toBe(201);
    }));

  it.each([
    [{}, ["content_type", "expected_bytes"]],
    [{ source: "typed", content_type: "audio/webm" }, ["content_type"]],
    [{ source: "spoken" }, ["source"]],
    [{ source: "typed", text: TYPED }, ["text"]],
  ])("refuses a slot body that is neither a take nor typed, naming the fields: %#", (body, fields) =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const response = await world.call(world.handlers.open, roundId, body);
      expect(response.status).toBe(400);
      expect(response.json.error.code).toBe("invalid_request");
      expect([...response.json.error.detail.fields].sort()).toEqual([...fields].sort());
      expect(response.text).not.toContain(TYPED_SENTINEL);
      expect(await db.select().from(s.answers).where(eq(s.answers.roundId, roundId))).toHaveLength(0);
    }));

  it("refuses a typed slot on an abandoned round", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const first = await world.startRound();
      await world.startRound();
      const refused = await world.call(world.handlers.open, first, { source: "typed" });
      expect(refused.json.error.code).toBe("round_abandoned");
      expect(await db.select().from(s.answers).where(eq(s.answers.roundId, first))).toHaveLength(0);
    }));

  it("is 404 for another user's answer and for no answer", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { answerId } = await failedTake(world);
      expect((await world.call(world.handlers.typed, crypto.randomUUID(), { source: "typed", text: TYPED })).status).toBe(404);
      const other = crypto.randomUUID();
      await db.insert(s.users).values({ id: other, name: "other", email: `${other}@example.test` });
      await db.update(s.answers).set({ userId: other }).where(eq(s.answers.id, answerId));
      const theirs = await world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      expect(theirs.status).toBe(404);
      const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
      expect(row.transcriptRaw).toBeNull();
    }));
});

/**
 * 11 §3.16. Each route is failed at its first database call, then its second, and so on until a call
 * gets through untouched — so every call a handler makes has been the one that failed, the limiter's
 * upsert and the reads between two writes included. Each failure is rolled back to the same starting point.
 */
async function failAtEveryCall(
  world: World,
  act: () => Promise<Reply>,
  afterFailure: (failed: Reply) => Promise<void>,
): Promise<number> {
  for (let n = 1; n <= 80; n += 1) {
    await world.raw.execute(sql`savepoint failure_point`);
    const loggedBefore = logged.length;
    world.faults.arm(n);
    const reply = await act();
    if (!world.faults.disarm()) {
      await world.raw.execute(sql`rollback to savepoint failure_point`);
      // Nothing failed: the route ran to its own answer, having made n - 1 calls or fewer.
      expect(reply.status).toBeLessThan(300);
      return n - 1;
    }

    // The 07 §2 envelope, never a bare 500; `detail` is ids and the SQLSTATE, and nothing else.
    expect(reply.status, `call ${n}`).toBe(500);
    expect(reply.json.error.code, `call ${n}`).toBe("write_failed");
    const { error_class: errorClass, ...ids } = reply.json.error.detail;
    expect(errorClass).toBe("pg_08006");
    for (const [key, value] of Object.entries(ids)) {
      expect(["round_id", "answer_id"]).toContain(key);
      expect(value).toMatch(/^[0-9a-f-]{36}$/);
    }
    for (const text of [reply.text, ...logged.slice(loggedBefore)]) {
      for (const sentinel of [FAILURE_SENTINEL, RAW_SENTINEL, CORRECTED_SENTINEL, TYPED_SENTINEL, FOLLOW_UP_SENTINEL]) {
        expect(text, `call ${n}`).not.toContain(sentinel);
      }
    }
    await afterFailure(reply);
    world.scheduled.length = 0;
    await world.raw.execute(sql`rollback to savepoint failure_point`);
  }
  throw new Error("the route never ran without reaching the armed failure");
}

describe("write_failed on every round route (11 §3.16)", () => {
  it("POST /api/role-contexts: nothing written, and the same call then creates it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const act = () => world.post(world.handlers.roleContext, { kind: "general" });
      const calls = await failAtEveryCall(world, act, async () => {
        expect((await db.select({ id: s.roleContexts.id }).from(s.roleContexts)).length).toBe(0);
        expect((await act()).status).toBe(201);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST /api/rounds: no round and no round_questions, and the same call then starts it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const body = { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: await world.general() };
      const act = () => world.post(world.handlers.round, body);
      const calls = await failAtEveryCall(world, act, async () => {
        expect(await count(db, s.rounds)).toBe(0);
        expect((await db.select({ id: s.roundQuestions.id }).from(s.roundQuestions)).length).toBe(0);
        expect((await act()).status).toBe(201);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("GET /api/rounds/{id}: the envelope, and the same read then answers", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const act = () => world.read(roundId);
      const calls = await failAtEveryCall(world, act, async (failed) => {
        expect(failed.json.error.detail.round_id).toBe(roundId);
        expect((await act()).json.resume).toEqual({ at: "answers" });
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST …/answers: no slot, and the round resumes at the same call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const act = () => world.call(world.handlers.open, roundId, { content_type: "audio/webm", expected_bytes: AUDIO.byteLength });
      const calls = await failAtEveryCall(world, act, async () => {
        expect(await count(db, s.answers)).toBe(0);
        expect((await world.read(roundId)).json.resume).toEqual({ at: "answers" });
        expect((await act()).status).toBe(201);
        expect(await count(db, s.answers)).toBe(1);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST …/transcribe: no transcript, the take kept, and the round resumes at the same call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      const act = () => world.call(world.handlers.transcribe, answerId, {});
      const calls = await failAtEveryCall(world, act, async () => {
        const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
        expect(row.transcriptRaw).toBeNull();
        expect(world.store.objects.has(row.audioS3Key!)).toBe(true);
        expect((await world.read(roundId)).json.resume).toEqual({ at: row.audioUploadedAt === null ? "upload" : "transcribe", answer_id: answerId });
        expect((await act()).status).toBe(200);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST …/transcript: no typed text stored, and the round resumes at the same call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      const act = () => world.call(world.handlers.typed, answerId, { source: "typed", text: TYPED });
      const calls = await failAtEveryCall(world, act, async () => {
        const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
        expect(row.transcriptRaw).toBeNull();
        expect((await world.read(roundId)).json.resume).toEqual({ at: "upload", answer_id: answerId });
        expect((await act()).status).toBe(201);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST …/submit: the round resumes at submit, and the same body then leaves one attempt and one follow-up", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const answerId = await world.upload(roundId);
      await world.call(world.handlers.transcribe, answerId, {});
      const act = () => world.call(world.handlers.submit, answerId, { transcript_corrected: CORRECTED });
      const calls = await failAtEveryCall(world, act, async () => {
        // The answer's commit and its follow-up's row are two writes (07 §5.9). Whichever call failed,
        // nothing is half-written inside either: the correction always has its attempt, and the round
        // stands at `submit` until the follow-up is a row.
        const [row] = await db.select().from(s.answers).where(eq(s.answers.id, answerId));
        expect(await count(db, s.scoringAttempts)).toBe(row.transcriptCorrected === null ? 0 : 1);
        const followUps = await count(db, s.followUps);
        if (row.transcriptCorrected === null) expect(followUps).toBe(0);
        const resumed = await world.read(roundId);
        if (followUps === 0) expect(resumed.json.resume).toEqual({ at: "submit", answer_id: answerId });
        // Both writes landed and only the reply was lost: the round has moved on to the stored follow-up.
        else expect(resumed.json).toMatchObject({ resume: { at: "answers" }, prompt: { kind: "follow_up", parent_answer_id: answerId } });

        const retried = await act();
        expect(retried.status).toBe(200);
        expect(retried.json.next.kind).toBe("follow_up");
        expect(await count(db, s.scoringAttempts)).toBe(1);
        expect(await count(db, s.followUps)).toBe(1);
      });
      expect(calls).toBeGreaterThan(0);
    }));

  it("POST …/complete: write_failed only while the round is still open; once it is complete, the same completed result with feedback pending", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      await world.answerAll(roundId);
      await world.drainAfter();
      const act = () => world.call(world.handlers.complete, roundId, { felt_pressure: 4 });
      let before = 0;
      let after = 0;
      for (let n = 1; ; n += 1) {
        expect(n).toBeLessThan(80);
        await world.raw.execute(sql`savepoint failure_point`);
        world.faults.arm(n);
        const reply = await act();
        const failed = world.faults.disarm();
        if (failed) {
          const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
          const resumed = await world.read(roundId);
          // The rating and `completed_at` are one write: both, or neither (07 §5.12).
          if (round.completedAt === null) {
            before += 1;
            expect(reply.status, `call ${n}`).toBe(500);
            expect(reply.json.error).toMatchObject({ code: "write_failed", detail: { round_id: roundId, error_class: "pg_08006" } });
            expect(round.feltPressure).toBeNull();
            expect(resumed.json.resume).toEqual({ at: "complete" });
            expect(await count(db, s.roundFeedback)).toBe(0);
            expect((await act()).status).toBe(201);
          } else {
            after += 1;
            // The write landed, so the call says so: complete, its rating, and feedback still pending.
            expect(reply.status, `call ${n}`).toBe(201);
            expect(reply.json).toMatchObject({ round: { id: roundId, felt_pressure: 4 }, feedback: null });
            expect(reply.text).not.toContain(FAILURE_SENTINEL);
            expect(resumed.json).toMatchObject({ round: { status: "complete" }, resume: null });
            expect(await count(db, s.roundFeedback)).toBe(0);
            // The same call again is the same completed result, and `feedback` writes what is pending.
            const again = await act();
            expect(again.status).toBe(200);
            expect(again.json).toEqual({ ...reply.json, scoring: { ok: 6, pending: 0, failed: 0 } });
            const written = await world.call(world.handlers.feedback, roundId, {});
            expect(written.status).toBe(201);
            const last = await world.call(world.handlers.complete, roundId, { felt_pressure: 2 });
            expect(last.status).toBe(200);
            expect(last.json).toEqual({ ...again.json, feedback: written.json.feedback });
          }
          expect(await count(db, s.roundFeedback)).toBe(1);
        }
        world.scheduled.length = 0;
        await world.raw.execute(sql`rollback to savepoint failure_point`);
        if (!failed) {
          expect(reply.status).toBe(201);
          break;
        }
      }
      expect(before).toBeGreaterThan(0);
      expect(after).toBeGreaterThan(0);
    }));

  it("POST …/feedback: no feedback row, and the same call then writes it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      await world.answerAll(roundId);
      await world.drainAfter();
      // Complete, with its findings not written: the state the retry exists for.
      const failing = fakeFeedbackGenerator(() => {
        throw new ModelCallFailed("Round feedback", "upstream_500");
      });
      const closed = await world.call(createComplete({ ...world.base, generator: failing, waitBoundMs: 50, sleep: async () => {} }), roundId, {
        felt_pressure: 2,
      });
      expect(closed.status).toBe(502);

      const act = () => world.call(world.handlers.feedback, roundId, {});
      const calls = await failAtEveryCall(world, act, async () => {
        expect(await count(db, s.roundFeedback)).toBe(0);
        expect((await act()).status).toBe(201);
        expect(await count(db, s.roundFeedback)).toBe(1);
      });
      expect(calls).toBeGreaterThan(0);
    }));
});

describe("never a bare 500 (07 §2)", () => {
  it("answers write_failed when the session read itself throws, with the error's text nowhere", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const auth = {
        api: {
          getSession: async (): Promise<null> => {
            throw new Error(`session store unreachable near ${FAILURE_SENTINEL}`);
          },
        },
      };
      const before = logged.length;
      for (const handler of [createGetRound({ ...world.base, auth }), createOpenAnswer({ ...world.base, auth, store: world.store, prefix: "dev/" })]) {
        const reply = await world.call(handler, roundId, { content_type: "audio/webm", expected_bytes: 8 });
        expect(reply.status).toBe(500);
        expect(reply.json.error).toMatchObject({ code: "write_failed", detail: { round_id: roundId, error_class: "unexpected" } });
        expect(reply.text).not.toContain(FAILURE_SENTINEL);
      }
      for (const text of logged.slice(before)) expect(text).not.toContain(FAILURE_SENTINEL);
      expect(await count(db, s.answers)).toBe(0);
    }));
});

describe("no text in an envelope or a log line, on any round route (11 §3.10)", () => {
  it("forces every refusal a round route can give, and finds no transcript, typed, follow-up or CV text in any of them", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const { handlers, call, post } = world;
      const codes: string[] = [];
      const refused = (reply: Reply) => {
        expect(reply.json.error, reply.text).toBeDefined();
        codes.push(reply.json.error.code);
        return reply;
      };
      const slot = { content_type: "audio/webm", expected_bytes: AUDIO.byteLength };
      const roundBody = { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: await world.general() };

      // POST /api/rounds.
      refused(await post(handlers.round, { ...roundBody, cv_version_id: crypto.randomUUID() }));
      refused(await post(handlers.round, { ...roundBody, role_context_id: crypto.randomUUID() }));
      refused(await post(createPostRound({ ...world.base, health: fakeModelHealth(false), scorer: world.scorer }), roundBody));

      // An earlier round, abandoned by the one the rest of the walk uses.
      const abandonedId = await world.startRound();
      const abandonedAnswer = await world.upload(abandonedId);
      await call(handlers.transcribe, abandonedAnswer, {});
      const roundId = await world.startRound();
      refused(await call(handlers.open, abandonedId, slot));
      refused(await call(handlers.submit, abandonedAnswer, { transcript_corrected: CORRECTED }));
      refused(await call(handlers.complete, abandonedId, { felt_pressure: 3 }));

      // POST …/answers.
      refused(await call(handlers.open, roundId, { ...slot, content_type: "audio/mp4" }));
      refused(await call(handlers.open, roundId, { ...slot, expected_bytes: 20 * 1024 * 1024 + 1 }));
      world.store.failPresign = true;
      const presign = refused(await call(handlers.open, roundId, slot));
      world.store.failPresign = false;
      const answerId = presign.json.error.detail.answer_id as string;

      // transcribe, with no take, then with one the transcriber cannot read; then the typed answer.
      refused(await call(handlers.transcribe, answerId, {}));
      await call(handlers.open, roundId, slot);
      world.store.put(world.store.presigned.at(-1)!.key, AUDIO);
      refused(await call(handlers.submit, answerId, { transcript_corrected: CORRECTED }));
      const working = world.transcriber.transcribe;
      world.transcriber.transcribe = async () => {
        throw new ModelCallFailed("Transcription", "project_spend_limit_exceeded");
      };
      refused(await call(handlers.transcribe, answerId, {}));
      world.transcriber.transcribe = working;
      refused(await call(handlers.typed, answerId, { source: "typed", text: "" }));
      expect((await call(handlers.typed, answerId, { source: "typed", text: TYPED })).status).toBe(201);
      refused(await call(handlers.typed, answerId, { source: "typed", text: `${TYPED} And more.` }));
      refused(await call(handlers.open, roundId, slot));

      // submit: a follow-up that cannot be generated, then a different body.
      const generating = world.followUps.generate;
      world.followUps.generate = async () => {
        throw new ModelCallFailed("Follow-up generation", "upstream_400");
      };
      refused(await call(handlers.submit, answerId, { transcript_corrected: CORRECTED }));
      world.followUps.generate = generating;
      refused(await call(handlers.submit, answerId, { transcript_corrected: `${CORRECTED} And more.` }));

      // complete and feedback, before the round is answered.
      refused(await call(handlers.complete, roundId, {}));
      refused(await call(handlers.complete, roundId, { felt_pressure: 3 }));
      refused(await call(handlers.feedback, roundId, {}));
      refused(await world.read(roundId, "?include=scores"));
      refused(await world.read(crypto.randomUUID()));

      // The rest of the round, with one answer the scorer cannot score, then every refusal after the end.
      await world.answerCurrent(roundId);
      await world.answerCurrent(roundId);
      await world.answerCurrent(roundId);
      await world.answerCurrent(roundId);
      world.scorer.score = async () => {
        throw new ModelCallFailed("Scoring", "upstream_500");
      };
      await world.drainAfter();
      refused(await call(handlers.complete, roundId, { felt_pressure: 3 }));
      expect((await call(handlers.complete, roundId, { felt_pressure: 3 })).status).toBe(200);
      refused(await call(handlers.feedback, roundId, {}));
      refused(await call(handlers.open, roundId, slot));

      expect(new Set(codes)).toEqual(
        new Set([
          "invalid_request",
          "not_found",
          "model_unavailable",
          "round_abandoned",
          "unsupported_content_type",
          "upload_too_large",
          "presign_failed",
          "audio_missing",
          "transcription_failed",
          "transcript_already_final",
          "answer_already_submitted",
          "followup_generation_failed",
          "pressure_required",
          "round_not_complete",
          "feedback_generation_failed",
          "round_already_complete",
        ]),
      );

      // The CV's own text is on the never-log list too: every claim of the version the round is scored against.
      const claims = await db.select({ text: s.cvClaims.textNormalised }).from(s.cvClaims);
      expect(claims.length).toBeGreaterThan(0);
      const forbidden = [RAW_SENTINEL, CORRECTED_SENTINEL, TYPED_SENTINEL, FOLLOW_UP_SENTINEL, ...claims.map((claim) => claim.text)];
      const envelopes = world.responses.filter((text) => text.includes('"error"'));
      expect(envelopes.length).toBe(codes.length);
      for (const text of [...envelopes, ...logged]) for (const sentinel of forbidden) expect(text).not.toContain(sentinel);
      // And the sentinels were really there to leak: each was returned to its owner by the route that owns it.
      for (const sentinel of [RAW_SENTINEL, TYPED_SENTINEL, FOLLOW_UP_SENTINEL]) {
        expect(world.responses.some((text) => text.includes(sentinel))).toBe(true);
      }
    }));
});

describe("a spent OpenAI project (12 §6, 06 2026-09-27 confirm 5)", () => {
  it("refuses the round at the preflight as 503 model_unavailable, and creates nothing", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const health = {
        modelId: "fake-scorer-2026-01-01",
        check: async () => ({ ok: false as const, latencyMs: 1, errorClass: "project_spend_limit_exceeded" }),
      };
      const body = { round_type: "hr", language: "en", mode: "realistic", length: 3, role_context_id: await world.general() };
      const response = await world.post(createPostRound({ ...world.base, health, scorer: world.scorer }), body);
      expect(response.status).toBe(503);
      expect(response.json.error).toMatchObject({ code: "model_unavailable", detail: { error_class: "project_spend_limit_exceeded" } });
      expect(await count(db, s.rounds)).toBe(0);
    }));

  it("fails a score at once, with none of its three retries spent on a wait that cannot clear it", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const slept: number[] = [];
      world.scorer.score = async () => {
        throw new ModelCallFailed("Scoring", "project_spend_limit_exceeded");
      };
      const { submitted } = await world.answerCurrent(roundId);
      const outcome = await runScoringAttempt({ ...world.scoring, sleep: async (ms) => void slept.push(ms) }, submitted.json.scoring.attempt_id, {
        deadline: Date.now() + 280_000,
      });
      expect(outcome).toBe("failed");
      expect(slept).toEqual([]);
      const [attempt] = await db.select().from(s.scoringAttempts).where(eq(s.scoringAttempts.id, submitted.json.scoring.attempt_id));
      expect(attempt).toMatchObject({ status: "failed", errorClass: "project_spend_limit_exceeded" });
    }));

  it("still retries an ordinary rate limit", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      const slept: number[] = [];
      let calls = 0;
      world.scorer.score = async (input) => {
        calls += 1;
        if (calls === 1) throw new ModelCallFailed("Scoring", "upstream_429");
        return uniformScores(3)(input);
      };
      const { submitted } = await world.answerCurrent(roundId);
      const outcome = await runScoringAttempt({ ...world.scoring, sleep: async (ms) => void slept.push(ms) }, submitted.json.scoring.attempt_id, {
        deadline: Date.now() + 280_000,
      });
      expect(outcome).toBe("ok");
      expect(slept).toEqual([2_000]);
    }));

  it("does not retry the follow-up either: the hole is recorded after one call", () =>
    inRolledBackTransaction(async (db) => {
      const world = await setUp(db);
      const roundId = await world.startRound();
      world.followUps.generate = async () => {
        world.followUps.calls += 1;
        throw new ModelCallFailed("Follow-up generation", "project_spend_limit_exceeded");
      };
      const { answerId, submitted } = await world.answerCurrent(roundId);
      expect(submitted.status).toBe(502);
      expect(world.followUps.calls).toBe(1);
      const [row] = await db.select().from(s.followUps).where(eq(s.followUps.parentAnswerId, answerId));
      expect(row).toMatchObject({ status: "missing", errorClass: "project_spend_limit_exceeded" });
    }));
});
