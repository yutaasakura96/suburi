import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { TTS_MODEL, TTS_VOICE } from "./models";
import { openAiSpeechSynthesizer, realtimeUrl, sizedWav, wavStreamHeader } from "./tts";

async function readAll(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    chunks.push(value);
  }
}

describe("the Realtime speech synthesizer", () => {
  // What the next session answers its response.create with; a no-op holds it open and says nothing.
  let answer: (socket: ServerSocket) => void = () => {};
  const seen: { url: string; authorization: string | undefined; events: { type: string; [key: string]: unknown }[] }[] = [];
  let server: WebSocketServer;
  let synthesizer: ReturnType<typeof openAiSpeechSynthesizer>;
  const emit = (socket: ServerSocket, event: object) => socket.send(JSON.stringify(event));
  const delta = (socket: ServerSocket, bytes: number[]) =>
    emit(socket, { type: "response.output_audio.delta", delta: Buffer.from(bytes).toString("base64") });

  beforeAll(async () => {
    server = await new Promise<WebSocketServer>((resolve) => {
      const listening: WebSocketServer = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/v1/realtime" }, () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing mock address");
    synthesizer = openAiSpeechSynthesizer({ apiKey: "test", baseURL: `http://127.0.0.1:${address.port}/v1` });
    server.on("connection", (socket, request) => {
      const session = { url: request.url ?? "", authorization: request.headers.authorization, events: [] as never[] };
      seen.push(session);
      socket.on("message", (data) => {
        const event = JSON.parse(String(data));
        (session.events as unknown[]).push(event);
        if (event.type === "response.create") answer(socket);
      });
    });
  });

  afterAll(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("speaks the prompt in the pinned model and voice, and streams it as WAV behind one header", async () => {
    answer = (socket) => {
      delta(socket, [1, 2]);
      delta(socket, [3, 4]);
      emit(socket, { type: "response.done", response: { status: "completed" } });
    };
    const audio = await readAll(await synthesizer.synthesize({ text: "Why this role?", language: "en" }));

    expect(audio).toEqual(Buffer.concat([wavStreamHeader(), Buffer.from([1, 2, 3, 4])]));
    const session = seen.at(-1)!;
    expect(session.url).toBe(`/v1/realtime?model=${TTS_MODEL}`);
    expect(session.authorization).toBe("Bearer test");
    expect(session.events.map((event) => event.type)).toEqual(["session.update", "response.create"]);
    expect(session.events[0]).toMatchObject({
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: { output: { format: { type: "audio/pcm", rate: 24_000 }, voice: TTS_VOICE } },
      },
    });
    expect(session.events[1]).toMatchObject({
      response: { conversation: "none", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Why this role?" }] }] },
    });
  });

  it("names the language in the instructions", async () => {
    answer = (socket) => {
      delta(socket, [1, 2]);
      emit(socket, { type: "response.done", response: { status: "completed" } });
    };
    await readAll(await synthesizer.synthesize({ text: "志望動機を教えてください。", language: "ja" }));
    const update = seen.at(-1)!.events[0] as unknown as { session: { instructions: string } };
    expect(update.session.instructions).toContain("standard Japanese");
  });

  it("writes a WAV header for an open-ended stream: RIFF, PCM, mono, 24 kHz, 16-bit, sizes unknown", () => {
    const header = Buffer.from(wavStreamHeader());
    expect(header.toString("ascii", 0, 4)).toBe("RIFF");
    expect(header.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(header.readUInt16LE(20)).toBe(1);
    expect(header.readUInt16LE(22)).toBe(1);
    expect(header.readUInt32LE(24)).toBe(24_000);
    expect(header.readUInt16LE(34)).toBe(16);
    expect(header.toString("ascii", 36, 40)).toBe("data");
    expect(header.readUInt32LE(40)).toBe(0xffffffff);
  });

  it("fills in a finished stream's sizes for a file, leaving the stream itself untouched", () => {
    const stream = Buffer.concat([wavStreamHeader(), Buffer.from([1, 2, 3, 4])]);
    const file = Buffer.from(sizedWav(stream));
    expect(file.readUInt32LE(4)).toBe(40);
    expect(file.readUInt32LE(40)).toBe(4);
    expect(stream.readUInt32LE(40)).toBe(0xffffffff);
  });

  it.each([
    ["an error event, by its code", (socket: ServerSocket) => emit(socket, { type: "error", error: { type: "invalid_request_error", code: "session_expired", message: "The prompt text would be here" } }), "upstream_session_expired"],
    ["an error code that is not an identifier", (socket: ServerSocket) => emit(socket, { type: "error", error: { code: "Bad thing: text" } }), "upstream_error"],
    ["a response that did not complete", (socket: ServerSocket) => emit(socket, { type: "response.done", response: { status: "failed" } }), "response_failed"],
    ["a completed response with no audio", (socket: ServerSocket) => emit(socket, { type: "response.done", response: { status: "completed" } }), "empty_audio"],
    ["a closed socket", (socket: ServerSocket) => socket.close(), "stream_interrupted"],
    ["an event that is not JSON", (socket: ServerSocket) => socket.send("not json"), "malformed_output"],
  ])("fails the first read before any byte on %s", async (_name, respond, errorClass) => {
    answer = respond;
    const stream = await synthesizer.synthesize({ text: "Why this role?", language: "en" });
    await expect(stream.getReader().read()).rejects.toMatchObject({ name: "ModelCallFailed", errorClass });
  });

  it("fails as a timeout when the session goes quiet", async () => {
    answer = () => {};
    const stream = await synthesizer.synthesize({ text: "Why this role?", language: "en" }, { timeoutMs: 50 });
    await expect(stream.getReader().read()).rejects.toMatchObject({ errorClass: "upstream_timeout" });
  });

  it("fails as aborted when its caller aborts, and closes the session", async () => {
    answer = () => {};
    const abort = new AbortController();
    const stream = await synthesizer.synthesize({ text: "Why this role?", language: "en" }, { signal: abort.signal });
    const read = stream.getReader().read();
    abort.abort();
    await expect(read).rejects.toMatchObject({ errorClass: "aborted" });
  });

  it("is unreachable when nothing answers the handshake", async () => {
    const unreachable = openAiSpeechSynthesizer({ apiKey: "test", baseURL: "http://127.0.0.1:1/v1" });
    const stream = await unreachable.synthesize({ text: "Why this role?", language: "en" });
    await expect(stream.getReader().read()).rejects.toMatchObject({ errorClass: "upstream_unreachable" });
  });

  it("reaches OpenAI over wss", () => {
    expect(realtimeUrl("https://api.openai.com/v1").toString()).toBe(`wss://api.openai.com/v1/realtime?model=${TTS_MODEL}`);
  });
});
