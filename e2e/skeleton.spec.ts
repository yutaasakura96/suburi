import { expect, test } from "@playwright/test";

test("the production build serves a page", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Suburi" })).toBeVisible();
});
