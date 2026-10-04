import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./list-rounds";

// 07 §4: the cursor is opaque, and anything this server did not mint is refused rather than guessed at.

const CURSOR = { s: "2026-09-12T10:30:00.123456Z", i: "0b0e4b0e-9f43-4c58-8a5e-5f2a6d6f3c11" };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("the rounds cursor", () => {
  it("round-trips where the last page ended, microseconds included", () => {
    expect(decodeCursor(encodeCursor(CURSOR))).toEqual(CURSOR);
  });

  it("is URL-safe as it is", () => {
    expect(encodeCursor(CURSOR)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ["not base64 JSON", "%%%"],
    ["an empty string", ""],
    ["a JSON string", encode("cursor")],
    ["null", encode(null)],
    ["a millisecond timestamp", encode({ ...CURSOR, s: "2026-09-12T10:30:00.123Z" })],
    ["a timestamp with an offset", encode({ ...CURSOR, s: "2026-09-12T10:30:00.123456+09:00" })],
    ["SQL where the timestamp goes", encode({ ...CURSOR, s: "now()); drop table rounds; --" })],
    ["an id that is not a uuid", encode({ ...CURSOR, i: "1 or 1=1" })],
    ["a missing id", encode({ s: CURSOR.s })],
  ])("refuses %s", (_name, value) => {
    expect(decodeCursor(value)).toBeNull();
  });

  it("carries nothing but the two keys it was minted with", () => {
    expect(decodeCursor(encode({ ...CURSOR, user_id: "someone-else" }))).toEqual(CURSOR);
  });
});
