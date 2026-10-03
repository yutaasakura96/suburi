import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

type Db = Pick<NodePgDatabase, "execute">;

/**
 * Coverage (CONTEXT.md, 04 `cv_claims`): which claims of one CV version have ever been cited. A claim
 * is cited when an answer cited it **or any claim it was carried forward from** — coverage is
 * inherited down the `supersedes_claim_id` chain, so re-saving a CV does not make used material read
 * as never used. Either relation counts: an answer that contradicted a claim did use it.
 *
 * The caller has already resolved the version for its user; a claim's lineage never leaves that user.
 */
export async function citedClaimIds(db: Db, cvVersionId: string): Promise<Set<string>> {
  const { rows } = await db.execute<{ id: string }>(sql`
    with recursive lineage (claim_id, ancestor_id) as (
      select id, id from cv_claims where cv_version_id = ${cvVersionId}
      union
      select lineage.claim_id, parent.supersedes_claim_id
      from lineage
      join cv_claims parent on parent.id = lineage.ancestor_id
      where parent.supersedes_claim_id is not null
    )
    select distinct lineage.claim_id as id
    from lineage
    join claim_citations on claim_citations.cv_claim_id = lineage.ancestor_id`);
  return new Set(rows.map((row) => row.id));
}
