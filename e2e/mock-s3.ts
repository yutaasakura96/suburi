import { createServer, type Server } from "node:http";
import { MOCK_S3_PORT } from "./database";

// The e2e server's bucket (playwright.config.ts points S3_ENDPOINT here). Path-style, as the SDK
// addresses a custom endpoint: `/{bucket}/{key}`. The browser's presigned PUT lands here directly,
// so it answers CORS for the server's origin, as the real bucket does (12 §3, step 4): PUT and GET,
// the one header content-type. HEAD is the server's own check that a recording exists before it
// presigns a playback URL (07 §5.14). Signatures are not checked — the unit tests own the presign.

export interface MockS3 {
  /** Every object, by key without the bucket. */
  readonly objects: Map<string, { contentType: string | undefined; bytes: number }>;
  close(): Promise<void>;
}

const ORIGIN = "http://localhost:3100";

export async function startMockS3(): Promise<MockS3> {
  const objects: MockS3["objects"] = new Map();
  const bodies = new Map<string, Buffer>();
  const server: Server = createServer((request, response) => {
    const cors = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "PUT, GET",
      "access-control-allow-headers": "content-type",
    };
    const url = new URL(request.url ?? "/", "http://localhost");
    // `/{bucket}/{key...}`: the key is everything after the bucket.
    const key = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));

    if (request.method === "OPTIONS") {
      response.writeHead(204, cors).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "PUT") {
        const body = Buffer.concat(chunks);
        bodies.set(key, body);
        objects.set(key, { contentType: request.headers["content-type"], bytes: body.byteLength });
        response.writeHead(200, { ...cors, etag: '"e2e"' }).end();
        return;
      }
      if (request.method === "HEAD") {
        const body = bodies.get(key);
        // A HEAD carries no body, so no error document either: the status is the whole answer.
        if (!body) response.writeHead(404, cors).end();
        else response.writeHead(200, { ...cors, "content-type": objects.get(key)?.contentType ?? "application/octet-stream", "content-length": body.byteLength }).end();
        return;
      }
      if (request.method === "GET") {
        const body = bodies.get(key);
        if (!body) {
          response.writeHead(404, { ...cors, "content-type": "application/xml" });
          response.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`);
          return;
        }
        response.writeHead(200, { ...cors, "content-type": objects.get(key)?.contentType ?? "application/octet-stream", "content-length": body.byteLength });
        response.end(body);
        return;
      }
      response.writeHead(405, cors).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(MOCK_S3_PORT, "localhost", resolve));
  return {
    objects,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
