import { and, desc, eq } from "drizzle-orm";
import * as s from "../../db/schema";
import { apiError } from "../api/errors";
import { log, type Db } from "./http";
import { sameJob } from "./job-name";

/**
 * **The same job** (06, 2026-10-16, R4), read from the database: `job-name.ts` holds the comparison,
 * which Setup's research card makes on the client too. One helper, for the research route (07 §5.22)
 * and the research save (§5.3): **a saved posting wins**, and both refuse on the same comparison with
 * the same code.
 *
 * The user's newest posting for the same job, or undefined. Reads ids and the two names only.
 */
export async function samePosting(db: Db, userId: string, companyName: string, roleTitle: string) {
  const postings = await db
    .select({ id: s.roleContexts.id, companyName: s.roleContexts.companyName, roleTitle: s.roleContexts.roleTitle })
    .from(s.roleContexts)
    .where(and(eq(s.roleContexts.userId, userId), eq(s.roleContexts.kind, "posting")))
    .orderBy(desc(s.roleContexts.createdAt));
  return postings.find((posting) =>
    sameJob({ companyName: posting.companyName ?? "", roleTitle: posting.roleTitle ?? "" }, { companyName, roleTitle }),
  );
}

/**
 * **A saved posting wins** (R4, US-2): `422 research_posting_exists`, naming the newest posting for the
 * same job, or undefined when there is none. The research route's refusal and the save's, one answer.
 */
export async function refuseSamePosting(db: Db, userId: string, companyName: string, roleTitle: string) {
  const posting = await samePosting(db, userId, companyName, roleTitle);
  if (!posting) return undefined;
  log("info", { event: "research_posting_exists", role_context_id: posting.id });
  return apiError("research_posting_exists", "A saved posting is for the same job; it is used instead.", {
    role_context_id: posting.id,
  });
}
