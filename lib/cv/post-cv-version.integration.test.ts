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
  respond: Parameters<typeof fakeCvClaimExtractor>[0] = () => CLAIMS,
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
  async function post(body: unknown, { signedIn = true, as = cookie } = {}) {
    const response = await handler(
      new Request("http://localhost:3000/api/cv-versions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signedIn ? { cookie: `${as.name}=${as.value}` } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    responses.push(text);
    return { status: response.status, json: JSON.parse(text), retryAfter: response.headers.get("Retry-After") };
  }

  /** A second sign-in by the same user: a different session, so a different rate-limit bucket. */
  const anotherSession = () => mintSessionCookie(auth, user.id);

  async function versionsOf(userId = user.id) {
    return db.select().from(s.cvVersions).where(eq(s.cvVersions.userId, userId));
  }

  return { userId: user.id, extractor, post, responses, versionsOf, anotherSession };
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
    ["an unknown language", { ...cvRequest(), language: "fr" }, ["language"]],
    ["an empty document", cvRequest("  \n "), ["documents.0.text"]],
    ["a client-chosen version label", cvRequest(CV, { version_label: "CV v9" }), ["body"]],
    [
      "a second cv document",
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

// 04 / 07 §5.2: the composition rules, and a set of several documents joined into one body.

const RIREKISHO = [
  "氏名 山田 花子",
  "生年月日 1990年1月1日",
  "2016年3月 架空大学 情報学部 卒業",
  "基本情報技術者試験 合格",
].join("\n");
const SHOKUMU = "経理システムの刷新を主導し、請求処理を40%短縮。チーム5名を統括。";
const PORTFOLIO = "Built an interview simulator in Next.js.";

const rirekisho = { kind: "rirekisho", text: RIREKISHO };
const shokumu = { kind: "shokumu_keirekisho", text: SHOKUMU };
const additional = (title: string, text = PORTFOLIO) => ({ kind: "additional", title, text });
const cv = { kind: "cv", text: CV };

const JA_CLAIMS: ExtractedClaim[] = [
  { document: 0, quote: "2016年3月 架空大学 情報学部 卒業", start_hint: 24 },
  { document: 1, quote: "請求処理を40%短縮。", start_hint: 14 },
  { document: 2, quote: PORTFOLIO, start_hint: 0 },
];

describe("POST /api/cv-versions composition", () => {
  it.each([
    ["an empty set", { language: "ja", documents: [] }, ["documents"]],
    ["a 応募書類 with no 履歴書", { language: "ja", documents: [shokumu] }, ["documents"]],
    ["two 履歴書", { language: "ja", documents: [rirekisho, rirekisho] }, ["documents"]],
    ["two 職務経歴書", { language: "ja", documents: [rirekisho, shokumu, shokumu] }, ["documents"]],
    ["a cv document in a 応募書類", { language: "ja", documents: [rirekisho, cv] }, ["documents.1.kind"]],
    ["a 履歴書 in an English CV", { language: "en", documents: [cv, rirekisho] }, ["documents.1.kind"]],
    [
      "a 職務経歴書 in an English CV",
      { language: "en", documents: [cv, shokumu] },
      ["documents.1.kind"],
    ],
    ["an English CV with no cv document", { language: "en", documents: [additional("Portfolio")] }, ["documents"]],
    [
      "six additional documents",
      { language: "en", documents: [cv, ...[1, 2, 3, 4, 5, 6].map((n) => additional(`Doc ${n}`))] },
      ["documents"],
    ],
    ["an unknown kind", { language: "ja", documents: [rirekisho, { kind: "portfolio", text: PORTFOLIO }] }, ["documents.1.kind"]],
    [
      "an additional document with no title",
      { language: "ja", documents: [rirekisho, { kind: "additional", text: PORTFOLIO }] },
      ["documents.1.title"],
    ],
    ["an additional document with a blank title", { language: "ja", documents: [rirekisho, additional("  ")] }, ["documents.1.title"]],
    ["a title on a 履歴書", { language: "ja", documents: [{ ...rirekisho, title: "履歴書" }] }, ["documents.0"]],
    ["the 職務経歴書 before the 履歴書", { language: "ja", documents: [shokumu, rirekisho] }, ["documents"]],
    [
      "the 職務経歴書 after an additional document",
      { language: "ja", documents: [rirekisho, additional("ポートフォリオ"), shokumu] },
      ["documents"],
    ],
    ["an additional document before the cv", { language: "en", documents: [additional("Portfolio"), cv] }, ["documents"]],
  ])("is 400 for %s, naming the field and calling no model", (_, body, fields) =>
    inRolledBackTransaction(async (db) => {
      const { post, extractor, userId } = await setUp(db);
      const { status, json } = await post(body);
      expect(status).toBe(400);
      expect(json.error).toMatchObject({ code: "invalid_request", detail: { fields } });
      expect(extractor.calls).toBe(0);
      expect(await rowCounts(db, userId)).toEqual({ versions: 0, documents: 0, claims: 0 });
    }));

  it("saves 応募書類 v1 from all three kinds: joined in order, each range recorded, the ja prompt stamped", () =>
    inRolledBackTransaction(async (db) => {
      let sent: { language: string; documents: readonly ExtractionDocument[] } | undefined;
      const { post } = await setUp(db, (documents, language) => {
        sent = { language, documents };
        return JA_CLAIMS;
      });
      const { status, json } = await post({
        language: "ja",
        documents: [rirekisho, shokumu, { ...additional("ポートフォリオ"), source_filename: "portfolio.pdf" }],
      });

      expect(status).toBe(201);
      const [r, k, p] = [RIREKISHO, SHOKUMU, PORTFOLIO].map((text) => [...text].length);
      expect(json).toMatchObject({
        version_label: "応募書類 v1",
        language: "ja",
        extractor_prompt_version: "cv-extract-ja-fake",
        documents: [
          { kind: "rirekisho", title: null, start: 0, end: r },
          { kind: "shokumu_keirekisho", title: null, start: r + 2, end: r + 2 + k },
          { kind: "additional", title: "ポートフォリオ", start: r + k + 4, end: r + k + 4 + p },
        ],
        claims: { total: 3 },
        validation: { spans_checked: 3, spans_rejected: 0 },
      });

      // The model is told what each document is, so it can leave a 履歴書's particulars alone.
      expect(sent).toEqual({
        language: "ja",
        documents: [
          { kind: "rirekisho", title: null, text: RIREKISHO },
          { kind: "shokumu_keirekisho", title: null, text: SHOKUMU },
          { kind: "additional", title: "ポートフォリオ", text: PORTFOLIO },
        ],
      });

      const [version] = await db.select().from(s.cvVersions).where(eq(s.cvVersions.id, json.id));
      expect(version.body).toBe([RIREKISHO, SHOKUMU, PORTFOLIO].join("\n\n"));
      const documents = await db
        .select()
        .from(s.cvDocuments)
        .where(eq(s.cvDocuments.cvVersionId, json.id));
      expect(
        documents
          .sort((a, b) => a.position - b.position)
          .map(({ kind, title, position, sourceFilename }) => ({ kind, title, position, sourceFilename })),
      ).toEqual([
        { kind: "rirekisho", title: null, position: 0, sourceFilename: null },
        { kind: "shokumu_keirekisho", title: null, position: 1, sourceFilename: null },
        { kind: "additional", title: "ポートフォリオ", position: 2, sourceFilename: "portfolio.pdf" },
      ]);

      const claims = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, json.id));
      expect(claims.map((claim) => sliceQuote(version.body, { start: claim.spanStart, end: claim.spanEnd })).sort())
        .toEqual(JA_CLAIMS.map((claim) => claim.quote).sort());
    }));

  it("logs the body's size in code points and its document count, on success and on both extraction failures", () =>
    inRolledBackTransaction(async (db) => {
      // #20 sets the size cap from these lines: a duration is only measurable beside a size.
      let mode: "ok" | "throw" | "none" = "ok";
      const { post } = await setUp(db, () => {
        if (mode === "throw") throw new ExtractionFailed("upstream_500");
        if (mode === "none") return [{ document: 0, quote: "not in the document", start_hint: 0 }];
        return JA_CLAIMS;
      });
      const documents = [rirekisho, shokumu, additional("ポートフォリオ", `${PORTFOLIO} 𠮷`)];
      const expected = [RIREKISHO, SHOKUMU, `${PORTFOLIO} 𠮷`].map((text) => [...text].length).reduce((a, b) => a + b) + 4;

      await post({ language: "ja", documents });
      mode = "throw";
      await post({ language: "ja", documents: [rirekisho, shokumu, additional("ポートフォリオ", `${PORTFOLIO} 𠮷!`)] });
      mode = "none";
      await post({ language: "ja", documents: [rirekisho, shokumu, additional("ポートフォリオ", `${PORTFOLIO} 𠮷?`)] });

      const lines = logged.map((text) => JSON.parse(text) as Record<string, unknown>);
      expect(lines.filter((line) => /^cv_(version_created|extraction_failed)$/.test(String(line.event)))).toEqual([
        expect.objectContaining({ event: "cv_version_created", documents: 3, body_chars: expected }),
        expect.objectContaining({ event: "cv_extraction_failed", error_class: "upstream_500", documents: 3, body_chars: expected + 1 }),
        expect.objectContaining({ event: "cv_extraction_failed", error_class: "no_claims_survived", documents: 3, body_chars: expected + 1 }),
      ]);
    }));

  it("takes additional documents in either language, in either set's language", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, (documents) =>
        documents.map((document, index) => ({ document: index, quote: document.text, start_hint: 0 })),
      );
      const ja = await post({ language: "ja", documents: [rirekisho, additional("Portfolio", PORTFOLIO)] });
      const en = await post({
        language: "en",
        documents: [cv, additional("Portfolio"), additional("職務経歴書（日本語）", SHOKUMU)],
      });

      expect(ja.status).toBe(201);
      expect(en.status).toBe(201);
      expect(ja.json.version_label).toBe("応募書類 v1");
      expect(en.json).toMatchObject({
        version_label: "CV v1",
        extractor_prompt_version: "cv-extract-en-fake",
        documents: [{ kind: "cv" }, { kind: "additional", title: "Portfolio" }, { kind: "additional", title: "職務経歴書（日本語）" }],
        claims: { total: 3 },
      });
    }));

  it("accepts a 応募書類 with five additional documents and no 職務経歴書", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, () => [{ document: 0, quote: "基本情報技術者試験 合格", start_hint: 40 }]);
      const { status, json } = await post({
        language: "ja",
        documents: [rirekisho, ...[1, 2, 3, 4, 5].map((n) => additional(`資料${n}`, `補足${n}`))],
      });
      expect(status).toBe(201);
      expect(json.documents.map((document: { title: string | null }) => document.title)).toEqual([
        null,
        "資料1",
        "資料2",
        "資料3",
        "資料4",
        "資料5",
      ]);
    }));

  it("drops and counts a claim whose quote runs from one document into the next", () =>
    inRolledBackTransaction(async (db) => {
      const { post, userId } = await setUp(db, () => [
        ...JA_CLAIMS,
        // The join between the 履歴書 and the 職務経歴書, attributed to either side.
        { document: 0, quote: `基本情報技術者試験 合格\n\n経理システム`, start_hint: 40 },
        { document: 1, quote: `基本情報技術者試験 合格\n\n経理システム`, start_hint: 0 },
      ]);
      const { status, json } = await post({ language: "ja", documents: [rirekisho, shokumu, additional("ポートフォリオ")] });

      expect(status).toBe(201);
      expect(json.claims.total).toBe(3);
      expect(json.validation).toEqual({ spans_checked: 5, spans_rejected: 2 });
      expect((await rowCounts(db, userId)).claims).toBe(3);

      const [version] = await db.select().from(s.cvVersions).where(eq(s.cvVersions.id, json.id));
      const ranges = json.documents as { start: number; end: number }[];
      const claims = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, version.id));
      for (const claim of claims) {
        expect(ranges.some((range) => range.start <= claim.spanStart && claim.spanEnd <= range.end)).toBe(true);
      }
    }));

  it("numbers each language on its own: 応募書類 v1 beside CV v1, then 応募書類 v2", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, (documents) => [{ document: 0, quote: documents[0].text, start_hint: 0 }]);
      expect((await post({ language: "en", documents: [cv] })).json.version_label).toBe("CV v1");
      expect((await post({ language: "ja", documents: [rirekisho] })).json.version_label).toBe("応募書類 v1");
      expect((await post({ language: "ja", documents: [rirekisho, shokumu] })).json.version_label).toBe(
        "応募書類 v2",
      );
    }));
});

