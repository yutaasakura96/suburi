import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as s from "../../db/schema";
import { seedUser } from "../../db/seed";
import { closePool, inRolledBackTransaction, type TestDb } from "../../db/test/database";
import { insertUser } from "../../db/test/fixtures";
import type { ExtractedClaim, ExtractionDocument } from "../ai/extract-cv-claims";
import { ExtractionFailed } from "../ai/extract-cv-claims";
import { fakeCvClaimExtractor } from "../ai/fake-extract-cv-claims";
import { createAuth } from "../auth/auth";
import { mintSessionCookie } from "../auth/test/session";
import { getConfig } from "../config";
import { createPostCvVersion } from "./post-cv-version";
import { sliceQuote } from "./spans";

// Seam 1 (spec #11): POST /api/cv-versions through its handler, against the migrated test database,
// with a real Better Auth session. Only the extraction port is faked (11 §2).

vi.stubEnv("DATABASE_URL", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://suburi:suburi@localhost:5433/suburi_test");
vi.stubEnv("BETTER_AUTH_SECRET", "integration-only-secret-not-a-real-one");
vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
vi.stubEnv("GOOGLE_CLIENT_ID", "integration-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "integration-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "allowed@example.test");
vi.stubEnv("OPENAI_API_KEY", "integration-not-a-real-key");

// Recognisable text that must never reach an envelope or a log line (11 §3.10).
const SENTINEL = "ZEBRA-SENTINEL-4471";

const CV = [
  "Jordan Example — jordan@example.test",
  `Led a team of 5 at ${SENTINEL} Logistics.`,
  "Cut invoicing time by 40%.",
  "BSc Computer Science, Invented University, 2016.",
].join("\n");

const CLAIMS: ExtractedClaim[] = [
  { document: 0, quote: `Led a team of 5 at ${SENTINEL} Logistics.`, start_hint: 37 },
  { document: 0, quote: "Cut invoicing time by 40%.", start_hint: 80 },
  { document: 0, quote: "BSc Computer Science, Invented University, 2016.", start_hint: 110 },
];

function cvRequest(text = CV, extra: object = {}) {
  return { language: "en", documents: [{ kind: "cv", text }], ...extra };
}

let logged: string[];

beforeEach(() => {
  logged = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => vi.restoreAllMocks());

afterAll(closePool);

// The handler's transaction, as a savepoint inside the test's own rolled-back transaction, so a
// failed write really is undone and all-or-nothing is observable.
function savepointTransaction(db: TestDb) {
  return async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute(sql`savepoint cv_write`);
    try {
      const result = await work(db);
      await db.execute(sql`release savepoint cv_write`);
      return result;
    } catch (error) {
      await db.execute(sql`rollback to savepoint cv_write`);
      throw error;
    }
  };
}

async function setUp(
  db: TestDb,
  respond: (documents: readonly ExtractionDocument[]) => readonly ExtractedClaim[] = () => CLAIMS,
) {
  await seedUser(db, getConfig().ALLOWED_EMAIL);
  const [user] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, getConfig().ALLOWED_EMAIL));
  const auth = createAuth({ db, transaction: false });
  const cookie = await mintSessionCookie(auth, user.id);
  const extractor = fakeCvClaimExtractor(respond);
  const handler = createPostCvVersion({
    auth,
    db,
    transaction: savepointTransaction(db),
    extractor,
  });

  const responses: string[] = [];
  async function post(body: unknown, { signedIn = true } = {}) {
    const response = await handler(
      new Request("http://localhost:3000/api/cv-versions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signedIn ? { cookie: `${cookie.name}=${cookie.value}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text) };
  }

  async function versionsOf(userId = user.id) {
    return db.select().from(s.cvVersions).where(eq(s.cvVersions.userId, userId));
  }

  return { userId: user.id, extractor, post, responses, versionsOf };
}

async function rowCounts(db: TestDb, userId: string) {
  const count = async (table: typeof s.cvVersions | typeof s.cvDocuments | typeof s.cvClaims) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.userId, userId))).length;
  return {
    versions: await count(s.cvVersions),
    documents: await count(s.cvDocuments),
    claims: await count(s.cvClaims),
  };
}

