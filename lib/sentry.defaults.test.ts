import { afterAll, expect, it } from "vitest";
import { initCapturing, SENTINELS, startFailingApp } from "./test/sentry-request";

// The control for sentry.test.ts: with the SDK's own defaults the same request does carry its body,
// so the assertion there that no sentinel arrives is one that can fail.
const sent = initCapturing({});
const app = await startFailingApp();
afterAll(() => app.close());

it("leaks the request body with the SDK's defaults", async () => {
  expect((await app.request()).status).toBe(500);
  const serialized = JSON.stringify(sent);
  expect(serialized).toContain("Scoring failed");
  expect(serialized).toContain(SENTINELS.transcript);
});
