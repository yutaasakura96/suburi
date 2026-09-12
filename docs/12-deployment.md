# Deployment & DevOps — Suburi

**Date:** 2026-09-12
**Status:** Phase 4b. Tier 2, triggered: this actually ships, to the public internet, holding a CV and
salary expectations.

Extends `03-technical-design.md` §12, which drafted the environments table and deferred the rest here.

---

## 1. Environments

Three, and **two of them are git branches that stay alive.** `03` §12 named only Local and Production;
this table supersedes it.

| | **Local** | **Develop** | **Production** |
| --- | --- | --- | --- |
| Git branch | any | **`develop`** | **`main`** |
| App | `next dev` | Vercel, `develop` (stable URL) | Vercel, `main` |
| Postgres | Docker Compose, `pgvector/pgvector:pg17` | **Neon `develop` branch** | **Neon `main` branch** |
| Object storage | MinIO, or the real bucket under `dev/` | Real bucket, `dev/` prefix | Real bucket, `prod/` prefix |
| Data | Synthetic seed | **Synthetic seed** | Real |
| Models | Real OpenAI, **same pinned strings** | Real OpenAI, same pinned strings | Real OpenAI, same pinned strings |
| Auth | Better Auth + Google, same allowlist | Same allowlist | Same allowlist |
| Sentry | off | on, tagged `develop` | on, tagged `production` |
| Cron jobs | off | **off** | on |

**The branch ↔ database mapping is one-to-one and load-bearing:** `main` → Neon `main`, `develop` → Neon
`develop`. Nothing else is allowed to point at Neon `main`. That single rule is what keeps unfinished
code away from the measurement record.

**Feature branches** are cut from `develop` and merge back into it. Their Vercel previews share the
**Neon `develop` branch** — not one branch per preview. At this scale a database per preview is
bookkeeping without a payoff, and the shared develop database is the thing feature work should be
integrating against anyway. If a feature needs a destructive schema experiment, cut it a throwaway Neon
branch from `develop` by hand and delete it afterwards.

**`develop` never sees real data.** Every write in this schema is permanent (`04` §5) — a half-built
handler writing to the measurement record cannot be undone, only outlived. So Neon `develop` is seeded
with a synthetic CV, synthetic questions and synthetic rounds, and writes audio under `dev/`. The same
Google allowlist applies, so a `develop` URL discovered by anyone still opens nothing.

**Cron is off on `develop` on purpose.** The self-check alerts on pending scores and cost drift (§6);
run against synthetic data it would mail noise, and an alert channel that cries wolf is one you stop
reading — which is the whole failure §6 exists to prevent.

**Sentry is on for `develop`, tagged.** Not for the error reports, but so that §7's scrubbing
configuration is exercised before production has anything worth leaking.

**Refreshing Neon `develop`:** reset it from a fresh seed, never from a copy of `main`. Neon's branch-
from-parent would be the convenient move and it would put the real CV, real transcripts and real salary
expectations onto a branch that unfinished code writes to. That is the same rule as §8's and `11` §8's:
the sensitive material has exactly two homes.

**Local uses the same pinned model strings as production** (`03` §12). Testing against a cheaper model
would make local behaviour unrepresentative of the thing being measured. Cost is not the constraint —
a round is roughly $0.40 (`03` §6).

**One thing local cannot reproduce:** the direct browser→S3 upload against real S3 CORS and a real
presigned URL. MinIO is close but not identical. **The `develop` deployment is where that path is
genuinely exercised**, which is the main reason `develop` is a long-lived environment and not just a
branch — see step 4 of §4.

---

## 2. Environment variables — the full inventory

Every variable, its purpose, and where the secret lives. Nothing here is `NEXT_PUBLIC_`: **no variable
in this application is safe to ship to the browser**, and none is.

