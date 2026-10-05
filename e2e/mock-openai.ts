import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { EMBEDDING_DIMENSIONS } from "../lib/ai/models";
import { MOCK_OPENAI_PORT } from "./database";

// The e2e server's OpenAI (playwright.config.ts points OPENAI_BASE_URL here). No test calls OpenAI
// (11 §2); this answers the Responses API in its shape, as far as the SDK's parse reads it, and
// records what it was sent so a spec can assert on the real extractor's request.

export interface MockOpenAi {
  readonly requests: { path: string; authorization: string | undefined; body: Record<string, unknown> }[];
  close(): Promise<void>;
}

export function responsesApiBody(payload: object) {
  return {
    id: "resp_e2e",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: "gpt-5.6-sol",
    output: [
      {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(payload), annotations: [] }],
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

/** A response the mock sends instead of a model's output, for a spec that needs the call to fail. */
export interface MockFailure {
  readonly fail: number;
  /** The error's `code`, as OpenAI names one: a spent project is a 429 `project_spend_limit_exceeded`. */
  readonly code?: string;
}

export interface MockOpenAiOptions {
  /** `POST /v1/audio/transcriptions`, answered as gpt-transcribe does, duration included. */
  readonly transcription?: () => { text: string; seconds: number } | MockFailure;
  /** `GET /v1/models/{id}`, the round's preflight: a failure to send in place of the model, or null. */
  readonly preflight?: () => MockFailure | null;
  /** `POST /v1/audio/speech`, answered with MP3 as the speech endpoint does. Its JSON body is recorded. */
  readonly speech?: () => Uint8Array | MockFailure;
}

/**
 * Half a second of silence a browser will really play: twenty MPEG-1 Layer III frames at 128 kbps and
 * 44.1 kHz, each a header and an all-zero body. The spoken question's audio is never asserted on
 * (11 §9) — only that it was asked for and played without an error.
 */
export function silentMp3() {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const audio = new Uint8Array(frame.length * 20);
  for (let index = 0; index < 20; index += 1) audio.set(frame, index * frame.length);
  return audio;
}

/**
 * As many questions as the generator was asked for — what a spec answers a `generated_questions`
 * request with. Tagged and numbered, so no two calls write the same question, in this worker or the
 * next.
 */
const RUN = randomUUID().slice(0, 8);
let generated = 0;
export function generatedQuestions(body: Record<string, unknown>) {
  const count = Number(/=== questions needed ===\n(\d+)/.exec(String(body.input))?.[1] ?? 0);
  return { questions: Array.from({ length: count }, () => `Generated e2e question ${RUN}-${(generated += 1)}?`) };
}

/**
 * A unit vector that depends on the text alone: the same text embeds the same way, and two texts are
 * as good as orthogonal, so nothing the mock embeds is anything else's near-duplicate.
 */
export function mockEmbedding(text: string) {
  let state = createHash("sha256").update(text).digest().readUInt32LE(0) || 1;
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, () => {
    // xorshift32: spread enough for a direction, and the same on every machine.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff - 0.5;
  });
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

/**
 * Answers every POST /v1/responses with `payload` as the model's structured output — or, given a
 * function, with what it returns for that request's body, so a spec can answer each extraction
 * window (#29) with that window's claims, or each round-loop call by its format. `GET /v1/models/{id}`
 * — the round's preflight — answers unless `preflight` says otherwise, and `POST /v1/embeddings` always
 * does, with a vector per input that is unlike every other. A multipart body (a transcription) is
 * recorded as `{}`.
 */
export async function startMockOpenAi(
  payload: object | ((body: Record<string, unknown>) => object | MockFailure | Promise<object | MockFailure>),
  options: MockOpenAiOptions = {},
): Promise<MockOpenAi> {
  const requests: MockOpenAi["requests"] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", async () => {
      const json = request.headers["content-type"]?.startsWith("application/json") ?? false;
      const body: Record<string, unknown> = json && raw ? JSON.parse(raw) : {};
      const path = request.url ?? "";
      requests.push({ path, authorization: request.headers.authorization, body });
      const send = (status: number, value: object) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      const failed = (value: object): value is MockFailure => "fail" in value;
      const refuse = ({ fail, code }: MockFailure) =>
        send(fail, { error: { message: "mock failure", type: code ? "insufficient_quota" : "server_error", code: code ?? null } });

      if (request.method === "GET" && path.startsWith("/v1/models/")) {
        const refusal = options.preflight?.() ?? null;
        if (refusal) {
          refuse(refusal);
          return;
        }
        send(200, { id: decodeURIComponent(path.slice("/v1/models/".length)), object: "model", created: 0, owned_by: "e2e" });
        return;
      }
      if (request.method === "POST" && path === "/v1/audio/transcriptions" && options.transcription) {
        const result = options.transcription();
        if (failed(result)) refuse(result);
        else send(200, { text: result.text, usage: { type: "duration", seconds: result.seconds } });
        return;
      }
      if (request.method === "POST" && path === "/v1/audio/speech" && options.speech) {
        const result = options.speech();
        if (failed(result)) send(result.fail, { error: { message: "mock failure", type: "server_error" } });
        else response.writeHead(200, { "content-type": "audio/mpeg" }).end(Buffer.from(result));
        return;
      }
      if (request.method === "POST" && path === "/v1/embeddings") {
        const data = (body.input as string[]).map((text, index) => ({ object: "embedding", index, embedding: mockEmbedding(text) }));
        send(200, { object: "list", data, model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } });
        return;
      }
      if (request.method !== "POST" || path !== "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      const result = typeof payload === "function" ? payload(body) : payload;
      if (failed(result)) refuse(result);
      else send(200, responsesApiBody(result));
    });
  });
  await new Promise<void>((resolve) => server.listen(MOCK_OPENAI_PORT, "localhost", resolve));
  return {
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
