import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as s from "../../db/schema";
import { apiError, unauthenticated } from "../api/errors";
import { sessionUserId, type SessionReader } from "../auth/session";
import {
  ExtractionFailed,
  type CvClaimExtractor,
  type ExtractedClaim,
} from "../ai/extract-cv-claims";
import { assembleBody } from "./body";
import {
  createSpanChecker,
  normaliseClaimText,
  type RejectionReason,
  type Span,
} from "./spans";

// Relative imports: the integration tests load this file outside Next's path aliases.

/**
 * `POST /api/cv-versions` (07 §5.2): save one language's whole CV as a new version and extract its
 * claims. Synchronous, one model call, all-or-nothing.
 *
 * **Composition and order are refused, never repaired** (04, 07 §5.2). A set is its required
 * document, then — Japanese only — at most one 職務経歴書, then up to five titled additional
 * documents in the order sent. That order is `position` and the order `body` is joined in; a request
 * in any other order is a 400 rather than being sorted. `cv_unchanged` and carry-forward are #16; the
 * rate limiter is #18; the total size cap is #20's, measured on the real call.
 *
 * **The client chooses none of the stamps.** `version_label`, `body`, every document's range and
 * both extractor stamps are derived here. Unknown request keys are refused, so a client-sent
 * `version_label` is a 400 rather than silently ignored.
 *
 * **Nothing in a log line or an envelope carries CV text** (12 §7) — not a document, a claim, or a
 * rejected quote. Ids, counts, durations and error classes only. Field names in a 400, never values.
 */

type Db = Pick<NodePgDatabase, "select" | "insert">;

export interface PostCvVersionDeps {
  readonly auth: SessionReader;
  readonly db: Db;
  /** All-or-nothing: the version, its documents and its claims land together or not at all. */
  readonly transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>;
  readonly extractor: CvClaimExtractor;
}

const notBlank = (value: string) => value.trim() !== "";
const sourceFilename = z.string().min(1).max(255).optional();
const known = <K extends string>(kind: K) =>
  z.strictObject({ kind: z.literal(kind), source_filename: sourceFilename, text: z.string().refine(notBlank) });

const documentSchema = z.discriminatedUnion("kind", [
  known("rirekisho"),
  known("shokumu_keirekisho"),
  known("cv"),
  z.strictObject({
    kind: z.literal("additional"),
    title: z.string().max(200).refine(notBlank),
    source_filename: sourceFilename,
    text: z.string().refine(notBlank),
  }),
]);

type Kind = z.infer<typeof documentSchema>["kind"];

/**
 * Each language's kinds in the one order a set may take (04): its required kind exactly once, first;
 * then its optional kinds, each at most `max` times. `additional` is last in both, so it is the only
 * kind whose members' relative order the client chooses.
 */
const COMPOSITION = {
  ja: [
    { kind: "rirekisho", min: 1, max: 1 },
    { kind: "shokumu_keirekisho", min: 0, max: 1 },
    { kind: "additional", min: 0, max: 5 },
  ],
  en: [
    { kind: "cv", min: 1, max: 1 },
    { kind: "additional", min: 0, max: 5 },
  ],
} as const satisfies Record<"ja" | "en", readonly { kind: Kind; min: number; max: number }[]>;

const requestSchema = z
  .strictObject({
    language: z.enum(["ja", "en"]),
    documents: z.array(documentSchema),
  })
  .superRefine(({ language, documents }, context) => {
    const rules: readonly { kind: Kind; min: number; max: number }[] = COMPOSITION[language];
    const rank = (kind: Kind) => rules.findIndex((rule) => rule.kind === kind);

    let foreign = false;
    documents.forEach((document, index) => {
      if (rank(document.kind) !== -1) return;
      foreign = true;
      context.addIssue({ code: "custom", path: ["documents", index, "kind"], message: "wrong kind for language" });
    });
    if (foreign) return;

    const counted = rules.every(({ kind, min, max }) => {
      const n = documents.filter((document) => document.kind === kind).length;
      return min <= n && n <= max;
    });
    const ordered = documents.every((document, index) => index === 0 || rank(documents[index - 1].kind) <= rank(document.kind));
    if (!counted || !ordered) {
      context.addIssue({ code: "custom", path: ["documents"], message: "composition" });
    }
  });

function titleOf(document: z.infer<typeof documentSchema>) {
  return document.kind === "additional" ? document.title : null;
}

const LABEL_PREFIX = { ja: "応募書類", en: "CV" } as const;

// A lost race on the unique label index retries with the next number (04). Three is generous: one
// user, and the save button disables in flight.
const LABEL_ATTEMPTS = 3;

function log(level: "info" | "error", fields: Record<string, string | number>) {
  console[level](JSON.stringify(fields));
}

async function nextLabel(db: Db, userId: string, language: "ja" | "en") {
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

function isLabelRace(error: unknown) {
  const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint?: string };
  return pg.code === "23505" && pg.constraint === "cv_versions_user_id_language_version_label_uniq";
}

function pgErrorClass(error: unknown) {
  const pg = ((error as { cause?: unknown }).cause ?? error) as { code?: unknown };
  return typeof pg.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code) ? `pg_${pg.code}` : "unexpected";
}

interface SurvivingClaim {
  readonly span: Span;
  readonly textNormalised: string;
}

/**
 * Every extracted claim is located in its document and then validated. A claim that fails either is
 * dropped and counted, never clamped. Two claims landing on the same span are one claim, checked
 * once, so `spans_checked` is always `claims.total + spans_rejected`.
 */
