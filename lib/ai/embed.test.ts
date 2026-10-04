import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openAiEmbedder } from "./embed";
import { EMBEDDING_DIMENSIONS } from "./models";

describe("OpenAI embeddings", () => {
  const vector = (value: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
  let indexes = [1, 0];
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      object: "list",
      data: indexes.map((index, position) => ({ object: "embedding", index, embedding: vector(position + 1) })),
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }));
  });
  let embedder: ReturnType<typeof openAiEmbedder>;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing mock address");
    embedder = openAiEmbedder({ apiKey: "test", baseURL: `http://127.0.0.1:${address.port}/v1` });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("pairs out-of-order vectors with their input indexes", async () => {
    indexes = [1, 0];
    expect(await embedder.embed(["first", "second"])).toEqual([vector(2), vector(1)]);
  });

  it.each([[0, 0], [0, 2], [-1, 1]])("refuses malformed indexes %j", async (first, second) => {
    indexes = [first, second];
    await expect(embedder.embed(["first", "second"])).rejects.toMatchObject({ errorClass: "malformed_output" });
  });
});
