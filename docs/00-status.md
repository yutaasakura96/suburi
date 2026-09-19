# Project status

**Project:** **Suburi** (素振り) — a private, turn-based voice interview simulator for practising job
interviews in Japanese and English, with rubric-scored feedback and tracked progress over time.
**Phase:** 6 — build, in progress. **The foundation slice is specified and ticketed:** spec
[#1](https://github.com/yutaasakura96/suburi/issues/1), tickets #2–#7. **All six have landed**; #4
stays open only for the native read of three Japanese strings. **`develop` is live at
https://suburi-develop.vercel.app.**
**Updated:** 2026-09-19

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
  **The three Japanese strings await a native read** — `Googleでログイン`,
  `このアカウントではログインできません。` and the existing `素振り` — so #4 stays open until they are read.
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
- **Local machine gotcha:** npm 11.3.0 crashes on install (`edgesOut`); use `npx -y npm@latest install`.
- **`next start` refuses to boot without the seven env vars**, so Playwright needs them locally; CI
  supplies well-formed placeholders in `.github/workflows/ci.yml`. Turbopack also emits stylesheets to
  `.next/static/chunks`, not `.next/static/css` — the built-CSS assertion searches the static tree.

**Design canvas:** https://claude.ai/code/artifact/8d50e302-ed9c-48d4-ab00-c0e4e5da0788
Page 1 is the screen set, page 2 the three exploration directions. **Working files** in `design/`;
every change re-seeds from those — edit them, never the built `design/suburi-directions.html`.

## Next
**The foundation slice is done** (#4 still waits on the native read). Next is the first feature,
by the per-feature flow below.

**Three small fixes found while deploying, none yet ticketed:**
- **`next dev` appends a Next.js block to `CLAUDE.md`** on every start. `agentRules: false` in
  `next.config.ts` turns it off; whether to keep it is the same call as "No `AGENTS.md`" in `06`.
- **A build with no config fails, not only its runtime.** Home is prerendered and `getConfig()` throws
  before anything marks it dynamic, so a feature-branch preview with no variables cannot build —
  stricter than `12` §1 says.
- **`pg` logs a deprecation warning at error level** for `sslmode=require`. `sslmode=verify-full` in
  the URLs keeps today's behaviour and silences it.

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
exact-match list (so feature previews cannot sign in at all); Neon `develop` is reset from a fresh seed,
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
  it by accident.
- **The near-duplicate similarity threshold** — a guess until there is real data. `12` §6 puts the
  near-miss log in the weekly digest so it is tunable from data.
- **CV claim extraction quality** — unmeasured; eyeball it on a real CV first. `07` §5.2 returns
  `spans_rejected` and `12` §6 alerts on it being non-zero.
- **Who sends the alert mail.** `08` §2 avoided an email vendor deliberately; `12` §6 reintroduces one
  as a placeholder.
- **Two drawn-but-unspecified screens:** the `CV` nav item has no artboard, and practice mode's record
  frames differ from realistic mode's. `10-screen-specifications.md` §12.

**The weakest link in the whole plan, named so it is not forgotten:** the backup restore is untested.
`11` §9 says so and `12` §8 schedules the drill — restore into a Neon branch immediately after the
first production deploy and read a round back whole. An untested restore is a hope, and it is guarding
the only irreplaceable thing here.

- Remote is `github.com/yutaasakura96/suburi` (public). Work on `develop`; release by PR into `main`.
- **`mattpocock-skills` is now `true` in `.claude/settings.json`** — project scope beats the global
  `false`, so the grill commands are available here. `superpowers` and `frontend-design` are pinned
  `false` in the same file, deliberately; `06` records why for each.
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