function survivingClaims(body: string, ranges: readonly Span[], claims: readonly ExtractedClaim[]) {
  const checker = createSpanChecker(body, ranges);
  const surviving = new Map<string, SurvivingClaim>();
  const rejected: Partial<Record<RejectionReason | "not_found", number>> = {};

  for (const claim of claims) {
    const span = checker.locate(claim.document, claim.quote, claim.start_hint);
    const verdict = span ? checker.validate(span, claim.quote) : null;
    if (!span || !verdict?.ok) {
      const reason = verdict && !verdict.ok ? verdict.reason : "not_found";
      rejected[reason] = (rejected[reason] ?? 0) + 1;
      continue;
    }
    surviving.set(`${span.start}:${span.end}`, {
      span,
      textNormalised: normaliseClaimText(verdict.quote),
    });
  }

  const spansRejected = Object.values(rejected).reduce((sum, n) => sum + n, 0);
  const spansChecked = surviving.size + spansRejected;
  return { claims: [...surviving.values()], spansChecked, spansRejected, rejected };
}

export function createPostCvVersion(deps: PostCvVersionDeps) {
  return async function POST(request: Request): Promise<Response> {
    const userId = await sessionUserId(deps.auth, request.headers);
    if (!userId) return unauthenticated();

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return apiError("invalid_request", "The request body is not JSON.", { fields: ["body"] });
    }
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "body"))];
      return apiError("invalid_request", "The request failed validation.", { fields });
    }

    const { language, documents } = parsed.data;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);

    let extracted: readonly ExtractedClaim[];
    try {
      extracted = await deps.extractor.extract(
        language,
        documents.map((document) => ({ kind: document.kind, title: titleOf(document), text: document.text })),
      );
    } catch (error) {
      const errorClass = error instanceof ExtractionFailed ? error.errorClass : "unexpected";
      log("error", { event: "cv_extraction_failed", language, error_class: errorClass, duration_ms: elapsed() });
      return apiError("cv_extraction_failed", "CV extraction failed; nothing was written.", {
        error_class: errorClass,
      });
    }

    const { body, ranges } = assembleBody(documents.map((document) => document.text));
    const { claims, spansChecked, spansRejected, rejected } = survivingClaims(body, ranges, extracted);
    if (claims.length === 0) {
      log("error", {
        event: "cv_extraction_failed",
        language,
        error_class: "no_claims_survived",
        spans_checked: spansChecked,
        spans_rejected: spansRejected,
        duration_ms: elapsed(),
      });
      return apiError("cv_extraction_failed", "No extracted claim survived span validation.", {
        error_class: "no_claims_survived",
        spans_checked: spansChecked,
        spans_rejected: spansRejected,
      });
    }

    const saveVersion = () =>
      deps.transaction(async (tx) => {
        const [version] = await tx
          .insert(s.cvVersions)
          .values({
            userId,
            versionLabel: await nextLabel(tx, userId, language),
            language,
            body,
            extractorModelId: deps.extractor.modelId,
            extractorPromptVersion: deps.extractor.promptVersions[language],
          })
          .returning();
        const rows = await tx
          .insert(s.cvDocuments)
          .values(
            documents.map((document, position) => ({
              cvVersionId: version.id,
              userId,
              kind: document.kind,
              title: titleOf(document),
              sourceFilename: document.source_filename ?? null,
              position,
              start: ranges[position].start,
              end: ranges[position].end,
            })),
          )
          .returning();
        await tx.insert(s.cvClaims).values(
          claims.map((claim) => ({
            cvVersionId: version.id,
            userId,
            textNormalised: claim.textNormalised,
            spanStart: claim.span.start,
            spanEnd: claim.span.end,
          })),
        );
        return { version, documents: rows };
      });

    let saved: Awaited<ReturnType<typeof saveVersion>> | undefined;
    for (let attempt = 1; !saved; attempt += 1) {
      try {
        saved = await saveVersion();
      } catch (error) {
        if (isLabelRace(error) && attempt < LABEL_ATTEMPTS) continue;
        // drizzle's message carries the query's params — the body and every claim — so the
        // original never leaves this function: not to Next's error log, not to a report.
        const errorClass = pgErrorClass(error);
        log("error", { event: "cv_version_write_failed", language, error_class: errorClass, duration_ms: elapsed() });
        throw new Error(`CV version write failed: ${errorClass}`);
      }
    }

    const { version } = saved;
    log("info", {
      event: "cv_version_created",
      cv_version_id: version.id,
      language,
      documents: saved.documents.length,
      claims: claims.length,
      spans_checked: spansChecked,
      spans_rejected: spansRejected,
      ...Object.fromEntries(Object.entries(rejected).map(([reason, n]) => [`rejected_${reason}`, n])),
      duration_ms: elapsed(),
    });

    return Response.json(
      {
        id: version.id,
        version_label: version.versionLabel,
        language: version.language,
        created_at: version.createdAt.toISOString(),
        extractor_model_id: version.extractorModelId,
        extractor_prompt_version: version.extractorPromptVersion,
        documents: saved.documents.map((document) => ({
          id: document.id,
          kind: document.kind,
          title: document.title,
          start: document.start,
          end: document.end,
        })),
        claims: { total: claims.length, carried_forward: 0, new: claims.length },
        validation: { spans_checked: spansChecked, spans_rejected: spansRejected },
      },
      { status: 201 },
    );
  };
}