| Name | Purpose | Where the secret lives |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection, pooled | Vercel encrypted env. **Production scope → Neon `main`; Preview scope → Neon `develop`.** `.env.local` locally |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations | Same. Drizzle migrations do not run through a pooler |
| `BETTER_AUTH_SECRET` | Session signing | Vercel encrypted env. **Distinct value per environment** — a `develop` session must not be valid in production |
| `BETTER_AUTH_URL` | Callback base URL | Vercel env, per environment. `develop` uses its stable URL, not the per-commit one |
| `GOOGLE_CLIENT_ID` | Google OAuth | Google Cloud console; value in Vercel env |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | Same |
| `ALLOWED_EMAIL` | The allowlist assertion on session creation (`08` §2) | Vercel env. Not a secret, but environment-scoped |
| `OPENAI_API_KEY` | All three model jobs | Vercel encrypted env. **Separate key per environment** with its own usage cap (§6) |
| `OPENAI_SCORING_MODEL` | Pinned scoring model | Vercel env — `gpt-5.6-sol`. **Exact string, never an alias** (`03` §4) |
| `OPENAI_GENERATION_MODEL` | Question and follow-up generation | Vercel env — `gpt-5.6-sol` |
| `OPENAI_TRANSCRIPTION_MODEL` | Speech-to-text | **TBD — the exact id is still unverified** (`03` §4) |
| `OPENAI_TTS_MODEL` | Realistic mode speaks the question | Vercel env |
| `SCORING_PROMPT_VERSION` | Stamp 4 on every scoring attempt | Vercel env, or derived from the prompt filename in `lib/prompts/` |
| `AWS_ACCESS_KEY_ID` | S3 presigning | Vercel encrypted env. Dedicated IAM user (§7) |
| `AWS_SECRET_ACCESS_KEY` | S3 presigning | Same |
| `AWS_REGION` | S3 region | Vercel env |
| `S3_BUCKET` | One bucket | Vercel env |
| `S3_PREFIX` | `prod/` or `dev/` | Vercel env — **this is the only thing separating `develop` audio from real audio** |
| `SENTRY_DSN` | Exception reporting | Vercel encrypted env, production only |
| `SENTRY_AUTH_TOKEN` | Source-map upload at build | Vercel encrypted env, production only |
| `ALERT_EMAIL` | Where the self-check mails (§6) | Vercel env |
| `RESEND_API_KEY` *(or equivalent)* | Sending the two alert mails | Vercel encrypted env. **TBD — the sender is unchosen**; §6 |
| `CRON_SECRET` | Authenticates the cron routes against forgery | Vercel encrypted env |

**Rules, not preferences:**

- Nothing in the repo. `.env.local` is gitignored; `.env.example` carries **names and comments only, never values.**
- **A missing or malformed variable fails the boot, loudly.** Validated once at startup with Zod, in one module, and nothing reads `process.env` outside it. A `DATABASE_URL` that is empty must not silently become a dev default; an unset `OPENAI_SCORING_MODEL` must not silently become an alias.
- `SCORING_PROMPT_VERSION` and `OPENAI_SCORING_MODEL` are **stamps** (`04`). Changing either is a measurement event, not a config tweak — it triggers §5's stamp-change procedure.
- Keys are distinct per environment. **Nothing deployed from `develop` or a feature branch may hold a credential that reaches Neon `main` or the `prod/` prefix.** That is the §1 mapping expressed as secrets rather than as a rule someone remembers.

---

## 3. Before the first deploy — one-time setup

In this order. Steps 3 and 4 are the ones that fail silently if skipped.

