# Project status

**Project:** **Suburi** (素振り) — a private, turn-based voice interview simulator for practising job
interviews in Japanese and English, with rubric-scored feedback and tracked progress over time.
**Phase:** 4b complete. **Planning is done. Next is Phase 5 — configure the repo.**
**Updated:** 2026-09-12

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

**Design canvas:** https://claude.ai/code/artifact/8d50e302-ed9c-48d4-ab00-c0e4e5da0788
Page 1 is the screen set, page 2 the three exploration directions. **Working files** in `design/`;
every change re-seeds from those — edit them, never the built `design/suburi-directions.html`.

## Next
**Phase 5 — configure the repo.** Run `/project`. It reads
`~/Documents/GitHub/claude-setup-inventory/skills/new-project/SKILL.md` and executes it verbatim,
including its approval gate: detect the stack, propose the config as a table, wait for approval, then
write `CLAUDE.md`, `.claude/settings.json` and `.mcp.json` if one is needed. It will find `docs/` and
should prefer it over inference — the stack is fixed and written down, so nothing needs guessing.

Two things Phase 5 should carry into `CLAUDE.md` rather than leave in `docs/`: the invariant list from
`CONTEXT.md`, and the pointer that `docs/07` §6, `docs/11` §3 and `docs/04` §6 are where those
invariants are enforced.

After 5: **Phase 6 — build.** Planning is complete; the build flow is driven by commands only you can
type. `mattpocock-skills` is currently **disabled in global settings**, so `/grill-with-docs` is
unavailable in this repo — either enable it, or the first feature is specced directly from `docs/`.

## Blocked
_(nothing)_

## Carrying

**The stack, fixed:** Next.js (App Router) + TypeScript on Vercel · Drizzle · Postgres 17 +
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

**Verified facts worth not re-deriving:** Vercel Hobby functions run to 300s (so scoring is not
platform-limited) but cap bodies at 4.5 MB (so audio must go browser → S3 directly). OpenAI per 1M
tokens: `astra` $10/$50, `sol` $4/$20, `terra` $2/$12, `luna` $0.20/$1.20 — roughly **$0.40/round on
Sol**, a few dollars for the whole 30-day target. At 1,000 users model spend would dominate
infrastructure by two orders of magnitude.

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
- **The exact OpenAI transcription model id and its per-minute price** — still unverified as of
  2026-09-12. Confirm before the first implementation session.
- **The scoring dispatch trigger** — verify Next.js `after()` on Vercel Hobby before treating the
  client-fired `run` call as permanent.
- **Vercel Hobby's cron frequency limit** and **Neon's free-tier PITR window** — both unverified, both
  in `12`. Do not solve the cron limit by adding a vendor.
- **Who sends the alert mail.** `08` §2 avoided an email vendor deliberately; `12` §6 reintroduces one
  as a placeholder.
- **Two drawn-but-unspecified screens:** the `CV` nav item has no artboard, and practice mode's record
  frames differ from realistic mode's. `10-screen-specifications.md` §12.

**The weakest link in the whole plan, named so it is not forgotten:** the backup restore is untested.
`11` §9 says so and `12` §8 schedules the drill — restore into a Neon branch immediately after the
first production deploy and read a round back whole. An untested restore is a hope, and it is guarding
the only irreplaceable thing here.

- Remote is `github.com/yutaasakura96/suburi` (public). Work on `develop`; release by PR into `main`.
- `mattpocock-skills` is disabled in global settings, so the grill commands are unavailable here.
- `superpowers` is not active in this repo; the template's own interview was used.

## Skipped
- **`09-user-flows.md`** — covered by PRD §5's user stories and `10`'s per-screen state
  specifications. My call in Phase 4, not the user's — say so if you disagree and it gets written.
  `07` §5 now also gives the round loop call by call, which covers the same ground a third time.
- **`13-infrastructure-and-security.md`** — the Tier 2 trigger (multiple services, IaC, networking
  beyond one app on a PaaS) is not met: one Next.js app, one managed database, one bucket. The
  mandatory security baseline is answered in full in `03` §9, and `12` §3 and §7 now carry the bucket
  policy, IAM scope, CORS and log-scrubbing detail. Revisit when the AWS Lightsail platform the user
  plans actually exists.
