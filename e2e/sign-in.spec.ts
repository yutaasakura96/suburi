import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// docs/11-testing-plan.md seam 3: the browser, against a production build.

test("/sign-in shows the wordmark and one Google button in both languages", async ({ page }) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBe(200);

  await expect(page.getByText("素振り")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Googleでログイン" })).toBeVisible();
  await expect(page.getByText("Sign in with Google")).toBeVisible();
});

test("the sign-in button is square and unshadowed (05 §4, §10.1)", async ({ page }) => {
  await page.goto("/sign-in");
  const button = page.getByRole("button", { name: "Googleでログイン" });

  const computed = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomLeftRadius: style.borderBottomLeftRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
      boxShadow: style.boxShadow,
      height: style.height,
    };
  });

  expect(computed.borderTopLeftRadius).toBe("0px");
  expect(computed.borderTopRightRadius).toBe("0px");
  expect(computed.borderBottomLeftRadius).toBe("0px");
  expect(computed.borderBottomRightRadius).toBe("0px");
  expect(computed.boxShadow).toBe("none");
  // 05 §5.7's control height, proving the token mapping reached the vendored component.
  expect(computed.height).toBe("48px");
});

test("the built CSS carries 05's palette and none of Tailwind's (05 §10.1)", async () => {
  // Turbopack emits stylesheets beside the JS chunks, so the whole static tree is searched.
  const staticDirectory = path.join(process.cwd(), ".next", "static");
  const entries = await readdir(staticDirectory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  expect(files.length).toBeGreaterThan(0);

  const css = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

  // The wipe: a colour 05 does not name generates no rule at all.
  expect(css).not.toContain("bg-blue-500");
  expect(css).not.toContain("--color-blue-500");
  // The palette it was wiped for.
  expect(css).toContain("--color-ground");
  expect(css).toContain("--color-ink-label");
  expect(css).toContain("--color-mark");
  // 05 §10.1: the accent family is --mark* in code, never --accent, which shadcn owns.
  expect(css).not.toContain("--color-accent-mid");
});
