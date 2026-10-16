import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { researchDraft, type ResearchNotes } from "../lib/ai/research.ts";
import { syntheticId } from "./seed-rounds.ts";

// The synthetic research for Neon `develop` and local (docs/12-deployment.md §1; #135): one saved
// `researched` role context, its draft as the research route returns one and its notes as a user
// edited them, so the two differ where Setup and History can show it. An invented company, and
// fixtures, never a model call. **Never seeded on `main`**: `db:seed` does not call this.

type Db = Pick<NodePgDatabase, "execute">;

const COMPANY = "Kitahama Parcel K.K.";
const ROLE = "Backend Engineer";
const MODEL_KNOWLEDGE = "model knowledge";

const NOTES: ResearchNotes = {
  company: {
    what_it_does: [
      { text: "Kitahama Parcel runs same-day parcel delivery for online shops in the Kansai region.", source: MODEL_KNOWLEDGE },
    ],
    products: [
      { text: "A delivery booking API that shops call at checkout.", source: "https://kitahama-parcel.example/api" },
      { text: "A driver app that plans each route at the depot.", source: MODEL_KNOWLEDGE },
    ],
    size: [{ text: "About 600 employees, most of them drivers.", source: MODEL_KNOWLEDGE }],
    recent_news: [
      { text: "It opened a second depot in Kobe in 2026.", source: "https://kitahama-parcel.example/news/kobe-depot" },
    ],
    stated_values: [{ text: "On time, every time.", source: "https://kitahama-parcel.example/about" }],
  },
  role: {
    guess: true,
    involves: [
      { text: "Keeping the booking API fast at the lunchtime and evening peaks.", source: MODEL_KNOWLEDGE },
      { text: "Owning the billing service that invoices shops each month.", source: MODEL_KNOWLEDGE },
    ],
    asks_for: [{ text: "Experience running a public API in production.", source: MODEL_KNOWLEDGE }],
  },
};

/** The draft exactly as the research route would return it (`researchDraft`, 07 §5.22). */
export const SYNTHETIC_RESEARCH_DRAFT = researchDraft({ companyName: COMPANY, roleTitle: ROLE }, NOTES);

/**
 * The notes as saved: the user cut the size line, which is beside the point, and corrected the role's
 * guess, which named billing where this role owns routing. The questions are written from these.
 */
export const SYNTHETIC_RESEARCH_NOTES = SYNTHETIC_RESEARCH_DRAFT.replace("\nSize\n- About 600 employees, most of them drivers. [model knowledge]\n", "").replace(
  "- Owning the billing service that invoices shops each month. [model knowledge]",
  "- Owning the route planner the driver app reads from. [edited]",
);

export const SYNTHETIC_RESEARCH = { companyName: COMPANY, roleTitle: ROLE } as const;

/** Seeds the synthetic research once per user and returns whether it wrote it. */
export async function seedSyntheticResearch(db: Db, userId: string): Promise<boolean> {
  const { rows } = await db.execute(sql`
    insert into role_contexts (id, user_id, kind, company_name, role_title, body, research_draft)
    values (${syntheticId(userId, "research")}, ${userId}, 'researched', ${COMPANY}, ${ROLE},
            ${SYNTHETIC_RESEARCH_NOTES}, ${SYNTHETIC_RESEARCH_DRAFT})
    on conflict (id) do nothing
    returning id`);
  return rows.length > 0;
}