1. **Neon:** project, Postgres 17, `create extension vector`. Note the pooled and unpooled URLs.
2. **Google Cloud:** OAuth client. Authorised redirect URIs for the production domain and for **`develop`'s stable URL** — which is the second reason `develop` gets a fixed domain rather than a per-commit one: Google's redirect URIs are an exact-match list, so a generated hostname can never sign in. Feature-branch previews therefore cannot sign in either; verify feature work on `develop`, not on its own preview URL.
3. **S3 bucket:** Block Public Access **all four settings on**; default encryption SSE-S3 or better; versioning on; a lifecycle rule expiring `dev/` after 30 days and **none on `prod/`** (audio is retained — `04` §5).
4. **S3 CORS:** the browser PUTs directly, so without this the whole upload path fails at runtime and nowhere else. Allow `PUT` and `GET` from the production origin and `develop`'s origin; allowed headers `content-type`; no wildcard origin.
5. **IAM user**, dedicated, with exactly `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::<bucket>/prod/*` and `/dev/*`. No `ListBucket`, no `DeleteObject` — **nothing in this app deletes an object**, so the credential should not be able to.
6. **OpenAI:** one key per environment, each with a monthly usage cap (§6).
7. **Vercel:** import the repo. **Production branch = `main`.** Give `develop` a stable domain and point the Preview scope's `DATABASE_URL` at Neon `develop`. Populate §2 per scope.
   > **TBD — per-branch environment variables.** Vercel's Preview scope covers every non-production branch. Confirm whether branch-scoped overrides are available on the current plan; if they are not, feature previews share `develop`'s variables, which is acceptable because they share its database anyway.
8. **Neon `develop` branch:** create it from an empty schema, migrate, seed **synthetic** data. Never branch it from `main` (§1).
9. **Seed production:** migrations, then the single `users` row, the set-piece questions, and rubric `v1.2` for both `ja` and `en`. The user row is seeded by migration — `disableSignUp: true` means it cannot be created by signing in (`08` §2).
10. **Verify the allowlist twice:** sign in with the allowlisted account (works), and confirm a second Google account is rejected. `08` §2 deliberately has two independent mechanisms; this checks both, before there is anything to protect.
11. **Sentry:** project, DSN, and the scrubbing configuration in §7 — **configured before the first real error, not after.**

---

## 4. Deploying

**Migrations are run by hand, before the deploy, and only ever additively.**

**Branch flow:** feature branch → PR into `develop` → `develop` accumulates → release is a PR from
`develop` into `main`. Nothing is committed straight to `main`, and `main` is never ahead of `develop`.

```
1. Review the SQL diff.            drizzle-kit generate; read the file
2. Merge the feature into develop. CI green (11 §7)
3. Migrate Neon develop.           drizzle-kit migrate, develop DATABASE_URL_UNPOOLED
4. Verify on the develop URL.      the real browser→S3 path, real presigned URLs
5. Migrate Neon main.              drizzle-kit migrate, production DATABASE_URL_UNPOOLED
6. Merge develop into main.        Vercel builds and promotes production
7. Smoke-check production.         §9
```

**Step 5 before step 6, always.** The migration reaches production's database before the code that
needs it reaches production. Expand-only (below) is what makes that ordering safe in both directions:
the currently-deployed build can still read the new schema, and the new build finds the columns it
expects.

**Why by hand.** These migrations touch the table that holds the six-month measurement. An automated
migration on deploy means a destructive statement can reach the measurement record unattended, and
`04` §5 makes nothing recoverable by deletion — only by restore. The cost is remembering a step; the
`.github` PR template and §9's checklist carry the reminder.

**Expand-only, always.** Adding a column, adding a nullable column then backfilling then switching
reads, adding an index. A rename is *add, dual-write, backfill, switch, drop in a later release* —
**never in one.** A drop happens only after the code that referenced it has been in production long
enough that rolling back to it is not a plan.

- No down-migrations against production. Ever.
- Never `drizzle-kit push` against production — generated, reviewed files only.
- **Never a migration that rewrites `cv_versions.body`** (`04`): every span in the database indexes into it.
- **Never `delete` or `truncate` in a migration** on `answers`, `scoring_attempts`, `scores`, `questions`, `cv_versions` or `cv_claims`.

**Green CI is required** (`11` §7). Because migrations run before the deploying push, CI runs against
the schema production is about to have.

---

## 5. Rolling back

**Code:** Vercel instant rollback to the previous deployment. That is the entire procedure, and
expand-only is what makes it safe — the schema only ever moved forward additively, so the previous
build still reads it.

**Then fix forward on `develop`.** A rollback un-deploys the code; it does not un-merge it. `main` still
contains the bad commit, so the correction is a new commit through `develop` → `main`, never a
force-push or a revert of `main`'s history. A rewritten `main` is a `main` whose relationship to what is
running in production stops being knowable.

