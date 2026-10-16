import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { HISTORY_COPY } from "../app/(app)/history/copy";
import { historyDetail } from "../app/(app)/history/load";
import { firstAttempts } from "../lib/progress/first-attempts";
import { MAX_POSTING_CHARS } from "../lib/round/limits";
import { characterLength } from "../lib/cv/spans";
import * as s from "./schema";
import { seedSyntheticCv } from "./seed-cv";
import { seedRubrics, seedSyntheticQuestions } from "./seed-questions";
import { SYNTHETIC_RESEARCH, SYNTHETIC_RESEARCH_DRAFT, SYNTHETIC_RESEARCH_NOTES, seedSyntheticResearch } from "./seed-research";
import { seedSyntheticRounds, syntheticId } from "./seed-rounds";
import { closePool, inRolledBackTransaction } from "./test/database";
import { insertUser } from "./test/fixtures";

afterAll(closePool);

// 12 §1, #135: Setup and History need a saved research whose draft and edited notes differ.
describe("the synthetic research seed", () => {
  it("seeds one researched role context, once, with a draft and edited notes that differ", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      expect(await seedSyntheticResearch(db, userId)).toBe(true);
      expect(await seedSyntheticResearch(db, userId)).toBe(false);

      const rows = await db.select().from(s.roleContexts).where(eq(s.roleContexts.userId, userId));
      expect(rows).toEqual([
        expect.objectContaining({
          kind: "researched",
          companyName: SYNTHETIC_RESEARCH.companyName,
          roleTitle: SYNTHETIC_RESEARCH.roleTitle,
          body: SYNTHETIC_RESEARCH_NOTES,
          researchDraft: SYNTHETIC_RESEARCH_DRAFT,
          sourceFilename: null,
        }),
      ]);
    }));

  it("edits the draft the way a user would: a line cut and the role's guess corrected", () => {
    expect(SYNTHETIC_RESEARCH_NOTES).not.toBe(SYNTHETIC_RESEARCH_DRAFT);
    expect(SYNTHETIC_RESEARCH_DRAFT).toContain("billing service");
    expect(SYNTHETIC_RESEARCH_NOTES).not.toContain("billing service");
    expect(SYNTHETIC_RESEARCH_DRAFT).toContain("\nSize\n");
    expect(SYNTHETIC_RESEARCH_NOTES).not.toContain("\nSize\n");
    expect(SYNTHETIC_RESEARCH_NOTES).toContain("The role (a guess, not from a posting)");
    for (const text of [SYNTHETIC_RESEARCH_DRAFT, SYNTHETIC_RESEARCH_NOTES]) expect(characterLength(text)).toBeLessThanOrEqual(MAX_POSTING_CHARS);
  });

  it("reads as research on History and sits under Pitched at a role on Progress", () =>
    inRolledBackTransaction(async (db) => {
      const userId = await insertUser(db);
      for (const language of ["ja", "en"] as const) await seedSyntheticCv(db, userId, language);
      await seedRubrics(db);
      await seedSyntheticQuestions(db, userId);
      await seedSyntheticRounds(db, userId);
      await seedSyntheticResearch(db, userId);
      // As though the completed Japanese round had been started on the research.
      const roundId = syntheticId(userId, "complete-ja");
      await db.update(s.rounds).set({ roleContextId: syntheticId(userId, "research") }).where(eq(s.rounds.id, roundId));

      const [round] = await db.select().from(s.rounds).where(eq(s.rounds.id, roundId));
      const { roleContext } = await historyDetail(db, round, new Date("2026-10-04T03:00:00.000Z"));
      expect(roleContext).toEqual({ kind: "researched", companyName: SYNTHETIC_RESEARCH.companyName, roleTitle: SYNTHETIC_RESEARCH.roleTitle });
      expect(HISTORY_COPY.roleContext(roleContext.kind, roleContext.companyName, roleContext.roleTitle)).toBe(
        "Researched: Kitahama Parcel K.K., Backend Engineer",
      );

      const answers = await db.select({ id: s.answers.id }).from(s.answers).where(and(eq(s.answers.roundId, roundId), eq(s.answers.isFirstAttempt, true)));
      const plotted = (await firstAttempts(db, userId)).filter((entry) => answers.some((answer) => answer.id === entry.point.answerId));
      expect(plotted.length).toBeGreaterThan(0);
      expect(plotted.every((entry) => entry.context === "role")).toBe(true);
    }));
});
