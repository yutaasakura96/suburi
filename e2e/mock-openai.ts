import { createServer, type Server } from "node:http";
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

/**
 * Answers every POST /v1/responses with `payload` as the model's structured output — or, given a
 * function, with what it returns for that request's body, so a spec can answer each extraction
 * window (#29) with that window's claims.
 */
export async function startMockOpenAi(payload: object | ((body: Record<string, unknown>) => object)): Promise<MockOpenAi> {
  const requests: MockOpenAi["requests"] = [];
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body: Record<string, unknown> = raw ? JSON.parse(raw) : {};
      requests.push({ path: request.url ?? "", authorization: request.headers.authorization, body });
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(responsesApiBody(typeof payload === "function" ? payload(body) : payload)));
    });
  });
  await new Promise<void>((resolve) => server.listen(MOCK_OPENAI_PORT, "localhost", resolve));
  return {
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
