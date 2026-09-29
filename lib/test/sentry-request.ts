import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as Sentry from "@sentry/nextjs";

// Recognisable text standing in for what 12 §7 never lets reach Sentry (11 §3.10).
export const SENTINELS = {
  transcript: "ZEBRA-TRANSCRIPT-5813",
  cv: "ZEBRA-CV-TEXT-2209",
  notes: "ZEBRA-COMPANY-NOTES-7340",
};

// The SDK binds a request's scope to the first client, so a test file inits Sentry once: the
// scrubbed configuration and the SDK's defaults each have their own file.
export function initCapturing(options: object): unknown[] {
  const sent: unknown[] = [];
  Sentry.init({
    ...options,
    dsn: "https://0123456789abcdef@o1.ingest.sentry.io/2",
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  return sent;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(body));
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }),
  );
}

// A request whose body carries the sentinels, an outgoing call that sends and receives them, as an
// answer's trip to a model does, and an exception thrown while handling it, reported the way Next.js
// reports it (instrumentation.ts's onRequestError).
export async function startFailingApp() {
  const upstream = createServer(async (request, response) => {
    await readBody(request);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ corrected: SENTINELS.transcript }));
  });
  const upstreamUrl = `${await listen(upstream)}/v1/responses`;

  const app = createServer(async (request, response) => {
    const { transcript } = JSON.parse(await readBody(request)) as typeof SENTINELS;
    await fetch(upstreamUrl, { method: "POST", body: transcript }).then((r) => r.text());
    try {
      throw new Error("Scoring failed: pg_23514");
    } catch (error) {
      Sentry.captureRequestError(
        error,
        { path: request.url ?? "", method: request.method ?? "", headers: request.headers },
        { routerKind: "App Router", routePath: "/api/rounds/[id]/answers", routeType: "route" },
      );
    }
    response.statusCode = 500;
    response.end();
  });
  const appUrl = await listen(app);

  return {
    async request(): Promise<Response> {
      const response = await fetch(`${appUrl}/api/rounds/1/answers?draft=1`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "session=secret" },
        body: JSON.stringify(SENTINELS),
      });
      await Sentry.flush(2000);
      return response;
    },
    async close() {
      await new Promise((resolve) => app.close(resolve));
      await new Promise((resolve) => upstream.close(resolve));
    },
  };
}