describe("POST /api/cv-versions", () => {
  it("is 401 with no session, and calls no model", () =>
    inRolledBackTransaction(async (db) => {
      const { post, extractor } = await setUp(db);
      const { status, json } = await post(cvRequest(), { signedIn: false });
      expect(status).toBe(401);
      expect(json.error.code).toBe("unauthenticated");
      expect(extractor.calls).toBe(0);
    }));

  it.each([
    ["a body that is not JSON", "{not json", ["body"]],
    ["the other language, until #15", { ...cvRequest(), language: "ja" }, ["language"]],
    ["an empty document", cvRequest("  \n "), ["documents.0.text"]],
    ["a client-chosen version label", cvRequest(CV, { version_label: "CV v9" }), ["body"]],
    [
      "a second document",
      { language: "en", documents: [{ kind: "cv", text: CV }, { kind: "cv", text: CV }] },
      ["documents"],
    ],
    ["a title on the cv document", { language: "en", documents: [{ kind: "cv", title: "Mine", text: CV }] }, ["documents.0"]],
  ])("is 400 for %s, naming the field and calling no model", (_, body, fields) =>
    inRolledBackTransaction(async (db) => {
      const { post, extractor, userId } = await setUp(db);
      const { status, json } = await post(body);
      expect(status).toBe(400);
      expect(json.error).toMatchObject({ code: "invalid_request", detail: { fields } });
      expect(extractor.calls).toBe(0);
      expect(await rowCounts(db, userId)).toEqual({ versions: 0, documents: 0, claims: 0 });
    }));

  it("saves CV v1: body, document range, claims and every stamp derived server-side", () =>
    inRolledBackTransaction(async (db) => {
      const { post, userId } = await setUp(db);
      const { status, json } = await post({
        language: "en",
        documents: [{ kind: "cv", source_filename: "cv.docx", text: CV }],
      });

      expect(status).toBe(201);
      expect(json).toMatchObject({
        version_label: "CV v1",
        language: "en",
        extractor_model_id: "fake-extractor",
        extractor_prompt_version: "cv-extract-en-fake",
        documents: [{ kind: "cv", title: null, start: 0, end: [...CV].length }],
        claims: { total: 3, carried_forward: 0, new: 3 },
        validation: { spans_checked: 3, spans_rejected: 0 },
      });

      const [version] = await db.select().from(s.cvVersions).where(eq(s.cvVersions.id, json.id));
      expect(version).toMatchObject({ userId, body: CV, versionLabel: "CV v1", sourceFilename: null });
      expect(json.created_at).toBe(version.createdAt.toISOString());

      const [document] = await db
        .select()
        .from(s.cvDocuments)
        .where(eq(s.cvDocuments.cvVersionId, json.id));
      expect(document).toMatchObject({ kind: "cv", position: 0, sourceFilename: "cv.docx" });

      const claims = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, json.id));
      expect(claims.map((claim) => sliceQuote(CV, { start: claim.spanStart, end: claim.spanEnd })).sort())
        .toEqual(CLAIMS.map((claim) => claim.quote).sort());
    }));

  it("quotes are sliced from Postgres by character, matching the stored spans", () =>
    inRolledBackTransaction(async (db) => {
      const text = "𠮷田商事 — Cut invoicing time by 40%.";
      const { post } = await setUp(db, () => [
        { document: 0, quote: "Cut invoicing time by 40%.", start_hint: 0 },
      ]);
      const { json } = await post(cvRequest(text));

      const rows = await db.execute<{ quote: string }>(sql`
        select substring(v.body from c.span_start + 1 for c.span_end - c.span_start) as quote
        from cv_claims c join cv_versions v on v.id = c.cv_version_id
        where v.id = ${json.id}`);
      expect(rows.rows).toEqual([{ quote: "Cut invoicing time by 40%." }]);
    }));

  it("drops and counts claims that are not in the text verbatim, and stores the rest", () =>
    inRolledBackTransaction(async (db) => {
      const decomposed = `${CV}\nCafé owner.`;
      const { post, userId } = await setUp(db, () => [
        ...CLAIMS,
        { document: 0, quote: "Cut invoicing time by 50%.", start_hint: 80 },
        { document: 0, quote: "Led a team of 5", start_hint: 999 },
        { document: 0, quote: "Cafe", start_hint: 0 },
        { document: 3, quote: "Cut invoicing time by 40%.", start_hint: 0 },
        // The same claim twice is one claim, checked once.
        { document: 0, quote: "Cut invoicing time by 40%.", start_hint: 80 },
      ]);
      const { status, json } = await post(cvRequest(decomposed));

      expect(status).toBe(201);
      expect(json.claims.total).toBe(4);
      expect(json.validation).toEqual({ spans_checked: 7, spans_rejected: 3 });
      expect((await rowCounts(db, userId)).claims).toBe(4);
    }));

  it("numbers versions per user: CV v2 after v1, and another user's versions count for nothing", () =>
    inRolledBackTransaction(async (db) => {
      const other = await insertUser(db);
      for (const n of [1, 2, 3]) {
        await db
          .insert(s.cvVersions)
          .values({ userId: other, versionLabel: `CV v${n}`, language: "en", body: "Other CV." });
      }
      await db
        .insert(s.cvVersions)
        .values({ userId: other, versionLabel: "応募書類 v1", language: "ja", body: "他の人。" });

      const { post, versionsOf } = await setUp(db);
      expect((await post(cvRequest())).json.version_label).toBe("CV v1");
      expect((await post(cvRequest(`${CV}\nAWS certified.`))).json.version_label).toBe("CV v2");
      expect((await versionsOf(other)).map((version) => version.versionLabel).sort()).toEqual([
        "CV v1",
        "CV v2",
        "CV v3",
        "応募書類 v1",
      ]);
    }));

  it("is 502 cv_extraction_failed when the model call fails, and writes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { post, userId } = await setUp(db, () => {
        throw new ExtractionFailed("upstream_500");
      });
      const { status, json } = await post(cvRequest());

      expect(status).toBe(502);
      expect(json.error).toMatchObject({
        code: "cv_extraction_failed",
        detail: { error_class: "upstream_500" },
      });
      expect(await rowCounts(db, userId)).toEqual({ versions: 0, documents: 0, claims: 0 });
    }));

  it("is 502 cv_extraction_failed when no claim survives, and writes nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { post, userId } = await setUp(db, () => [
        { document: 0, quote: `Invented claim about ${SENTINEL}.`, start_hint: 0 },
      ]);
      const { status, json } = await post(cvRequest());

      expect(status).toBe(502);
      expect(json.error).toMatchObject({
        code: "cv_extraction_failed",
        detail: { error_class: "no_claims_survived", spans_checked: 1, spans_rejected: 1 },
      });
      expect(await rowCounts(db, userId)).toEqual({ versions: 0, documents: 0, claims: 0 });
    }));

  it("is all-or-nothing when a write fails after the version row is inserted", () =>
    inRolledBackTransaction(async (db) => {
      // A claim span past the end of what Postgres will accept is impossible through the handler, so
      // break the write instead: the claims insert fails, and the version and document must go too.
      const { post, userId } = await setUp(db);
      await db.execute(sql`savepoint break_claims`);
      await db.execute(sql`alter table cv_claims add constraint break_writes check (false) not valid`);
      const failure = await post(cvRequest()).catch((error: Error) => error);
      await db.execute(sql`rollback to savepoint break_claims`);
      // The driver's message carries the insert's params; none of it may escape (12 §7).
      expect(failure).toBeInstanceOf(Error);
      expect(String((failure as Error).message)).toBe("CV version write failed: pg_23514");
      for (const text of logged) expect(text).not.toContain(SENTINEL);
      expect(await rowCounts(db, userId)).toEqual({ versions: 0, documents: 0, claims: 0 });
    }));

  it("never puts CV text in an envelope or a log line, on success or on any failure", () =>
    inRolledBackTransaction(async (db) => {
      let mode: "ok" | "throw" | "none" = "ok";
      const { post, responses } = await setUp(db, () => {
        if (mode === "throw") throw new ExtractionFailed("upstream_500");
        if (mode === "none") return [{ document: 0, quote: `${SENTINEL} made up`, start_hint: 0 }];
        return CLAIMS;
      });

      await post(cvRequest(CV, { note: SENTINEL }));
      await post({ language: "en", documents: [{ kind: "cv", text: CV, [SENTINEL]: SENTINEL }] });
      await post(cvRequest(CV));
      mode = "throw";
      await post(cvRequest(`${CV}\nMore.`));
      mode = "none";
      await post(cvRequest(`${CV}\nMore still.`));

      expect(responses).toHaveLength(5);
      expect(logged.length).toBeGreaterThan(0);
      for (const text of [...responses, ...logged]) expect(text).not.toContain(SENTINEL);
      for (const text of responses) expect(text).not.toContain("Cut invoicing");
    }));
});
