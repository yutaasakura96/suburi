import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 03 §4: a prompt's version is its filename. A file whose exported version disagrees with its name
// would stamp CV versions with a string that points at a different prompt.
describe("versioned prompts", () => {
  const files = readdirSync(join(import.meta.dirname)).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );

  it.each(files)("%s exports the version its filename names", async (file) => {
    const prompt = (await import(`./${file}`)) as { version: string };
    expect(prompt.version).toBe(file.replace(/\.ts$/, ""));
  });
});
