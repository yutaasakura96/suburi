import { and, desc, eq } from "drizzle-orm";
import * as s from "../../db/schema";
import { normaliseClaimText } from "../cv/spans";
import type { Db } from "./http";

/**
 * **The same job** (06, 2026-10-16, R4): a posting and a research are for the same job when their
 * company names and role titles are equal after tidying — `normaliseClaimText`'s `NFKC` and whitespace
 * collapse, then case folded. "Rakuten" and "楽天" stay two companies under this rule, accepted.
 *
 * One helper, for the research route (07 §5.22) and, with #135, the research save (§5.3): **a saved
 * posting wins**, and both refuse on the same comparison.
 */
export function tidyJobName(value: string) {
  return normaliseClaimText(value).toLowerCase();
}

/** The user's newest posting for the same job, or undefined. Reads ids and the two names only. */
export async function samePosting(db: Db, userId: string, companyName: string, roleTitle: string) {
  const company = tidyJobName(companyName);
  const role = tidyJobName(roleTitle);
  const postings = await db
    .select({ id: s.roleContexts.id, companyName: s.roleContexts.companyName, roleTitle: s.roleContexts.roleTitle })
    .from(s.roleContexts)
    .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "posting")))
    .orderBy(desc(s.roleContexts.createdAt));
  return postings.find(
    (posting) => tidyJobName(posting.companyName ?? "") === company && tidyJobName(posting.roleTitle ?? "") === role,
  );
}
