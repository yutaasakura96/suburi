import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// A local stand-in for OpenAI's Responses API, for tests that run a real port's parse and checks
// against a mocked model response (11 §2: no test calls OpenAI). Every POST /v1/responses is answered
// with what `respond` returns for its body, as the model's structured output; nothing else is served.
// `before` adds output items ahead of the message — a research call's `web_search_call`s, say.

export interface MockResponses {
  /** The `baseURL` a port is built with. */
  readonly baseURL: string;
  /** Each request body, in the order they came. */
  readonly requests: Record<string, unknown>[];
  close(): Promise<void>;
}

export async function startMockResponses(
  respond: (body: Record<string, unknown>) => object,
  before: (body: Record<string, unknown>) => object[] = () => [],
): Promise<MockResponses> {
  const requests: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      requests.push(body);
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: "resp_test",
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "completed",
          model: body.model,
          output: [
            ...before(body),
            {
              id: "msg_test",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: JSON.stringify(respond(body)), annotations: [] }],
            },
          ],
          usage: { input_tokens: 900, output_tokens: 120, total_tokens: 1_020 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