**Schema:** there is no schema rollback. A bad additive migration is corrected by a further additive
migration. A column added in error is left in place until a later release drops it.

**Data:** restore, never delete (§8). If a bad release wrote wrong rows, the correction is a new
`scoring_attempts` row with `is_superseding` set (`04`) — the wrong row stays, visibly superseded.
**Deleting it would be exactly the quiet deletion the brief names as the thing to prevent.**

**A stamp change is not a rollback.** If a deploy changed `OPENAI_SCORING_MODEL` or
`SCORING_PROMPT_VERSION` and the scores look wrong, reverting the variable does not un-stamp the
attempts written in between — nor should it. Procedure:

1. Revert the variable.
2. Run `scripts/rescore-held-out.ts` (`11` §6) and read the drift table.
3. Confirm Progress drew a boundary at the change (refusal #5).
4. Leave every attempt written under the old stamps exactly where it is. **Drift made visible is the feature**; erasing the evidence is the failure.

---

## 6. Monitoring — the two things you would not notice

You are the only user, so you will notice the app being down within one attempted round. Monitoring
does not need to tell you that. What it must tell you is what has **no symptom at the keyboard**:

**1. Scores quietly not landing.** A `pending` attempt is a first-class state that both History and
Progress render honestly (`03` §5), and Progress excludes it from trends rather than zeroing it. Which
means a scoring path that silently fails produces no error, no wrong number, and no visible gap — just
a chart built on fewer points than you think, discovered months later.

**2. Cost drifting.** Model spend dominates infrastructure by two orders of magnitude (`03` §6). A
retry loop or a prompt that doubled in size shows up on a bill, not on a screen.

| Signal | Threshold | Where it goes |
| --- | --- | --- |
| `scoring_attempts` in `pending` for over an hour | any | email |
| `scoring_attempts` in `failed`, not superseded by an `ok` attempt | any | email |
| Week-to-date OpenAI tokens | > 3× the eight-round baseline | email |
| `spans_rejected > 0` on a CV upload | any | email — the anti-hallucination guard actually firing (`07` §5.2) |
| Near-duplicate near-misses | weekly count and score distribution | the weekly digest — this is the log the threshold gets tuned from (`03` §11) |
| Unhandled exception | any | Sentry, scrubbed per §7 |
| App down | — | **not alerted.** You will know. |

**Implementation:** two Vercel Cron routes under `/api/cron/`, authenticated with `CRON_SECRET`,
returning `401` without it. `self-check` (daily) covers the first four rows; `digest` (weekly) covers
the fifth and reports the week's rounds, tokens and spend.

> **TBD — Vercel Hobby's cron frequency limit.** Unverified as of 2026-09-12; Hobby plans have
> historically been restricted to roughly one invocation per day per job. **Confirm before relying on
> the hourly `pending` threshold.** If only daily invocations are available, the daily job does both
> and the threshold becomes 24 hours — which is still enough to catch the failure that matters, since
> the loss is a delayed discovery, not a lost row. Do **not** solve this by adding a vendor.

> **TBD — the alert sender.** `RESEND_API_KEY` is a placeholder. `08` §2 rejected magic links
> specifically to avoid a transactional email vendor, and adding one here reintroduces it for a
> different purpose. **Decide at implementation time:** an email vendor, or writing the digest to a
> private endpoint that is checked by habit. If nothing sends mail, the alerts are a page nobody
> opens — choose deliberately rather than defaulting.

**Cost ceiling as a control, not a chart:** each `OPENAI_API_KEY` carries a monthly usage cap at a
multiple of the expected $3–5 (`03` §6). A runaway loop then fails closed with a
`503 model_unavailable` — which the app already handles honestly — instead of quietly spending.

---

## 7. What is never in a log, a trace or an error report

`03` §8's rule, restated here because a deployment adds three new places to break it: Vercel runtime
logs, Sentry, and the cron emails.

**Never:** transcript text, corrected text, CV text or claim text, company notes, prompt bodies, model
response bodies, salary expectations. **Logs and reports carry ids, counts, durations and error
classes** — nothing else. `07` §2 applies the same rule to `error.detail`, and `11` §3.10 tests it with
sentinel strings.

Sentry configuration, decided here so it is not decided under pressure:

- `sendDefaultPii: false`.
- A `beforeSend` that **drops request and response bodies entirely** rather than filtering fields — an allowlist of safe keys is a list someone forgets to extend when a column is added.
- Breadcrumbs from `fetch` keep the URL and status, never the body.
- Source maps uploaded at build and **not served publicly**.
- The alert emails contain counts and ids only. Never the answer.

**The threat model that makes this strict** (`03` §9): the worst outcome here is not financial, it is
someone reading the CV, the salary expectations and the notes on companies being interviewed with —
a targeted privacy loss against one identifiable person. A log line is the cheapest way for that to
leak, and third-party error reporting is the cheapest way for a log line to leave the perimeter.

---

## 8. Backups — the measurement is the product

The six-month chart is the thing being built. Losing it is the only unrecoverable failure in this
system, because `04` §5 means nothing can be rebuilt from a later state.

| What | How | Restore path |
| --- | --- | --- |
| Postgres | Neon point-in-time restore within its retention window, **plus a weekly `pg_dump` written to `s3://<bucket>/backups/`, SSE-encrypted** | Restore into a Neon branch, verify, then promote |
| Audio in S3 | Bucket versioning on; no lifecycle rule on `prod/` | Object version restore |
| Prompts, rubrics, seeds | Git | Checkout |
| Secrets | Vercel env is the store of record; not backed up | Regenerate from the source consoles (§3) |

The `pg_dump` exists because Neon's retention window is a plan feature and this data outlives any
plan. It runs from the weekly cron route.

> **TBD — Neon's free-tier PITR retention window.** Unverified as of 2026-09-12. **Confirm before
> relying on PITR alone**; the weekly dump is deliberately independent of the answer.

**The restore path is untested until it is tested.** `11` §9 names this as the weakest link in the
whole plan. **Restore into a Neon branch immediately after the first production deploy and read a
round back whole** — an untested restore is a hope, and this one is guarding the only irreplaceable
thing in the project.

---

## 9. Smoke check, after every production deploy

Not a substitute for `11`; these are the things only production can answer.

- [ ] Sign in with the allowlisted Google account. Confirm a second account is still rejected.
- [ ] Start a round — the model preflight passes and the **four stamps are displayed** (`07` §5.4).
- [ ] Record a short take: the presigned PUT reaches S3 under `prod/`, the object exists, **CORS did not block it.**
- [ ] Transcribe, correct, submit. Confirm a `scoring_attempts` row appears and reaches `ok`.
- [ ] Reach the feedback screen and confirm it **renders while you are still sitting there** (PRD §9).
- [ ] Play the take back from History.
- [ ] Confirm no sensitive string from the round appears in Vercel logs or Sentry.
- [ ] After the first deploy only: run the restore drill (§8).

---

## 10. Deliberately not built

| Not built | Why |
| --- | --- |
| A fourth environment | `develop` **is** staging — a long-lived branch with its own long-lived Neon branch. A separate staging tier would be a third database to seed, migrate and keep honest. |
| A Neon branch per preview | §1 — bookkeeping without a payoff at this scale; feature previews share Neon `develop`, which is what they should be integrating against. |
| Blue/green or canary | One user. Vercel's instant rollback is the entire deployment-risk story. |
| Infrastructure as code | One Next.js app, one managed database, one bucket. This is the same reason `13-infrastructure-and-security.md` is not written (`00-status.md`); revisit together. |
| Automated migrations on deploy | §4 — the measurement record does not get unattended DDL. |
| An uptime monitor | §6 — the one user is the uptime monitor. |
| Log drains / a second observability vendor | §7 — every extra destination is another place the never-log rule can be broken. |
| A deploy-time smoke test suite | §9 is a checklist on purpose: half of it is a judgement about whether feedback arrived fast enough to feel immediate, which is not assertable. |
