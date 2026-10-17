import { normaliseClaimText } from "../cv/spans";

/**
 * **The same job** (06, 2026-10-16, R4): a posting and a research are for the same job when their
 * company names and role titles are equal after tidying — `normaliseClaimText`'s `NFKC` and whitespace
 * collapse, then case folded. "Rakuten" and "楽天" stay two companies under this rule, accepted.
 *
 * No database here, so Setup's research card (10 §2) compares on the client with the very rule the
 * research route and the save refuse on (`same-job.ts`).
 */
export function tidyJobName(value: string) {
  return normaliseClaimText(value).toLowerCase();
}

export interface JobNames {
  readonly companyName: string;
  readonly roleTitle: string;
}

export function sameCompany(a: Pick<JobNames, "companyName">, b: Pick<JobNames, "companyName">) {
  return tidyJobName(a.companyName) === tidyJobName(b.companyName);
}

export function sameJob(a: JobNames, b: JobNames) {
  return sameCompany(a, b) && tidyJobName(a.roleTitle) === tidyJobName(b.roleTitle);
}
