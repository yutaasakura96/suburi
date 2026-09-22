import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "../../db/schema.ts";
import { carryForward } from "./carry-forward.ts";
import { currentCvVersion } from "./current-version.ts";
import type { Span } from "./spans";
import { isUnchanged } from "./unchanged.ts";

// Relative imports: the integration tests load this file outside Next's path aliases.

type Db = Pick<NodePgDatabase, "select" | "insert" | "execute">;

type Language = "ja" | "en";
type Kind = "rirekisho" | "shokumu_keirekisho" | "cv" | "additional";

export interface NewCvVersion {
  readonly userId: string;
  readonly language: Language;
  /** In `position` order, already checked against 04's composition. */
  readonly documents: readonly {
    readonly kind: Kind;
    readonly title: string | null;
    readonly sourceFilename: string | null;
    readonly text: string;
  }[];
  readonly body: string;
  readonly ranges: readonly Span[];
  readonly claims: readonly { readonly span: Span; readonly textNormalised: string }[];
  /** Null only for the synthetic seed's fixture claims, which no model produced (06, #19). */
  readonly extractorModelId: string | null;
  readonly extractorPromptVersion: string | null;
}

export type SaveOutcome =
  | { readonly unchanged: true; readonly versionLabel: string }
  | {
      readonly unchanged: false;
      readonly version: typeof s.cvVersions.$inferSelect;
      readonly documents: (typeof s.cvDocuments.$inferSelect)[];
      readonly carriedForward: number;
    };

const LABEL_PREFIX = { ja: "応募書類", en: "CV" } as const;

async function nextLabel(db: Db, userId: string, language: Language) {
  const rows = await db
    .select({ label: s.cvVersions.versionLabel })
    .from(s.cvVersions)
    .where(and(eq(s.cvVersions.userId, userId), eq(s.cvVersions.language, language)));
  const prefix = `${LABEL_PREFIX[language]} v`;
  const highest = rows.reduce((max, { label }) => {
    const n = label.startsWith(prefix) ? Number(label.slice(prefix.length)) : 0;
    return Number.isInteger(n) ? Math.max(max, n) : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

/** The transaction-scoped advisory lock on `(user_id, language)` that serialises saves (04). */
export async function lockCvLanguage(tx: Db, userId: string, language: Language) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`cv_versions:${userId}:${language}`}, 0))`);
}

/**
 * Writes one CV version, its documents and its claims. Call it inside a transaction: the first
 * statement takes a transaction-scoped advisory lock on `(user_id, language)`, so saves in a language
 * run one at a time and everything after the lock sees every earlier save committed (04).
 *
 * Under the lock: `cv_unchanged` is checked again against what is current *now* (07 §5.2), the label
 * is derived, and carry-forward matches against that same version — the immediately previous one.
 * `created_at` is `clock_timestamp()`, not the default `now()`, which is the transaction's start and
 * would date a save that waited on the lock before the one it waited for (06, #16). The unique label
 * index is the backstop; a violation is a bug, and it throws.
 */
export async function saveCvVersion(tx: Db, input: NewCvVersion): Promise<SaveOutcome> {
  const { userId, language } = input;
  await lockCvLanguage(tx, userId, language);

  const previous = await currentCvVersion(tx, userId, language);
  if (previous && isUnchanged(previous.version.body, previous.documents, input.documents)) {
    return { unchanged: true, versionLabel: previous.version.versionLabel };
  }

  const [version] = await tx
    .insert(s.cvVersions)
    .values({
      userId,
      versionLabel: await nextLabel(tx, userId, language),
      language,
      body: input.body,
      extractorModelId: input.extractorModelId,
      extractorPromptVersion: input.extractorPromptVersion,
      createdAt: sql`clock_timestamp()`,
    })
    .returning();
  const documents = await tx
    .insert(s.cvDocuments)
    .values(
      input.documents.map((document, position) => ({
        cvVersionId: version.id,
        userId,
        kind: document.kind,
        title: document.title,
        sourceFilename: document.sourceFilename,
        position,
        start: input.ranges[position].start,
        end: input.ranges[position].end,
      })),
    )
    .returning();

  const parents = carryForward(
    (previous?.claims ?? []).map((claim) => ({ id: claim.id, textNormalised: claim.textNormalised, spanStart: claim.start })),
    input.claims.map((claim) => claim.textNormalised),
  );
  await tx.insert(s.cvClaims).values(
    input.claims.map((claim, index) => ({
      cvVersionId: version.id,
      userId,
      textNormalised: claim.textNormalised,
      spanStart: claim.span.start,
      spanEnd: claim.span.end,
      supersedesClaimId: parents[index],
    })),
  );

  return {
    unchanged: false,
    version,
    documents,
    carriedForward: parents.filter((parent) => parent !== null).length,
  };
}
