import { describe, expect, it } from "vitest";
import { sameCompany, sameJob, tidyJobName } from "./job-name";

// R4 (06, 2026-10-16): the comparison the research route, the save and Setup's card share.
describe("the same job", () => {
  it("tidies NFKC, spacing and case", () => {
    expect(tidyJobName("  Ｉｎｖｅｎｔｅｄ   Freight\te2e ")).toBe("invented freight e2e");
  });

  it("is the same job when company and title match after tidying", () => {
    const posting = { companyName: "Invented Freight", roleTitle: "Backend Engineer" };
    expect(sameJob(posting, { companyName: "invented  freight", roleTitle: "BACKEND engineer " })).toBe(true);
    expect(sameJob(posting, { companyName: "Invented Freight", roleTitle: "Frontend Engineer" })).toBe(false);
    expect(sameCompany(posting, { companyName: "ＩＮＶＥＮＴＥＤ Freight" })).toBe(true);
  });

  it("keeps a company's name in two scripts as two companies", () => {
    expect(sameCompany({ companyName: "Rakuten" }, { companyName: "楽天" })).toBe(false);
  });
});
