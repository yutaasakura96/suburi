import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { seedSyntheticCv } from "../../db/seed-cv";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../../db/seed-questions";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { fakeModelHealth, fakeScorer, fakeSpeechSynthesizer, uniformScores } from "../ai/fake-round-ports";
import type { SpeechInput, SpeechSynthesizer } from "../ai/tts";
import { ModelCallFailed } from "../ai/upstream";
import { RATE_LIMITS } from "../api/rate-limit";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createPostRound } from "./post-round";
import { createPostRoleContext } from "./role-context";
import { createSpeech } from "./speech";
import { promptAt } from "./state";

// The speech route (#45, 07 §5.15) through its handler, against the migrated test database, with a
// real Better Auth session. Only the synthesizer is faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Text a caller might try to have spoken; it must reach neither the synthesizer nor a log line.
const SENTINEL = "ZEBRA-SENTINEL-4545";
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);

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

async function setUp(db: TestDb, respond: (input: SpeechInput) => Uint8Array = () => AUDIO) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  await seedSyntheticCv(db, user.id, "en");
  await seedRubrics(db);
  await seedSetPieces(db, user.id);
  await seedSyntheticQuestions(db, user.id);

  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const base = { auth, db, transaction: <T,>(work: (tx: TestDb) => Promise<T>) => work(db) };
  const speech = fakeSpeechSynthesizer(respond);
  const headers = { "content-type": "application/json", cookie: `${cookie.name}=${cookie.value}` };

  async function startRound(mode: "realistic" | "practice" = "realistic") {
    const context = await createPostRoleContext(base)(
      new Request("http://localhost:3000/api/role-contexts", { method: "POST", headers, body: JSON.stringify({ kind: "general" }) }),
    );
    const created = await createPostRound({ ...base, health: fakeModelHealth(), scorer: fakeScorer(uniformScores(3)) })(
      new Request("http://localhost:3000/api/rounds", {
        method: "POST",
        headers,
        body: JSON.stringify({ round_type: "hr", language: "en", mode, length: 3, role_context_id: (await context.json()).id }),
      }),
    );
    expect(created.status).toBe(201);
    return (await created.json()).round.id as string;
  }

  /** The route over `synthesizer`, for a stream the fake above cannot make. */
  function speakWith(synthesizer: SpeechSynthesizer, roundId: string, query: string, { signedIn = true } = {}) {
    return createSpeech({ ...base, speech: synthesizer })(
      new Request(`http://localhost:3000/api/rounds/${roundId}/speech?${query}`, {
        headers: signedIn ? { cookie: headers.cookie } : {},
      }),
      roundId,
    );
  }
  const speak = (roundId: string, query: string, options?: { signedIn?: boolean }) => speakWith(speech, roundId, query, options);

  return { speech, startRound, speak, speakWith };
}