// #16: next versions. The fake quotes every non-blank line of every document as one claim, so each
// test states its claims as lines.

function everyLine(documents: readonly ExtractionDocument[]): ExtractedClaim[] {
  return documents.flatMap((document, index) =>
    document.text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((quote) => ({ document: index, quote, start_hint: 0 })),
  );
}

const en = (text: string, ...more: { title: string; text: string }[]) => ({
  language: "en",
  documents: [{ kind: "cv", text }, ...more.map(({ title, text: body }) => additional(title, body))],
});

async function claimsOf(db: TestDb, versionId: string) {
  const rows = await db.select().from(s.cvClaims).where(eq(s.cvClaims.cvVersionId, versionId));
  return rows.sort((a, b) => a.spanStart - b.spanStart);
}

describe("POST /api/cv-versions next versions", () => {
  it("carries forward byte-identical claims from v1; one character different is new", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      const v1 = await post(en("Led a team of 5.\nCut invoicing time by 40%.\nBSc, 2016."));
      const v2 = await post(en("Led a team of 5.\nCut invoicing time by 41%.\nBSc, 2016."));

      expect(v2.status).toBe(201);
      expect(v2.json.version_label).toBe("CV v2");
      expect(v2.json.claims).toEqual({ total: 3, carried_forward: 2, new: 1 });
      const [led, cut, bsc] = await claimsOf(db, v1.json.id);
      expect((await claimsOf(db, v2.json.id)).map((claim) => claim.supersedesClaimId)).toEqual([led.id, null, bsc.id]);
      expect(cut.supersedesClaimId).toBeNull();
    }));

  it("carries forward across a whitespace-only difference", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      const v1 = await post(en("Cut invoicing time by 40%."));
      const v2 = await post(en("Cut  invoicing time\tby 40%."));

      expect(v2.json.claims).toEqual({ total: 1, carried_forward: 1, new: 0 });
      const [previous] = await claimsOf(db, v1.json.id);
      expect((await claimsOf(db, v2.json.id))[0].supersedesClaimId).toBe(previous.id);
    }));

  it("never matches two versions back, and follows a three-version chain", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      const v1 = await post(en("Alpha.\nBeta."));
      const v2 = await post(en("Alpha.\nGamma."));
      const v3 = await post(en("Alpha.\nBeta."));

      expect(v3.json.claims).toEqual({ total: 2, carried_forward: 1, new: 1 });
      const [alpha1] = await claimsOf(db, v1.json.id);
      const [alpha2] = await claimsOf(db, v2.json.id);
      const [alpha3, beta3] = await claimsOf(db, v3.json.id);
      expect(alpha3.supersedesClaimId).toBe(alpha2.id);
      expect(alpha2.supersedesClaimId).toBe(alpha1.id);
      expect(alpha1.supersedesClaimId).toBeNull();
      expect(beta3.supersedesClaimId).toBeNull();
    }));

  it("carries forward a claim moved from the 職務経歴書 into a supporting document", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      const v1 = await post({ language: "ja", documents: [rirekisho, shokumu] });
      const v2 = await post({ language: "ja", documents: [rirekisho, additional("職務の要約", SHOKUMU)] });

      expect(v2.json.version_label).toBe("応募書類 v2");
      expect(v2.json.claims.new).toBe(0);
      const previous = await claimsOf(db, v1.json.id);
      const moved = (await claimsOf(db, v2.json.id)).find((claim) => claim.textNormalised === SHOKUMU);
      expect(moved?.supersedesClaimId).toBe(previous.find((claim) => claim.textNormalised === SHOKUMU)?.id);
    }));

  it("never carries forward from the other language", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      await post(en(PORTFOLIO));
      const ja = await post({ language: "ja", documents: [rirekisho, additional("Portfolio")] });
      expect(ja.json.claims.carried_forward).toBe(0);
    }));

  it("points duplicates at the previous claim with the lowest span_start, many-to-one", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db, everyLine);
      const v1 = await post(en("Led a team of 5.\nBSc, 2016.", { title: "Portfolio", text: "Led a team of 5." }));
      const v2 = await post(en("Led a team of 5.\nMSc, 2020.", { title: "Summary", text: "Led a team of 5." }));

      expect(v2.json.claims).toEqual({ total: 3, carried_forward: 2, new: 1 });
      const [first] = await claimsOf(db, v1.json.id);
      const led = (await claimsOf(db, v2.json.id)).filter((claim) => claim.textNormalised === "Led a team of 5.");
      expect(led.map((claim) => claim.supersedesClaimId)).toEqual([first.id, first.id]);
    }));

  it("is 422 cv_unchanged for an identical set, calling no model and writing nothing", () =>
    inRolledBackTransaction(async (db) => {
      const { post, extractor, userId } = await setUp(db, everyLine);
      const set = { language: "ja", documents: [rirekisho, shokumu, additional("ポートフォリオ")] };
      const v1 = await post(set);
      const before = await rowCounts(db, userId);

      // source_filename is not part of the comparison (06, #16).
      const again = await post({
        ...set,
        documents: set.documents.map((document) => ({ ...document, source_filename: "cv.docx" })),
      });
      expect(again.status).toBe(422);
      expect(again.json.error).toMatchObject({ code: "cv_unchanged", detail: { language: "ja" } });
      expect(extractor.calls).toBe(1);
      expect(await rowCounts(db, userId)).toEqual(before);

      // Any one change is a new version: a title, one space, a removed document.
      const retitled = await post({ ...set, documents: [rirekisho, shokumu, additional("作品集")] });
      expect(retitled.json.version_label).toBe("応募書類 v2");
      expect(v1.json.version_label).toBe("応募書類 v1");
    }));

  it("is 422 cv_unchanged when an identical save commits while this one is extracting", () =>
    inRolledBackTransaction(async (db) => {
      let inner: Awaited<ReturnType<typeof post>> | undefined;
      const { post, userId, extractor } = await setUp(db, async (documents) => {
        // The second request's model call: the other tab's identical save lands meanwhile.
        if (extractor.calls === 2) inner = await post(en("Led a team of 5.\nAWS certified."));
        return everyLine(documents);
      });
      await post(en("Led a team of 5."));
      const result = await post(en("Led a team of 5.\nAWS certified."));

      expect(inner?.json.version_label).toBe("CV v2");
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe("cv_unchanged");
      expect((await rowCounts(db, userId)).versions).toBe(2);
    }));

  it("dates each version by when it was written, so the newest label is the current version", () =>
    inRolledBackTransaction(async (db) => {
      // One test transaction: now() is the same instant for both saves, clock_timestamp() is not.
      const { post, versionsOf } = await setUp(db, everyLine);
      await post(en("Alpha."));
      await post(en("Beta."));
      const [v1, v2] = (await versionsOf()).sort((a, b) => a.versionLabel.localeCompare(b.versionLabel));
      expect(v2.createdAt.getTime()).toBeGreaterThan(v1.createdAt.getTime());
    }));
});

