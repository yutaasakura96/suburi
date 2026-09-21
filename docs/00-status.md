# Project status

**Project:** **Suburi** (素振り) — a private, turn-based voice interview simulator for practising job
interviews in Japanese and English, with rubric-scored feedback and tracked progress over time.
**Phase:** 6 — build, in progress. **The foundation slice is done:** spec
[#1](https://github.com/yutaasakura96/suburi/issues/1), tickets #2–#7, all closed. **`develop` is live
at https://suburi-develop.vercel.app.** **The first feature — getting a CV in — is specified and
ticketed:** spec [#11](https://github.com/yutaasakura96/suburi/issues/11), tickets #12–#21. #12 is
done; **#13 is done — built, and its catalogue passed the native read.** **#14 is done — the tracer
bullet: an English CV pasted, saved and read back underlined.** **#15 is done — the 応募書類 panel and
additional documents in both languages.** Next is #16.
**Updated:** 2026-09-21 (#15)

## Done
- Phase 1 — `docs/01-project-brief.md`, `docs/02-product-requirements.md`, `docs/06-decision-log.md`.
- Phase 2 — Direction B (Instrument) picked, nine screens drawn and reviewed. Decisions 19–30.
- Phase 3 — `docs/05-design-system.md`, `docs/10-screen-specifications.md`. Decisions 31–37.
- Phase 4 — `docs/03-technical-design.md`, `docs/04-database-schema.md`,
  `docs/08-auth-and-permissions.md`, **`CONTEXT.md`**. Twelve decisions appended.
  `01` and `02` amended for the tenancy reversal.
- Phase 4b — `docs/07-api-design.md`, `docs/11-testing-plan.md`, `docs/12-deployment.md`.
  Seventeen decisions appended. `CONTEXT.md` updated: six new open items, and the invariants now point
  at where they are enforced rather than only stated.
- **Repo created and pushed** — `github.com/yutaasakura96/suburi`, public. `main` and `develop` both
  exist and both track the remote. `.gitignore` written.
- Phase 5 — **`CLAUDE.md`** (6.9 KB) and **`.claude/settings.json`** (75 allow / 60 ask / 6 deny,
  four plugins named). No `.mcp.json`, no hooks, no agents, no rules — four decisions appended.
- Phase 5b — `/setup-matt-pocock-skills` run. `docs/agents/{issue-tracker,triage-labels,domain}.md`
  and an `## Agent skills` section in `CLAUDE.md`. GitHub Issues as the tracker, default triage
  labels, single-context domain docs. Two decisions appended.
- **Phase 5c — the four pre-build verifications are closed.** Transcription model, `after()` on Hobby,
  Hobby cron frequency, Neon PITR window. `03` §4, `07` §5.7/§5.10/§7, `12` §2/§6/§8 and `CONTEXT.md`
  all updated; four decisions appended. Two smaller TBDs remain, neither on that list and neither
  blocking: **Vercel's per-branch env var scoping** (`12` §3) and **Better Auth's session expiry
  defaults** (`08` §2). Both are confirm-at-implementation, not decide-in-advance.
- **Phase 5d — styling and components decided; the framework reason corrected.** Tailwind v4 CSS-first
  with `05` as the only palette, shadcn/ui on Base UI, `05` §10 written (token aliasing, `--accent` →
  `--mark` in code, `--radius: 0`, no score in a `Progress`/`Slider`). `03` §1's rejection of
  SvelteKit/Nuxt now gives the real reason, RSC. Still no `.mcp.json`. Five decisions appended.
- **Phase 6 started — the foundation slice grilled, specified and ticketed.** Spec #1; tickets #2–#7.
  #2 applied the decisions to the docs: seed by script, not migration (`email_verified = true`);
  sessions 30 days / 1 day (closes `08` §3); proxy, not middleware; branch-scoped Preview env vars on
  Hobby (closes `12` §3); the `05` §10.1 colour wipe verified; Postgres 17 → 18 everywhere; pinned
  versions in `03` §1; three Google redirect URIs including `localhost`. Nine entries in `06`.
- **#3 — the walking skeleton.** Next 16.3.5 scaffold, Zod config module (`lib/config.ts`, the only
  `process.env` read, checked at boot in `instrumentation.ts`), `.env.example`, Vitest `unit` and
  `integration` projects, Playwright on port 3100, CI green, Dependabot weekly. Two fallbacks taken
  and recorded in `06`: TypeScript 6.0.3 (typescript-eslint refuses TS 7) and a hand-assembled ESLint
  10 flat config instead of `eslint-config-next`.
- **#5 — the measurement record.** Docker Compose `pgvector/pgvector:pg18` on **host port 5433** (5432
  was taken locally), `db/schema.ts` for all of `04`, a custom `0000_enable-vector` migration then the
  generated `0001_measurement-record`, the eleven `11` §3.1 tests plus a new "Enumerated values" test,
  `11` §3.2 check 1, the idempotent user seed (`npm run db:seed`), and an integration step in CI
  against a pg18 service container. Three decisions from grilling, in `06`: restrict on every
  application FK (04's cascades and set null were wrong), value checks on every enumerated text column,
  `users.name` not null seeded from the email's local part. `12` §3 step 8 now says the user row only.
  Found in passing: `ON DELETE RESTRICT` raises SQLSTATE `23001`, not `23503`; the tests assert it.
- **#4 — the `05` palette and a static bilingual sign-in.** `app/globals.css` is `05` §2 in code: the
  `--color-*`/`--shadow-*` wipe, every token under its own name, the accent family as `--mark*`, and
  shadcn's variables aliased per §10.2 with no `.dark` block. shadcn 4.21.0 initialised on Base UI
  1.8.0; `components/ui/button.tsx` restyled in place to §5.7 (48px, square, 14px/0.04em, weight 400).
  `/sign-in` renders the §5.1 wordmark, one Google button labelled in Japanese with English beneath,
  and a refusal slot that reserves its height for #6. Four decisions in `06`, two of them from facts
  measured against the build: **`--radius: 0` alone does not square a vendored component** (its
  classes read Tailwind's `--radius-*` scale, so the derived scale is declared), and **Next 16.3.5's
  Turbopack build keeps the literal font-family name** and adds a metric-adjusted `… Fallback` face —
  which is the real reason each stack starts with the loader's variable. `03` §1 now pins `cn`,
  `class-variance-authority` and `tw-animate-css`, and records that `shadcn` is a build input because
  `globals.css` imports `shadcn/tailwind.css`.
  **The three Japanese strings passed a native read on 2026-09-19** — `Googleでログイン`,
  `このアカウントではログインできません。` and `素振り`, as written. #4 closed.
- **#6 — locked sign-in.** `lib/auth/auth.ts` is `createAuth({ db, transaction })` on the Drizzle
  adapter: 30-day sessions refreshed daily, cookies explicitly `HttpOnly; Secure; SameSite=Lax`,
  Google only with `disableSignUp`, and a session hook that refuses any email but `ALLOWED_EMAIL`
  and logs an HMAC email hash. The handler is at `app/api/auth/[...all]`. `proxy.ts` matches every
  path, redirects pages to `/sign-in` and answers `/api/*` with the `401` envelope.
  `lib/auth/session.ts` has the server-side re-checks. Home is `app/(app)/page.tsx`. The `/sign-in`
  button is a Server Action and the refusal line shows on any `?error=`. Seam 2 drives the real
  Google callback with only the token exchange stubbed; each lock was mutation-checked. **Correction
  found building it:** 1.7.4 also sets a signed `state` cookie with database state storage, so
  `nextCookies()` is load-bearing. CI now migrates the e2e database before Playwright. Eight entries
  in `06`.
- **#7 — `develop` deployed, both locks proven on real Google sign-in.** Neon project `suburi`
  (Postgres 18, `aws-ap-southeast-1`); `develop` is a Schema only branch with its own
  `suburi_develop` role and `suburi` database, migrated and seeded. One Google OAuth client, left in
  Testing, with redirect URIs for `localhost:3000`, `suburi-develop.vercel.app` and
  **`suburi-murex.vercel.app`** — production's name, because `suburi.vercel.app` was taken. The
  seven config variables sit in Vercel's Preview scope for the `develop` branch only; **Production
  holds none**, so `main`'s import deploy failed as expected. Verified 2026-09-19: local sign-in, the
  allowlisted account on `develop`, a second account refused (`signup_disabled` in the log), no
  pooled-connection errors, and `develop`'s credential refused by Neon `main` (`28P01`). Vercel's
  Deployment Protection stays on in front of `develop`. Four entries in `06`.
- **The first feature is grilled, specified and ticketed — spec #11, tickets #12–#21**, with native
  GitHub `blocked_by` edges: #12 (none) → #13 → #14 → #15/#17/#18 → #16/#19 → #20 → #21. #20 and #21
  are `ready-for-human`. A CV becomes **a set of documents per language**: `ja` a required 履歴書, an
  optional 職務経歴書 and up to five additional documents; `en` a required CV document and up to five.
  One immutable `cv_versions.body` per version with a new `cv_documents` table carrying each
  document's range; spans may not cross a document boundary; the Japanese stamp word becomes
  **`応募書類 v{n}`**.
- **#12 — the CV decisions are in the docs.** `CONTEXT.md` (vocabulary tightened: carry-forward is the
  *immediately* previous version of the same language, from any document; spans may not cross a
  boundary), `03` §4 (a fourth model job, CV extraction — synchronous, all-or-nothing, latency
  measured on the first real run) and §10 (`lib/cv/`, the extraction port), `04` (`cv_documents`, the
  unique `(user_id, language, version_label)` index, `source_filename` retired not dropped, three new
  §6 refusals), `05` §6 (`応募書類`, with the three prose strings that still say `職務経歴書` recorded
  rather than swapped), `07` §3 (`cv_unchanged`) and §5.2 (the `documents[]` request, composition
  rules, derived label, `422`/`502`/`429`), **`10` §13 — the CV screen, specified from `05` components
  with no artboard**, `12` (the synthetic CV seed described as it will be, `OPENAI_API_KEY`'s scope
  step, `source_filename` added to the never-log list). Twenty entries in `06`. No code changed.
  **One tension recorded rather than resolved:** #11 puts the extractor model string in code as a
  pinned constant, while `12` §2 holds the other three model strings as env vars. **Resolved
  2026-09-21: every model string is a constant in `lib/ai/models.ts`** (`03` §4, `12` §2, `06`).
- **#13 — the error envelope and the bilingual catalogue. Done.**
  `lib/api/errors.ts` is `07` §2 and §3 in code: `ERROR_STATUS` maps all **24** codes (`07` §3's 23
  rows, the last expanding to `upstream_s3` *and* `upstream_openai`) to their statuses, `ErrorCode` is
  `keyof` it, and `apiError(code, message, detail?)` reads the status from the table. `rateLimited()`
  is separate only because 429 must carry `Retry-After`, which is `Math.max(1, ceil(...))` so a wait
  never renders as "now". `unauthenticated()` moved onto the builder **byte-identical** — `proxy.ts`
  and `lib/auth/session.ts` are untouched. **`lib/copy/errors.ts` is new**, holding the `ja`/`en`
  sentence for every code and no status; `lib/api/` holds no user-visible string, so it cannot decide
  the open bilingual chrome rule by accident. `03` §10's layout gained both directories.
  **Units went 37 → 267.** Typecheck, lint and 38/38 integration all green.
  **The two catalogue guards were mutation-checked and are not redundant:** removing a code's copy is
  1 `tsc` error *and* 4 test failures; adding a copy key with no code is **0 `tsc` errors** and 2 test
  failures — so `11` §3.10's runtime test is the only thing covering that direction, which is why the
  doc says "both directions". Four decisions in `06`.
  **Found by the review pass, and fixed:** `練習モード` was synonym drift (`モード` appears **zero**
  times in `10`, `05` or `CONTEXT.md` — the modes are `実戦`/`練習`/`練習ラウンド`); `upstream_s3` and
  `upstream_openai` read alike and now name the service; a blanket `点` ban failed immediately on
  `採点`, so `05` §6's counter rule is narrowed to *a digit followed by* `点`. `05` §6 also gained the
  three rules the catalogue now enforces by test.
  **Native read passed 2026-09-21.** All 24 `ja` strings accepted, one word changed (`cv_unchanged`:
  `版` → `バージョン`). Settled: `質問` is the noun for a question and `出題` only the generator's stamp
  word; `バージョン`, never `版`; `応募書類` stands; the Claim word is deferred to the first screen that
  lists claims (`記載事項` leads). The first two are now enforced by test. `05` §6 and one entry in `06`.
- **#14 — the tracer bullet. Done.** `/cv` shows the English panel. It has an empty state, a paste box,
  and save. The saved version is shown with its label, date, claim count and every surviving claim
  underlined. `POST /api/cv-versions` accepts `en` with exactly one `cv` document. Its schema is strict,
  so a client-sent `version_label` is a `400`. The server derives the body, the document range,
  `CV v{n}` and both extractor stamps. The model call runs first, then one transaction writes
  everything, and a lost label race retries. Migration `0002` adds `cv_documents` and two
  `cv_versions` indexes: the label unique index and the current-version index. It is expand-only.
  `lib/ai/` holds the port, `models.ts` and a fake. The prompt is `lib/prompts/cv-extract-en-1.0.ts`.
  `lib/cv/` holds the span validator, body assembly, underline segments and `currentCvVersion`.
  `openai` 7.20.0 and `@next/env` 16.3.5 are pinned. **Six entries in `06`, two of them grilled
  during the build:**
  - **The extractor returns a verbatim quote and a start hint; the server locates the span.**
  - **Playwright fakes OpenAI with `e2e/mock-openai.ts` through a localhost-only `OPENAI_BASE_URL`.**
    Next's `testProxy` was tried first and **measured broken**: it hangs node-postgres on a signed-in
    request.
  - Spans count **Unicode code points**, which is what Postgres `substring` counts.
  - Playwright gets its own fresh `suburi_e2e` database.
  - The model call runs before the transaction.

  **Corrected in passing:** `11` §3.3's `請求処理を40%短縮` is 10 characters and 24 bytes, not 9 and 27.
  **Found by review, and fixed:** a database failure during the write used to rethrow drizzle's
  error. Its message carries the query params, so the CV body and claims would have reached the log.
  Now only `pg_<SQLSTATE>` leaves the handler, and the test asserts the sentinel reaches neither the
  log nor the thrown error. **`11` §3.10's sentinel bullet is now covered for this route**: success,
  `400`, both `502` paths and the write failure.
  **Counts:** units 37 → 328, integration 38 → 63, e2e 7 → 9.
  **Still open from #14:**
  - **Done 2026-09-21: `.env.local` has a real `OPENAI_API_KEY`**, from its own `suburi-local` OpenAI
    project with a $20/month hard cap, verified against `gpt-5.6-sol`. **`12` §6 is wrong about the cap:**
    a hard project limit returns `429 project_spend_limit_exceeded` (OpenAI's spend-limits guide), not
    a `503 model_unavailable`; fix it with the round loop. **The `.env` deny rules are gone from
    `.claude/settings.json`** (2026-09-21, the user's call): Claude may read every `.env*` file and must
    never echo a value into output, a log, a commit or a doc. **Rotate every value in them once the
    project is signed off** — Google client secret, `BETTER_AUTH_SECRET`, Neon role passwords, the
    OpenAI key.
  - **A database failure mid-write is a bare `500`, not the `07` §2 envelope.** The closed catalogue
    has no code for it. Decide whether to add one (with copy in both languages and a native read) or
    accept Next's `500`.
  - The `201` has no `Location`, because no GET exists.
  - "`404` for another user's version" is covered as scoping (numbering and `currentCvVersion`),
    because no route addresses a version by id.
- **#15 — the Japanese CV and additional documents. Done.** `/cv` now has both panels, `応募書類` left
  and `CV` right, each with its chrome in its own language (`lang` on the region). The Japanese form
  has the 履歴書 box with the personal-particulars hint, `職務経歴書を追加` until one exists, and in both
  panels up to five titled supporting documents, each removable with `外す` / `Remove`.
  `POST /api/cv-versions` takes both languages and enforces `04`'s composition. It also enforces **one
  order, refused rather than sorted**, so `position` is the request index. The port is now
  `extract(language, documents)` with `promptVersions`. It sends each document's kind and title in its
  header. Prompts: **`cv-extract-ja-1.0`** is new, and English moved to **`cv-extract-en-1.1`** because
  the header changed. `1.0` is kept, unedited. The panel is one `CvPanel`, with its copy in
  `app/(app)/cv/copy.ts`; `english-panel.tsx` is gone. **Six entries in `06`, three of them grilled:**
  - order is refused, not repaired;
  - the size cap is #20's, measured — **add it to #20's checklist**;
  - **Claim is `記載事項`**. `10` §13's `版` became `バージョン` under #13's rule, and `copy.test.ts`
    enforces both.

  **New Japanese strings for #20's read:** `外す`, `資料名`, `本文`, `補足資料` (as the group name),
  `記載事項 {n}件`, `記載事項を抽出しています。しばらくかかることがあります。`, the result line's
  `{n}件を除外。`, and every `10` §13 string as amended (`このバージョンを保存する`,
  `保存すると、この内容でバージョンが確定します。…`, `…前のバージョンから引き継ぎ…`).
  **Counts:** units 328 → 387, integration 63 → 84, e2e 9 → 11.
  **Not done here, by ticket:** `cv_unchanged`, prefill and history are #16. Import is #17. The rate
  limiter is #18. The size cap is #20.
- **Still deferred, not done:** `11` §3.10's third bullet — forcing each failure with sentinel text and
  scanning every envelope for it — needs routes to exist. It belongs to #14 onward. What #13 gives is
  structural: `ErrorDetailValue` is flat, so a nested object cannot be dropped into `detail`, and the
  catalogue has no interpolation slot.
- **Local machine gotcha:** npm 11.3.0 crashes on install (`edgesOut`); use `npx -y npm@latest install`.
- **`next start` refuses to boot without the seven env vars**, so Playwright needs them locally; CI
  supplies well-formed placeholders in `.github/workflows/ci.yml`. Turbopack also emits stylesheets to
  `.next/static/chunks`, not `.next/static/css` — the built-CSS assertion searches the static tree.

**Design canvas:** https://claude.ai/code/artifact/8d50e302-ed9c-48d4-ab00-c0e4e5da0788
Page 1 is the screen set, page 2 the three exploration directions. **Working files** in `design/`;
every change re-seeds from those — edit them, never the built `design/suburi-directions.html`.

## Next
**#16, next CV versions** — prefill, carry-forward, `cv_unchanged`, history. It is unblocked by
#15. The form in `app/(app)/cv/cv-panel.tsx` starts from one empty required document, and #16 seeds
it from the current version instead. `cv_unchanged` compares kind, title and text in order, and
because order is refused rather than sorted (`06`, #15), that is a plain index-by-index comparison.
#17 (import) and #18 (rate limiter) are also unblocked.

**Still waiting on a native read, with the screens that carry them (#14–#16):** the strings in `10`
§13 (as amended in #15), the 履歴書 personal-particulars hint, `記載事項`, #15's new strings, and the three prose strings
that still say `職務経歴書` where they mean the set (`05` §6).

**The three deploy fixes, #10, are closed:** `agentRules: false`; only `main` and `develop` deploy
(`vercel.json`); remote database URLs must carry `sslmode=verify-full`, which `lib/config.ts` now
enforces. Verified 2026-09-19 by a real sign-in on `develop` at `a1ab03c`: no pg `SECURITY WARNING`
in the runtime log. Three entries in `06`.

**Local machine:** node comes from asdf, which non-interactive shells do not load — a wizard or `!`
command that runs `node` fails with `env: node: No such file or directory`.

**One-time setup: done.** `/setup-matt-pocock-skills` has been run — `docs/agents/issue-tracker.md`,
`docs/agents/triage-labels.md`, `docs/agents/domain.md`, and an `## Agent skills` section in
`CLAUDE.md`. **Issues live in GitHub Issues**, not local files: the earlier note here said to choose
local markdown because Backlog (Nulab) is unsupported, but that overlooked the working GitHub remote.
`gh` gives `triage` its label queries and `wayfinder` its native dependency graph. Reversal recorded
in `06` under Phase 5b, along with why `docs/adr/` is deliberately not created.

**Then, per feature:** `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement`. Small changes
collapse to grill → implement. The flow is in `~/Documents/GitHub/claude-setup-inventory/mattpocock-skills-guide.md`;
keep grill → spec → tickets inside one unbroken window.

**The pre-build verifications are done** — this list is closed, and nothing here blocks a ticket:
- **Transcription: `gpt-transcribe`, $0.0045/min.** Needs API Tier 1+. Its only snapshot shares its
  name, so it cannot be alias-pinned the way scoring is; the `transcriber_model_id` stamp is the guard.
- **`after()` works on Hobby** — the scoring trigger moved into `submit`; `run` is now the retry path.
  The 300s ceiling is the **whole invocation**, retries included, and Hobby cannot raise it.
- **Hobby cron is daily-only, ±59 min.** The `pending` threshold is 24 hours. Two routes still fine.
- **Neon Free PITR is 6 hours, and 6 is the maximum.** The `pg_dump` is now **daily**, not weekly.

## Blocked
_(nothing)_

## Carrying

**The stack, fixed:** Next.js (App Router) + TypeScript on Vercel · Tailwind v4 · shadcn/ui on Base UI ·
Drizzle · Postgres 18 +
`pgvector` on Neon, Docker locally · Better Auth with Google as the only IdP · AWS S3 for audio ·
OpenAI `gpt-5.6-sol` pinned for all three model jobs.

**Two decisions that will look wrong later without their reason:**
- **Multi-tenant schema, single-user door.** `user_id` on every table; Google-only sign-in with
  `disableSignUp: true` and a hardcoded allowlist. This **reversed PRD §1**, which has been amended.
  Multi-tenancy is **not** permission to build sharing — refusal #6 is untouched.
- **Screen 7 (felt pressure) is now load-bearing for latency**, not only for the brief's
  falsification test. Answers are scored as submitted; screen 7 is where the last answer's score
  lands. **Do not make it skippable in realistic mode** — `11` §4 has a test asserting it is not.

**Three shapes from 4b worth not re-deriving:**
- **The round loop is four calls per answer** — open the answer slot (which creates the row and
  presigns), PUT to S3, transcribe, submit. The answer row existing before the audio does is what makes
  transcribe and submit idempotent, and a duplicate answer row is a corrupted measurement, not an
  annoyance.
- **`422` is the "an invariant refused this" code**, and its `code` names which. `403` is used nowhere;
  another user's row is `404`.
- **Migrations are manual, expand-only, and run before the deploying push.** That is exactly what makes
  Vercel's instant rollback a complete rollback story.

**The branch model, decided after 4b was written:** `main` → Vercel production → Neon `main`; `develop`
→ a stable Vercel URL → Neon `develop`, seeded synthetic. Feature branches come off `develop` and share
its database. **Nothing but `main` points at Neon `main`.** Three consequences that are easy to miss and
are written up in `12` §1/§4: `develop` needs a *stable* domain because Google's redirect URIs are an
exact-match list (so feature branches are not deployed at all); Neon `develop` is reset from a fresh seed,
never branched from `main`, or the real CV lands on a branch unfinished code writes to; and Neon `main`
is migrated *before* `develop` merges into it.

**Verified facts worth not re-deriving:** Vercel Hobby functions run to 300s — **default and maximum,
covering the whole invocation** including `after()` work and its retries — and cap bodies at 4.5 MB (so
audio must go browser → S3 directly). Hobby cron is **once per day, ±59 min**, and a tighter expression
fails the deploy. Neon Free keeps **6 hours of history, 6 being the maximum**. OpenAI per 1M tokens:
`astra` $10/$50, `sol` $4/$20, `terra` $2/$12, `luna` $0.20/$1.20 — roughly **$0.40/round on Sol**, plus
**~$0.11/round of `gpt-transcribe` at $0.0045/min**; a few dollars for the whole 30-day target. At 1,000
users model spend would dominate infrastructure by two orders of magnitude.

**The three free-tier ceilings are all hard.** None of 300s, daily cron, or 6-hour PITR can be raised
without changing plan. Each already has its answer written into `12` — do not rediscover them as
surprises mid-ticket.

**Hard constraints for every later phase**, restated in `CONTEXT.md` and `10-screen-specifications.md`
§11: no composite score ever; round-end feedback renders while the user is still at the machine;
first attempts are never overwritten; raw transcripts are never discarded; every scored answer
carries its four version stamps; nothing is hard-deleted; all data private, no sharing surface.
**Enforced** in `04` §6, `07` §6 and `11` §3 — a ticket that needs one relaxed edits those first.

**Japanese copy needs a native read on every new string.** Rules so far in `05-design-system.md` §6.
The error-code catalogue in `07` §3 is closed but **none of its copy is written**, in either language.

**Open, and not to be silently decided in a ticket** (full list in `CONTEXT.md` — six items were added
in 4b):
- **The bilingual chrome rule** — does chrome follow the round's language or the app's? Still a copy
  decision. `07` §2 routes every user-visible string through the copy layer so the API does not decide
  it by accident. The CV screen answers it **for itself only** — each panel's chrome in its own
  language, because each panel is about one language's documents (`10` §13).
- **The near-duplicate similarity threshold** — a guess until there is real data. `12` §6 puts the
  near-miss log in the weekly digest so it is tunable from data.
- **CV claim extraction quality** — still unmeasured. `07` §5.2 returns `spans_rejected` and `12` §6
  alerts on it being non-zero; the CV screen renders claim spans underlined in the user's own text so
  it can be read off directly (`10` §13). The check runs on the **real CV, locally** (#20) — that is
  what closes this, not the screen shipping.
- **Who sends the alert mail.** `08` §2 avoided an email vendor deliberately; `12` §6 reintroduces one
  as a placeholder.
- **One drawn-but-unspecified screen:** practice mode's record frames differ from realistic mode's.
  `10-screen-specifications.md` §12. **The CV screen came off this list in #12** — still no artboard,
  but specified in `10` §13 from `05` components.

**The weakest link in the whole plan, named so it is not forgotten:** the backup restore is untested.
`11` §9 says so and `12` §8 schedules the drill — restore into a Neon branch immediately after the
first production deploy and read a round back whole. An untested restore is a hope, and it is guarding
the only irreplaceable thing here.

- Remote is `github.com/yutaasakura96/suburi` (public). Work on `develop`; release by PR into `main`.
- **`mattpocock-skills` is now `true` in `.claude/settings.json`** — project scope beats the global
  `false`, so the grill commands are available here. `frontend-design` is pinned `false` in the same
  file, deliberately; `06` records why. `superpowers` was uninstalled machine-wide on 2026-09-20 and
  its key is gone from this file.
- **No hooks, by decision.** Nothing blocks an edit or a push on `main`, so `12` §4's "nothing is
  committed straight to `main`" is a convention in `CLAUDE.md`, not a mechanism. What still guards the
  measurement record: manual expand-only migrations, and `drizzle-kit migrate`/`push`/`drop`, `psql`,
  `pg_dump`, all `aws` and every writing Neon MCP tool sitting in `permissions.ask`.

## Skipped
- **`09-user-flows.md`** — covered by PRD §5's user stories and `10`'s per-screen state
  specifications. My call in Phase 4, not the user's — say so if you disagree and it gets written.
  `07` §5 now also gives the round loop call by call, which covers the same ground a third time.
- **`13-infrastructure-and-security.md`** — the Tier 2 trigger (multiple services, IaC, networking
  beyond one app on a PaaS) is not met: one Next.js app, one managed database, one bucket. The
  mandatory security baseline is answered in full in `03` §9, and `12` §3 and §7 now carry the bucket
  policy, IAM scope, CORS and log-scrubbing detail. Revisit when the AWS Lightsail platform the user
  plans actually exists.