describe("GET /api/rounds/{id}/speech", () => {
  it("is 401 with no session, and says nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const response = await speak(await startRound(), "position=1&kind=question", { signedIn: false });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("unauthenticated");
      expect(speech.calls).toBe(0);
    }));

  it("streams the prompt at that position, read from round_questions, and keeps nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const roundId = await startRound();
      for (const position of [1, 2, 3]) {
        const response = await speak(roundId, `position=${position}&kind=question`);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("audio/mpeg");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUDIO);
        expect(speech.inputs.at(-1)).toEqual({ text: (await promptAt(db, roundId, position))!.text, language: "en" });
      }
      expect(speech.calls).toBe(3);
      // The line a spoken prompt leaves is ids and a duration: never what was said (03 §8).
      const spoken = logged.map((line) => JSON.parse(line)).filter((line) => line.event === "question_spoken");
      expect(spoken.map((line) => Object.keys(line).sort())).toEqual(
        [1, 2, 3].map(() => ["event", "first_byte_ms", "position", "round_id"]),
      );
      for (const input of speech.inputs) expect(logged.join("\n")).not.toContain(input.text);
    }));

  it("takes no text from the request: a `text` parameter is a 400 and nothing is spoken (07 §1 rule 6)", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const response = await speak(await startRound(), `position=1&kind=question&text=${SENTINEL}`);
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text).error).toMatchObject({ code: "invalid_request", detail: { fields: ["text"] } });
      expect(text).not.toContain(SENTINEL);
      expect(speech.calls).toBe(0);
    }));

  it.each(["", "kind=question", "position=1", "position=0&kind=question", "position=8&kind=question", "position=one&kind=question", "position=1&kind=answer"])(
    "is 400 for the query `%s`",
    (query) =>
      inRolledBackTransaction(async (db) => {
        const { speech, startRound, speak } = await setUp(db);
        const response = await speak(await startRound(), query);
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe("invalid_request");
        expect(speech.calls).toBe(0);
      }),
  );

  it("is 404 for a practice round: practice is text only", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const response = await speak(await startRound("practice"), "position=1&kind=question");
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("not_found");
      expect(speech.calls).toBe(0);
    }));

  it("is 404 for a position the round does not ask, a follow-up that does not exist, and no such round", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const roundId = await startRound();
      for (const [id, query] of [
        [roundId, "position=4&kind=question"],
        [roundId, "position=1&kind=follow_up"],
        ["00000000-0000-4000-8000-000000000000", "position=1&kind=question"],
        ["not-a-uuid", "position=1&kind=question"],
      ]) {
        const response = await speak(id, query);
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe("not_found");
      }
      expect(speech.calls).toBe(0);
    }));

  it("is 502 speech_failed when synthesis fails, logged with the round id, position and error class only", () =>
    inRolledBackTransaction(async (db) => {
      const { startRound, speak } = await setUp(db, () => {
        throw new ModelCallFailed("Speech", "upstream_503");
      });
      const roundId = await startRound();
      const question = (await promptAt(db, roundId, 2))!.text;
      const response = await speak(roundId, "position=2&kind=question");
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text).error).toMatchObject({
        code: "speech_failed",
        detail: { round_id: roundId, position: 2, error_class: "upstream_503" },
      });
      expect(text).not.toContain(question);

      const failures = logged.map((line) => JSON.parse(line)).filter((line) => line.event === "speech_failed");
      expect(failures).toEqual([{ event: "speech_failed", round_id: roundId, position: 2, error_class: "upstream_503" }]);
      expect(logged.join("\n")).not.toContain(question);
    }));

  it.each([
    ["fails before audio", (controller: ReadableStreamDefaultController<Uint8Array>) => controller.error(new Error("upstream reset")), "stream_interrupted"],
    ["ends without audio", (controller: ReadableStreamDefaultController<Uint8Array>) => controller.close(), "empty_audio"],
  ])("returns 502 when the stream %s", (_case, start, errorClass) =>
    inRolledBackTransaction(async (db) => {
      const { startRound, speakWith } = await setUp(db);
      const roundId = await startRound();
      const speech = { modelId: "fake-tts", synthesize: async () => new ReadableStream<Uint8Array>({ start }) };
      const response = await speakWith(speech, roundId, "position=1&kind=question");
      expect(response.status).toBe(502);
      expect((await response.json()).error).toMatchObject({ code: "speech_failed", detail: { error_class: errorClass } });
      expect(logged.map((line) => JSON.parse(line)).filter((line) => line.event === "question_spoken")).toEqual([]);
    }));

  it("times out before the first audio byte and cancels the upstream", () =>
    inRolledBackTransaction(async (db) => {
      const { startRound, speakWith } = await setUp(db);
      const roundId = await startRound();
      let reading: () => void = () => {};
      const enteredRead = new Promise<void>((resolve) => { reading = resolve; });
      let cancelled = false;
      const speech = {
        modelId: "fake-tts",
        synthesize: async () => new ReadableStream<Uint8Array>({
          pull: () => { reading(); return new Promise<void>(() => {}); },
          cancel: () => { cancelled = true; },
        }),
      };
      vi.useFakeTimers();
      try {
        const pending = speakWith(speech, roundId, "position=1&kind=question");
        await enteredRead;
        await vi.advanceTimersByTimeAsync(10_000);
        const response = await pending;
        expect(response.status).toBe(502);
        expect((await response.json()).error).toMatchObject({ code: "speech_failed", detail: { error_class: "upstream_timeout" } });
        expect(cancelled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    }));

  it("logs a stream that breaks after its first byte, when it can no longer be a 502", () =>
    inRolledBackTransaction(async (db) => {
      const { startRound, speakWith } = await setUp(db);
      const roundId = await startRound();
      const broken = {
        modelId: "fake-tts",
        synthesize: async () =>
          new ReadableStream<Uint8Array>({
            start: (controller) => controller.enqueue(AUDIO),
            pull: (controller) => controller.error(new Error("upstream reset")),
          }),
      };
      const response = await speakWith(broken, roundId, "position=1&kind=question");
      expect(response.status).toBe(200);
      await expect(response.arrayBuffer()).rejects.toThrow();
      const failures = logged.map((line) => JSON.parse(line)).filter((line) => line.event === "speech_failed");
      expect(failures).toEqual([{ event: "speech_failed", round_id: roundId, position: 1, error_class: "stream_interrupted" }]);
    }));

  it("stops the upstream, and logs no failure, when the listener leaves mid-question", () =>
    inRolledBackTransaction(async (db) => {
      const { startRound, speakWith } = await setUp(db);
      const roundId = await startRound();
      let upstreamCancelled = false;
      const endless = {
        modelId: "fake-tts",
        synthesize: async () =>
          new ReadableStream<Uint8Array>({
            pull: (controller) => controller.enqueue(AUDIO),
            cancel: () => void (upstreamCancelled = true),
          }),
      };
      const response = await speakWith(endless, roundId, "position=1&kind=question");
      const reader = response.body!.getReader();
      expect((await reader.read()).value).toEqual(AUDIO);
      await reader.cancel();
      expect(upstreamCancelled).toBe(true);
      expect(logged.map((line) => JSON.parse(line)).filter((line) => line.event === "speech_failed")).toEqual([]);
    }));

  it("counts every request in its own bucket, and refuses past the limit with Retry-After", () =>
    inRolledBackTransaction(async (db) => {
      const { speech, startRound, speak } = await setUp(db);
      const roundId = await startRound();
      const { limit } = RATE_LIMITS.speech;
      for (let request = 1; request <= limit; request += 1) {
        expect((await speak(roundId, "position=1&kind=question")).status).toBe(200);
      }
      const refused = await speak(roundId, "position=1&kind=question");
      expect(refused.status).toBe(429);
      expect((await refused.json()).error.code).toBe("rate_limited");
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(speech.calls).toBe(limit);

      const windows = await db.select({ route: s.rateLimitWindows.route, count: s.rateLimitWindows.count }).from(s.rateLimitWindows);
      expect(windows).toContainEqual({ route: "speech", count: limit + 1 });
    }));
});
