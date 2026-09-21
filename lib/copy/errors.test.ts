import { describe, expect, it } from "vitest";
import { ERROR_STATUS, type ErrorCode } from "../api/errors";
import { ERROR_COPY } from "./errors";

const codes = Object.keys(ERROR_STATUS) as ErrorCode[];
const copyKeys = Object.keys(ERROR_COPY);

/**
 * 11 §3.10, both directions. The type already forces one of them at compile time, but this is the
 * assertion the doc names and the one that fails in CI when a code is added without copy — "a 502
 * with no Japanese sentence is 03 §8's generic-error rule broken in production".
 */
describe("the bilingual error catalogue", () => {
  it("has copy for every 07 §3 code", () => {
    expect(copyKeys.slice().sort()).toEqual(codes.slice().sort());
  });

  it("has no copy key that is not a code", () => {
    expect(copyKeys.filter((key) => !(codes as string[]).includes(key))).toEqual([]);
  });

  it.each(codes)("gives %s a Japanese and an English sentence", (code) => {
    const { ja, en } = ERROR_COPY[code];
    expect(ja.trim()).not.toBe("");
    expect(en.trim()).not.toBe("");
  });

  // An untranslated English string sitting in the ja slot passes every emptiness check.
  it.each(codes)("writes %s's ja in Japanese", (code) => {
    expect(ERROR_COPY[code].ja).toMatch(/[぀-ヿ一-龯]/u);
  });

  it.each(codes)("ends %s with a full stop in each language", (code) => {
    expect(ERROR_COPY[code].ja).toMatch(/。$/u);
    expect(ERROR_COPY[code].en).toMatch(/\.$/u);
  });
});

/**
 * 05 §6 — each of these is a rule because it was once a bug. Only the mechanical ones are
 * assertable; whether a person would write the sentence is the native read, not a test.
 */
describe("05 §6, the rules that are mechanical", () => {
  // The rule bans 点 as a *counter* — 採点 and 未採点 are established in 10 and stay.
  it.each(codes)("uses no 点 counter in %s", (code) => {
    expect(ERROR_COPY[code].ja).not.toMatch(/[0-9０-９]\s*点/u);
  });

  it.each(codes)("uses a nakaguro with no surrounding spaces in %s", (code) => {
    expect(ERROR_COPY[code].ja).not.toMatch(/[·・]\s|\s[·・]/u);
    expect(ERROR_COPY[code].ja).not.toMatch(/·/u);
  });

  it.each(codes)("writes 録り直し, never 撮り直し, in %s", (code) => {
    expect(ERROR_COPY[code].ja).not.toMatch(/撮り直/u);
  });

  // 05 §6: 応募書類 is the word for the set; 職務経歴書 names one member of it.
  it("calls the CV set 応募書類 where it means the set", () => {
    expect(ERROR_COPY.cv_unchanged.ja).toContain("応募書類");
    expect(ERROR_COPY.cv_extraction_failed.ja).toContain("応募書類");
  });

  it("writes 深掘り for a follow-up and 緊張度 for felt pressure", () => {
    expect(ERROR_COPY.followup_generation_failed.ja).toContain("深掘り");
    expect(ERROR_COPY.pressure_required.ja).toContain("緊張度");
    expect(ERROR_COPY.pressure_not_applicable.ja).toContain("緊張度");
  });
});

/**
 * 03 §8: "this app has one user, and that user can read. Say what happened." No generic
 * "something went wrong" where a specific sentence is available.
 */
describe("03 §8, a specific sentence per failure", () => {
  it("writes no two codes the same sentence", () => {
    const ja = codes.map((code) => ERROR_COPY[code].ja);
    const en = codes.map((code) => ERROR_COPY[code].en);
    expect(new Set(ja).size).toBe(codes.length);
    expect(new Set(en).size).toBe(codes.length);
  });

  // The catalogue is static strings, so nothing from 03 §8's never-log list can reach it through a
  // value. A placeholder would be the one way it could — this closes that door before it opens.
  it.each(codes)("interpolates nothing into %s", (code) => {
    expect(ERROR_COPY[code].ja).not.toMatch(/[{}$%]/u);
    expect(ERROR_COPY[code].en).not.toMatch(/[{}$%]/u);
  });
});