describe("POST /api/cv-versions rate limit", () => {
  it("is 429 rate_limited with Retry-After on the seventh request in the window, calling no model", () =>
    inRolledBackTransaction(async (db) => {
      const { post, extractor, userId } = await setUp(db);
      // Refused requests count too: the limiter runs before the body is parsed (07 §1 rule 5).
      for (let i = 0; i < 6; i++) expect((await post("not json")).status).toBe(400);

      const { status, json, retryAfter } = await post(cvRequest());
      expect(status).toBe(429);
      expect(json.error.code).toBe("rate_limited");
      expect(Number(retryAfter)).toBeGreaterThan(590);
      expect(Number(retryAfter)).toBeLessThanOrEqual(600);
      expect(extractor.calls).toBe(0);
      expect((await rowCounts(db, userId)).versions).toBe(0);
    }));

  it("does not count or limit a request with no session", () =>
    inRolledBackTransaction(async (db) => {
      const { post } = await setUp(db);
      for (let i = 0; i < 7; i++) expect((await post(cvRequest(), { signedIn: false })).status).toBe(401);
      expect((await post(cvRequest())).status).toBe(201);
    }));

  it("leaves another session unaffected", () =>
    inRolledBackTransaction(async (db) => {
      const { post, anotherSession } = await setUp(db);
      for (let i = 0; i < 7; i++) await post("not json");
      expect((await post(cvRequest())).status).toBe(429);

      const { status } = await post(cvRequest(), { as: await anotherSession() });
      expect(status).toBe(201);
    }));
});
