import { TTS_MODEL, TTS_VOICE } from "./models.ts";
import type { CallOptions } from "./score.ts";
import { ModelCallFailed, OPENAI_BASE_URL } from "./upstream.ts";

/**
 * The text-to-speech port (03 §4): one prompt of a round, spoken, as a stream of WAV. The audio is
 * synthesised when the question is asked and **never retained** — nothing here stores, caches or logs
 * it, or the text it was made from. One real implementation and a fake.
 *
 * The stream yields nothing until the first audio arrives, and every failure before that rejects as a
 * `ModelCallFailed` on the first read, so the route can still answer `502 speech_failed` (07 §5.15).
 */

export interface SpeechInput {
  readonly text: string;
  readonly language: "ja" | "en";
}

export interface SpeechSynthesizer {
  readonly modelId: string;
  synthesize(input: SpeechInput, options?: CallOptions): Promise<ReadableStream<Uint8Array>>;
}

/** What 07 §5.15 answers with. */
export const SPEECH_CONTENT_TYPE = "audio/wav";

/** The Realtime API's PCM: mono, signed 16-bit little-endian, at this rate (its WebSocket guide). */
const SAMPLE_RATE = 24_000;

// The model is a conversational one asked to recite, so it is told what a question read by an
// interviewer is not: a reply, a paraphrase, or a performance. Naming the language keeps a Japanese
// question with an English company name in it from being read as English.
const INSTRUCTIONS: Record<SpeechInput["language"], string> = {
  en: "You are the voice of an interviewer. Each user message is an interview question. Read it aloud in English, exactly as written, as a calm and neutral interviewer would ask it. Add nothing, omit nothing, and do not answer it.",
  ja: "You are the voice of an interviewer. Each user message is an interview question. Read it aloud in standard Japanese, exactly as written, as a calm and polite interviewer would ask it. Add nothing, omit nothing, and do not answer it.",
};

/**
 * A WAV header for a stream whose length is not known when it starts: both sizes are the largest a
 * RIFF file can state, which a browser reads as "until the stream ends".
 */
export function wavStreamHeader() {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) header.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  header.setUint32(4, 0xffffffff, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, SAMPLE_RATE, true);
  header.setUint32(28, SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, 0xffffffff, true);
  return new Uint8Array(header.buffer);
}

/** A whole stream, written as a file: its sizes filled in, so a player can show a duration and seek. */
export function sizedWav(wav: Uint8Array) {
  const sized = new Uint8Array(wav);
  const view = new DataView(sized.buffer);
  view.setUint32(4, sized.byteLength - 8, true);
  view.setUint32(40, sized.byteLength - 44, true);
  return sized;
}

/** `wss://api.openai.com/v1/realtime?model=…`; the e2e mock is plain `ws:` on a local host. */
export function realtimeUrl(baseURL: string) {
  const url = new URL(baseURL);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/realtime`;
  url.searchParams.set("model", TTS_MODEL);
  return url;
}

/** An error event's code, as a class safe to log: OpenAI's identifier, never its message. */
function realtimeErrorClass(event: { error?: { code?: unknown; type?: unknown } }) {
  const code = event.error?.code ?? event.error?.type;
  return typeof code === "string" && /^[a-z0-9_]{1,64}$/u.test(code) ? `upstream_${code}` : "upstream_error";
}

/**
 * The Realtime API (`gpt-realtime-2.1-mini`, 06, 2026-10-14) over a server-side WebSocket: one session
 * per prompt, one out-of-band response to the prompt as a user message, its audio deltas relayed as
 * they arrive behind a WAV header. `timeoutMs` bounds each wait for the next event.
 */
export function openAiSpeechSynthesizer({ apiKey, baseURL = OPENAI_BASE_URL }: { apiKey: string; baseURL?: string }): SpeechSynthesizer {
  return {
    modelId: TTS_MODEL,
    async synthesize({ text, language }, { signal, timeoutMs = 120_000 } = {}) {
      if (signal?.aborted) throw new ModelCallFailed("Speech", "aborted");
      // Node's WebSocket takes request headers, which the DOM's type does not declare.
      const socket = new WebSocket(realtimeUrl(baseURL), {
        headers: { Authorization: `Bearer ${apiKey}` },
      } as unknown as string[]);
      let settled = false;
      let started = false;
      let idle: ReturnType<typeof setTimeout> | undefined;
      let fail: (errorClass: string) => void = () => {};

      const finish = () => {
        settled = true;
        clearTimeout(idle);
        signal?.removeEventListener("abort", onAbort);
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
      };
      const onAbort = () => fail("aborted");
      const send = (event: object) => socket.send(JSON.stringify(event));

      return new ReadableStream<Uint8Array>({
        start(controller) {
          fail = (errorClass) => {
            if (settled) return;
            finish();
            controller.error(new ModelCallFailed("Speech", errorClass));
          };
          const waitForNext = () => {
            clearTimeout(idle);
            idle = setTimeout(() => fail("upstream_timeout"), timeoutMs);
          };
          signal?.addEventListener("abort", onAbort);
          waitForNext();

          socket.addEventListener("open", () => {
            send({
              type: "session.update",
              session: {
                type: "realtime",
                instructions: INSTRUCTIONS[language],
                output_modalities: ["audio"],
                audio: { output: { format: { type: "audio/pcm", rate: SAMPLE_RATE }, voice: TTS_VOICE } },
              },
            });
            send({
              type: "response.create",
              response: {
                conversation: "none",
                input: [{ type: "message", role: "user", content: [{ type: "input_text", text }] }],
              },
            });
          });
          socket.addEventListener("message", (message: MessageEvent) => {
            if (settled) return;
            waitForNext();
            let event: { type?: unknown; delta?: unknown; response?: { status?: unknown }; error?: { code?: unknown; type?: unknown } };
            try {
              event = JSON.parse(String(message.data));
            } catch {
              return fail("malformed_output");
            }
            if (event.type === "error") return fail(realtimeErrorClass(event));
            if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
              const audio = Uint8Array.from(Buffer.from(event.delta, "base64"));
              if (audio.byteLength === 0) return;
              if (!started) {
                started = true;
                controller.enqueue(wavStreamHeader());
              }
              controller.enqueue(audio);
              return;
            }
            if (event.type === "response.done") {
              const status = event.response?.status;
              if (status !== "completed") return fail(typeof status === "string" ? `response_${status}` : "malformed_output");
              if (!started) return fail("empty_audio");
              finish();
              controller.close();
            }
          });
          // A refused handshake (a bad key, a spent budget) arrives as an error with no status to read.
          socket.addEventListener("error", () => fail(started ? "stream_interrupted" : "upstream_unreachable"));
          socket.addEventListener("close", () => fail("stream_interrupted"));
        },
        cancel() {
          if (!settled) finish();
        },
      });
    },
  };
}
