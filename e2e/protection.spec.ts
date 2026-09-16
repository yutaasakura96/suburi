import { expect, test } from "@playwright/test";

// docs/11-testing-plan.md §4, route protection, and the sign-in button's wiring. No test calls
// Google: its authorization page is intercepted before the browser leaves this origin.

test("/ without a session lands on /sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
});

test("an /api/* path without a session is 401 with the envelope, not a redirect", async ({
  request,
}) => {
  // No handler exists at this path: the proxy has to refuse it, so a route added later is covered.
  const response = await request.get("/api/no-such-route", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["location"]).toBeUndefined();
  expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
});

test("a refused sign-in shows the refusal line in both languages, and nothing of why", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("status")).toBeEmpty();

  await page.goto("/sign-in?error=account_refused&error_description=anything");
  const status = page.getByRole("status");
  await expect(status).toHaveText(
    "このアカウントではログインできません。This account cannot sign in.",
  );
});

test("the sign-in button starts the Google flow", async ({ page }) => {
  let authorization: URL | undefined;
  await page.route("https://accounts.google.com/**", (route) => {
    authorization = new URL(route.request().url());
    return route.fulfill({ status: 200, body: "intercepted" });
  });

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Googleでログイン" }).click();
  await expect.poll(() => authorization?.pathname).toBe("/o/oauth2/v2/auth");

  expect(authorization?.searchParams.get("state")).toBeTruthy();
  expect(authorization?.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorization?.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/callback\/google$/);

  // The callback refuses a state with no matching signed cookie, so the Server Action must have set
  // it (nextCookies) — a flow that starts but can never finish would otherwise pass this test.
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name.endsWith("better-auth.state"))).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
});
