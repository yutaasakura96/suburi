import { afterAll, describe, expect, it } from "vitest";
import { httpIntegration } from "@sentry/node";
import { scrubBreadcrumb, scrubEvent, sentryOptions } from "./sentry";
import { initCapturing, SENTINELS, startFailingApp } from "./test/sentry-request";

// The real SDK with this app's configuration, inited once for the file (lib/test/sentry-request.ts).
const sent = initCapturing(sentryOptions(
  { dsn: "unused", environment: "develop" },
  httpIntegration({ sessions: false, disableIncomingRequestSpans: true }),
));
const app = await startFailingApp();
afterAll(() => app.close());

function expectNoSentinel(serialized: string) {
  for (const sentinel of Object.values(SENTINELS)) expect(serialized).not.toContain(sentinel);
}

describe("Sentry integrations", () => {
  it("removes release-health integrations in every runtime and replaces Node HTTP", () => {
    const defaults = [
      { name: "BrowserSession" },
      { name: "ProcessSession" },
      { name: "Http" },
      { name: "GlobalHandlers" },
    ];
    const config = { dsn: "unused", environment: "develop" };
    expect(sentryOptions(config).integrations(defaults).map(({ name }) => name)).toEqual([
      "Http",
      "GlobalHandlers",
    ]);

    const http = httpIntegration({ sessions: false, disableIncomingRequestSpans: true });
    const server = sentryOptions(config, http).integrations(defaults);
    expect(server.map(({ name }) => name)).toEqual(["GlobalHandlers", "Http"]);
    expect(server.at(-1)).toBe(http);
  });
});

describe("scrubBreadcrumb", () => {
  it.each(["fetch", "xhr", "http"])("keeps only method, URL and status on a %s breadcrumb", (category) => {
    const scrubbed = scrubBreadcrumb({
      category,
      data: {
        method: "POST",
        url: "https://bucket.s3.amazonaws.com/dev/audio/1.webm?X-Amz-Signature=abc#frag",
        status_code: 200,
        request_body: SENTINELS.transcript,
        response_body: SENTINELS.cv,
        body: SENTINELS.notes,
      },
    });
    expect(scrubbed?.data).toEqual({
      method: "POST",
      url: "https://bucket.s3.amazonaws.com/dev/audio/1.webm",
      status_code: 200,
    });
  });

  it("drops console breadcrumbs, which carry a failed query's parameters", () => {
    expect(scrubBreadcrumb({
      category: "console",
      message: `Failed query: select 1 where token = $1\nparams: ${SENTINELS.notes}`,
    })).toBeNull();
  });

  it("leaves other categories alone", () => {
    const breadcrumb = { category: "navigation", data: { from: "/", to: "/cv" } };
    expect(scrubBreadcrumb(breadcrumb)).toEqual(breadcrumb);
  });
});

describe("scrubEvent", () => {
  it("drops request and response bodies entirely, whatever their shape", () => {
    const scrubbed = scrubEvent({
      type: undefined,
      request: {
        method: "POST",
        url: "https://suburi-develop.vercel.app/api/rounds/1/answers?draft=1",
        data: { transcript: SENTINELS.transcript, nested: { cv: SENTINELS.cv } },
        cookies: { session: "secret" },
        query_string: "draft=1",
      },
      contexts: { response: { status_code: 500, headers: { "x-body": SENTINELS.notes } } },
    });
    expect(scrubbed.request).toEqual({
      method: "POST",
      url: "https://suburi-develop.vercel.app/api/rounds/1/answers",
    });
    expect(scrubbed.contexts?.response).toEqual({ status_code: 500 });
    expectNoSentinel(JSON.stringify(scrubbed));
  });
});

// 11 §3.10: an exception thrown while handling a request whose body carries the sentinels produces
// an event with no sentinel anywhere in it. sentry.defaults.test.ts is the control.
describe("an exception while handling a request", () => {
  it("produces an event with no sentinel anywhere in it", async () => {
    expect((await app.request()).status).toBe(500);
    const serialized = JSON.stringify(sent);
    expect(serialized).toContain("Scoring failed");
    expect(serialized).toContain('"environment":"develop"');
    expectNoSentinel(serialized);
    expect(serialized).not.toContain("session=secret");
    expect(serialized).not.toContain("draft=1");
    const envelopeTypes = (sent as [unknown, [{ type: string }, unknown][]][])
      .flatMap(([, items]) => items.map(([header]) => header.type));
    expect(envelopeTypes).toEqual(["event"]);
  });
});
