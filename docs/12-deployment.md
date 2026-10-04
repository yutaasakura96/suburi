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
| App | `next dev` | Vercel, `develop` — `suburi-develop.vercel.app` | Vercel, `main` — `suburi-murex.vercel.app` |
| Postgres | Docker Compose, `pgvector/pgvector:pg18` | **Neon `develop` branch** | **Neon `main` branch** |
| Object storage | **The real bucket under `dev/`**, with `develop`'s IAM user (`06`, 2026-09-28) | Real bucket, `dev/` prefix | Real bucket, `prod/` prefix |
| Data | Synthetic seed | **Synthetic seed** | Real |
| Models | Real OpenAI, **same pinned strings** | Real OpenAI, same pinned strings | Real OpenAI, same pinned strings |
| Auth | Better Auth + Google, same allowlist | Same allowlist | Same allowlist |
| Sentry | off | on, tagged `develop` | on, tagged `production` |
| Cron jobs | off | **off** | on |

**The branch ↔ database mapping is one-to-one and load-bearing:** `main` → Neon `main`, `develop` → Neon
`develop`. Nothing else is allowed to point at Neon `main`. That single rule is what keeps unfinished
code away from the measurement record.

**Feature branches** are cut from `develop` and merge back into it. **They are not deployed:**
`vercel.json` sets `git.deploymentEnabled` to `"**": false` with `main` and `develop` set `true` (a
branch deploys if any matching rule is `true`). A feature preview would hold no configuration and could
not sign in (§3 step 2), and CI already builds and tests each branch. `vercel.json`'s
`buildCommand` (§4) ends in `npm run build`, whose first step copies pdf.js's CMaps into `public/pdfjs/cmaps/` —
a deploy that ran `next build` alone would ship a CV screen that cannot read a Japanese PDF (`06`, #17). Feature work integrates against
the **Neon `develop` branch** — locally, or on `develop` once merged — not one branch per feature. At
this scale a database per feature is bookkeeping without a payoff. If a feature needs a destructive schema experiment, cut it a throwaway Neon
branch from `develop` by hand and delete it afterwards.

**`develop` never sees real data.** Every write in this schema is permanent (`04` §5) — a half-built
handler writing to the measurement record cannot be undone, only outlived. So Neon `develop` is seeded
synthetically and writes audio under `dev/`. The same Google allowlist applies, so a `develop` URL
discovered by anyone still opens nothing.

**The seed grows one slice at a time, and today it is the user row plus a synthetic CV.** An earlier
version of this section described `develop` as already carrying a synthetic CV, synthetic questions and
synthetic rounds; only the user row was ever seeded (§3 step 8). What the CV slice adds:

- **One CV version per language, with its documents** — Japanese: a 履歴書, a 職務経歴書 and one
  additional document; English: a CV document and one additional document. Invented, about an invented
  person. **The real CV is never seed material**, here or anywhere: §8 and `11` §8 give it exactly two
  homes, and a seed file in a public repository is not one of them.
- **Claims written directly as fixtures — no model call.** A seed that calls OpenAI is a seed that
  costs money, needs a key, and produces different rows every time it runs, which makes `develop`'s
  data unreproducible and a test against it unrepeatable.
- **Every seeded span run through the span validator.** Fixture claims are verbatim quotes; the seed
  locates each one, and a quote that is not in its document exactly once fails the seed rather than
  sitting in `develop` as a wrong underline. Their extractor stamps are `null`: no model produced them.
- **Idempotent**, like the user seed, and stricter: a language is seeded only if it has **no** CV
  version, seeded or saved. Running it twice leaves one version per language, and running it after a
  real save on `develop` adds nothing. To reseed, reset the branch.
- **Its own command, `npm run db:seed:develop`** — the user row, then the CV. `db:seed` stays
  user-row-only, because production runs it (§3 step 9) and a synthetic CV in Neon `main` would be the
  version the first real rounds are scored against. Fixtures: `db/seed-cv.ts`.

**The round loop names the fixture needs** (`06`, 2026-09-27): generated-origin bank questions let a
round be filled before generation exists, and scored rounds make History and Progress verifiable on
`develop`. The #42, #43 and #50 entries below record the seeds that now supply them; the fixtures
never call a model.

**What the tracer added (#42).** `db:seed:develop` now also seeds rubric `en` v1.0 and the English set
pieces — the same checked-in rows production will get — and **17 synthetic generated-origin English
bank questions** across the four round types (`db/seed-questions.ts`), stamped
`synthetic-generated-en-1.0` so no chart can take them for the generator's. Each is idempotent by body
and stamp. **`db:seed` is unchanged**: production gets the rubric and set pieces only once the user has
reviewed rubric `en` v1.0 (§3 step 9), and never gets a synthetic question.

**What the Japanese round added (#43).** The same three seeds now carry both languages:
`db:seed:develop` also seeds rubric `ja` v1.0 (seven dimensions, 敬語 the seventh), the four Japanese
set pieces under `set-piece-ja-1.0`, and **17 synthetic generated-origin Japanese bank questions**
stamped `synthetic-generated-ja-1.0`, parallel to the English ones. A re-run on a branch that already
holds the English rows adds only the Japanese ones. **Rubric `ja` v1.0 is reviewed, with
its read, before it is seeded anywhere** — `develop` included: a seeded version is immutable
(`04` §5), so a wording changed after the seed is v1.1, a re-score and a boundary. **That review was
done on 2026-10-03, by an AI at the user's explicit delegation** (`06`): one anchor reworded, the
rest accepted, and nothing was seeded before it. `db:seed` is unchanged here too.

**What History added (#50).** `db:seed:develop` ends by seeding **four synthetic rounds**
(`db/seed-rounds.ts`), one in each state History has to show, so the screen can be verified on
`develop` at all:

| Round | Started | State |
| --- | --- | --- |
| Behavioural, Japanese | 2026-09-12 | Complete, every answer scored; one missing follow-up; feedback stored with its English translation; pressure 4. Q1 is `10` §10's sample row, `4 3 4 3 4 2 3` |
| Technical, English | 2026-09-06 | Complete, with one answer's score still **`pending`** — the function that would have finished it died |
| CEO / final, English | 2026-08-22 | Complete, with one answer's score **`failed`**, and one missing follow-up |
| Behavioural, English | 2026-08-19 | **Abandoned**: left on its first follow-up, two questions never reached |

All four are realistic rounds of three, over the synthetic generated-origin bank questions and the
synthetic CV, which they need seeded first — the seed fails, writing nothing, without them. Fixtures
like the CV's: **no model call**, and every row that a model would have stamped says so —
`model_id` `synthetic-fixture`, and `synthetic-score-…`, `synthetic-follow-up-…` and
`synthetic-feedback-…` as the prompt versions — so no chart can take a seeded score for a scored one.
A retry made on `develop` — or the seeded `pending` attempt, once run — is scored by the real pinned
model and stamped with it (`07` §5.10), and History then shows both stamps.
**No recording is seeded** (`audio_s3_key` null): History says the recording is missing, which is the
state `04` §5 requires it to tolerate. The Japanese round answers with the synthetic CV's own
sentences, so the seed adds no Japanese that has not been read.

Their dates are fixed and in the past, so the open one is abandoned on whatever day the seed runs, and
their ids are derived from the user and the round's name: **idempotent per round** — a second run
writes nothing, and a round is never rewritten. An answer is a first attempt only where its question
has no earlier answer in that language, so seeding onto a `develop` that already has rounds claims no
first attempt it is not (`06`, 2026-09-27). `db:seed` is unchanged: **production never gets a
synthetic round.** With cron off on `develop` (below), the seeded `pending` score raises no alert there.

**Cron is off on `develop` on purpose.** The self-check alerts on pending scores and cost drift (§6);
run against synthetic data it would fill the status page with noise, and an alert channel that cries
wolf is one you stop reading — which is the whole failure §6 exists to prevent. The routes and the
status page still exist there (#55). With no manual run in its database, `develop`'s Home carries
`Self-check has never run.` rather than implying a check it never made (`10` §1).

**Sentry is on for `develop`, tagged.** Not for the error reports, but so that §7's scrubbing
configuration is exercised before production has anything worth leaking. So `SENTRY_DSN` and
`SENTRY_AUTH_TOKEN` sit in the `develop` branch's Preview scope as well as Production (§2). *Corrected
2026-09-28:* §2 used to say "production only", which contradicted this paragraph (`06`). **Built by
#54:** `lib/config.ts` turns Sentry on only when `SENTRY_DSN` is set **and** Vercel's own
`VERCEL_ENV` says `production`, or `preview` with `VERCEL_GIT_COMMIT_REF` = `develop`; the tag comes
from those two, never from a variable someone sets. Anywhere else — local, CI, Playwright, another
branch — it is off, even with a DSN present (`06`, 2026-09-30).

**Refreshing Neon `develop`:** reset it from a fresh seed, never from a copy of `main`. Neon's branch-
from-parent would be the convenient move and it would put the real CV, real transcripts and real salary
expectations onto a branch that unfinished code writes to. That is the same rule as §8's and `11` §8's:
the sensitive material has exactly two homes.

**Local uses the same pinned model strings as production** (`03` §12). Testing against a cheaper model
would make local behaviour unrepresentative of the thing being measured. Cost is not the constraint
(`03` §6).

**Local uses the real bucket under `dev/`, not MinIO** (`06`, 2026-09-28), with the same IAM user as
`develop`, so the direct browser→S3 upload runs against real S3 CORS and a real presigned URL from
`http://localhost:3000` too. **The `develop` deployment is still where that path is exercised from a
deployed origin**, which is one reason `develop` is a long-lived environment and not just a branch —
see step 4 of §4.

---

## 2. Environment variables — the full inventory

Every variable, its purpose, and where the secret lives. Nothing here is `NEXT_PUBLIC_`. Of the
variables below, only `SENTRY_DSN` reaches the browser: `next.config.ts` inlines it and a derived
environment tag at build because the browser SDK needs both to report. A DSN only sends events in
(`06`, 2026-09-28); `SENTRY_AUTH_TOKEN` never leaves the build.

| Name | Purpose | Where the secret lives |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection, pooled | Vercel encrypted env. **Production scope → Neon `main`; Preview scope → Neon `develop`.** `.env.local` locally |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations | Same. Drizzle migrations do not run through a pooler. **Read by `develop`'s build** (§4), so it is in the Preview scope before the deploy, and it carries the `suburi_develop` role there |

**Both database URLs carry `sslmode=verify-full`** when the host is not local. Neon's console hands out `sslmode=require`, which pg v8 treats as `verify-full` but pg v9 will give libpq's meaning — encrypted, certificate unchecked. `lib/config.ts` refuses a remote URL without `verify-full` (and refuses `uselibpqcompat`), so the swap happens at setup, not after a Dependabot major. `localhost` and `127.0.0.1` are exempt: Docker has no TLS.
| `BETTER_AUTH_SECRET` | Session signing | Vercel encrypted env. **Distinct value per environment** — a `develop` session must not be valid in production |
| `BETTER_AUTH_URL` | Callback base URL | Vercel env, per environment. `develop` uses its stable URL, not the per-commit one |
| `GOOGLE_CLIENT_ID` | Google OAuth | Google Cloud console; value in Vercel env |
| `GOOGLE_CLIENT_SECRET` | Google OAuth | Same |
| `ALLOWED_EMAIL` | The allowlist assertion on session creation (`08` §2) | Vercel env. Not a secret, but environment-scoped |
| `OPENAI_API_KEY` | **Every model call** — question generation, follow-ups, scoring, round feedback, **CV claim extraction** (`03` §4), transcription, TTS, embeddings | Vercel encrypted env. **Separate key per environment** with its own usage cap (§6). **First needed by CV claim extraction**, which is the first model call the app makes at all; added to the `develop` branch's Preview scope and to `.env.example` with that slice |
| `OPENAI_BASE_URL` | **Playwright only.** Points the server under test at `e2e/mock-openai.ts` | Set by `playwright.config.ts` and nowhere else — **never in Vercel, never in `.env`**. Optional; `lib/config.ts` refuses any host but `localhost`/`127.0.0.1`, so no value can send `OPENAI_API_KEY` to another server (`06`, 2026-09-21) |
| `S3_ENDPOINT` | **Playwright only.** Points the audio store at `e2e/mock-s3.ts`, path-style | Set by `playwright.config.ts` and nowhere else — **never in Vercel, never in `.env`**. Optional; refused unless the host is local, like `OPENAI_BASE_URL`, so no value can send the AWS key to another server. Local development uses the real bucket under `dev/` (`06`, 2026-10-01) |
| `AWS_ACCESS_KEY_ID` | S3 presigning | Vercel encrypted env. Dedicated IAM user (§7) |
| `AWS_SECRET_ACCESS_KEY` | S3 presigning | Same |
| `AWS_REGION` | S3 region | Vercel env |
| `S3_BUCKET` | One bucket | Vercel env |
| `S3_PREFIX` | `prod/` or `dev/` | Vercel env — **this is the only thing separating `develop` audio from real audio**. `lib/config.ts` accepts exactly these two values |
| `SENTRY_DSN` | Exception reporting | Vercel encrypted env. **Production and the `develop` branch's Preview scope** (§1); one Sentry project, events tagged by environment. **Optional:** absent means Sentry is off, never a failed boot (`06`, 2026-09-30). Unset locally, in CI and under Playwright |
| `SENTRY_AUTH_TOKEN` | Source-map upload at build | Same scopes as `SENTRY_DSN`: both builds upload their maps. An **organization** token (`sntrys_…`) for `personal-projects-ge`, the organization `next.config.ts` names beside the project; the upload does not take the organization from the token (`06`, 2026-10-01). Required whenever `SENTRY_DSN` is set in those two deployments; `lib/config.ts` refuses a DSN without it |
| `CRON_SECRET` | Authenticates the cron routes against forgery: Vercel sends it as `Authorization: Bearer <CRON_SECRET>` (`07` §5.17) | Vercel encrypted env, **Production only**: cron is off on `develop` (§1). At least 16 characters (`openssl rand -base64 32`). **`lib/config.ts` requires it when `VERCEL_ENV` is `production`** and accepts its absence anywhere else, where the cron routes then refuse every call. Locally, in `.env.local` only to run a job by hand |
| `VERCEL_ENV` | Which Vercel environment is running: `production`, `preview` or `development` | **Set by Vercel, not by us** — a system variable available at build and runtime (verified 2026-09-30). Read to decide whether `CRON_SECRET` is required, whether Sentry is on (§1), and, with `VERCEL_GIT_COMMIT_REF`, whether the build migrates (§4). Unset locally |
| `BACKUP_AWS_ACCESS_KEY_ID` | The daily `pg_dump`'s write to `backups/` (§8) | Vercel encrypted env, **Production only**. The dedicated backup-writer IAM user (§3 step 5), never the app's own. **`lib/config.ts` requires both when `VERCEL_ENV` is `production`**, refuses one without the other anywhere, and refuses the app's own `AWS_ACCESS_KEY_ID`. Absent elsewhere, where `self-check` writes no dump (#56) |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Same | Same |

**No alert-mail variables.** `ALERT_EMAIL` and a sender key (`RESEND_API_KEY`) were placeholders
here until 2026-09-28, when alerts went to a private status page instead of email (§6, `06`).

**Rules, not preferences:**

- Nothing in the repo. `.env.local` is gitignored; `.env.example` carries **names and comments only, never values.**
- **A missing or malformed required variable fails the boot, loudly.** `OPENAI_BASE_URL` and `S3_ENDPOINT` are optional, for Playwright only. The Sentry pair may be absent, leaving Sentry off; in production or `develop`, a malformed DSN or a DSN without its token fails configuration. Application modules read `process.env` only through `lib/config.ts`, which validates it with Zod at startup. `playwright.config.ts` builds the test server's environment (`06`, 2026-09-21); the local-only `scripts/dev-session.mts` loads and checks its own environment before calling `lib/config.ts` (`06`, 2026-09-25). A `DATABASE_URL` that is empty must not silently become a dev default; an unset `OPENAI_API_KEY` must not silently skip a model call.
- **No model string and no prompt version is an environment variable.** Model strings are constants in `lib/ai/models.ts` (`03` §4) and prompt versions come from the prompt filename in `lib/prompts/`. Both are **stamps** (`04`): changing one is a measurement event, not a config tweak, so it arrives as a reviewed commit and triggers §5's stamp-change procedure. The transcription model, `gpt-transcribe`, **requires API Tier 1+** — the Free tier does not serve it, which is a property of the `OPENAI_API_KEY`'s account.
- Keys are distinct per environment. **Nothing deployed from `develop` or a feature branch may hold a credential that reaches Neon `main` or the `prod/` prefix.** That is the §1 mapping expressed as secrets rather than as a rule someone remembers.

---

## 3. Before the first deploy — one-time setup

In this order. Steps 3 and 4 are the ones that fail silently if skipped.

1. **Neon:** project, Postgres 18, `create extension vector`. Note the pooled and unpooled URLs. **Done 2026-09-19:** project `suburi`, region `aws-ap-southeast-1`; the default branch renamed `main`.
2. **Google Cloud:** OAuth client. Authorised redirect URIs for three origins — **`localhost`**, because local development signs in with the same Google allowlist (§1); the production subdomain, **`suburi-murex.vercel.app`** (`suburi.vercel.app` was taken; Vercel assigned this on import, 2026-09-19); and **`develop`'s stable subdomain, `suburi-develop.vercel.app`** (if a name ever changes, change this list, §1 and the URIs together). Each URI is the origin plus `/api/auth/callback/google`, and local is `http://localhost:3000`. The client stays in **Testing**: with only `openid`, `email` and `profile` requested, Google lets any account through, so the two locks in `08` §2 are the whole gate — which is the second reason `develop` gets a fixed domain rather than a per-commit one: Google's redirect URIs are an exact-match list, so a generated hostname can never sign in. A per-commit URL could not sign in either, which is one reason feature branches are not deployed (§1); verify feature work on `develop`.
3. **S3 bucket:** Block Public Access **all four settings on**; default encryption SSE-S3 or better; versioning on; a lifecycle rule expiring `dev/` after 30 days and **none on `prod/`** (audio is retained — `04` §5). **Steps 3–5 are done ahead of #21, as the round loop's first slice** (`06`, 2026-09-27): every recording slice needs the bucket, and it is human work. **Done 2026-09-28** (#41): region `ap-northeast-1`, SSE-S3 with a bucket key, Object Ownership bucket-owner-enforced, and a bucket policy refusing any request not over TLS. The `dev/` rule also expires noncurrent versions after a day and aborts incomplete multipart uploads. The bucket name lives only in the §2 variables. Versioning is also what keeps a practice re-take's overwritten object (`04` `answers`) — accepted, and never read. The AWS variables in §2 join `lib/config.ts`, `.env.example` and the `develop` branch's Preview scope in the same slice.
4. **S3 CORS:** the browser PUTs directly, so without this the whole upload path fails at runtime and nowhere else. Allow `PUT` and `GET` from the production origin and `develop`'s origin — and `http://localhost:3000` only if local development uses the real bucket under `dev/` rather than MinIO, which it does (`06`, 2026-09-28); allowed headers `content-type`; no wildcard origin. **Done 2026-09-28** with all three origins; a preflight from any other origin, or asking for any other header, gets `403`.
5. **IAM users, one per environment**, each dedicated, with exactly `s3:PutObject` and `s3:GetObject` on its own prefix — production's on `arn:aws:s3:::<bucket>/prod/*`, `develop`'s (and local's, if local uses the real bucket) on `/dev/*`. No `ListBucket`, no `DeleteObject` — **nothing in this app deletes an object**, so the credential should not be able to. *Corrected 2026-09-27:* this used to give one user both prefixes, which would have put a credential reaching `prod/` on `develop` — the thing §2's last rule forbids (`06`). **Done 2026-09-28:** `suburi-s3-prod` and `suburi-s3-dev`, each with one inline policy and no groups or managed policies. Local shares `suburi-s3-dev`. Their keys went straight from the AWS CLI into Vercel's Production scope and the `develop` branch's Preview scope, and the dev key also went into `.env.local`; none was printed. **A third user, `suburi-backup-writer`, arrives with the daily dump (#56):** exactly `s3:PutObject` on `/backups/*`, its key in Production only. Neither app user can reach `backups/`, and the backup writer can read nothing (`06`, 2026-09-28). **Done 2026-09-30:** one inline policy, `suburi-backups-put`, and no groups or managed policies; checked with the IAM policy simulator (`06`). Its key went straight from the AWS CLI into Vercel's Production scope as `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` (§2), and was never printed.
6. **OpenAI:** one key per environment, each with a monthly usage cap (§6). Each key's account must be **API Tier 1 or above** for `gpt-transcribe` (§2). The local and `develop` checks are recorded in `06` (2026-09-28 and 2026-09-30).
7. **Vercel:** import the repo. **Production branch = `main`.** Give `develop` a stable domain and point the Preview scope's `DATABASE_URL` at Neon `develop`. Populate §2 per scope. **Leave the import form's environment variables empty** — it scopes them to Production and Preview at once. A variable added after this step follows the same rule: branch-scoped in Preview, before the deploy that first reads it (`OPENAI_API_KEY`, step 8). Importing deploys `main` immediately, and that build fails without Production variables; that is expected until production is set up. Vercel's Deployment Protection is on for Preview by default and stays on: `develop` asks for a Vercel login before the app's own sign-in.
   > **Per-branch environment variables — available on Hobby** (verified 2026-09-14 against Vercel's environment-variable and environments docs). A Preview variable can be scoped to one Git branch, and it overrides the general Preview value. Assigning a stable domain to a branch, with branch-specific variables, is marked "All plans, including Hobby". Custom Environments are Pro and Enterprise only and are not needed. **So:** every §2 variable for `develop` is scoped to the `develop` branch in Preview. General Preview holds nothing; feature branches are not deployed (§1).
8. **Neon `develop` branch:** create it as **Schema only** from `main` (Neon has no empty-branch option; this copies no rows), then give it a role and database of its own — `suburi_develop`, owning database `suburi` — because a Schema only branch copies `main`'s roles *with their passwords*. Only `suburi_develop` goes in `develop`'s URLs, and `main` refuses it (`28P01`, checked 2026-09-19). Then migrate, then run `npm run db:seed:develop` with `develop`'s own `ALLOWED_EMAIL` — never `db:seed` alone here, and never `db:seed:develop` against `main`. It seeds the user row and one synthetic CV version per language with its documents and fixture claims, and the rubrics, set pieces and synthetic bank questions §1 lists; and, since #50, the four synthetic rounds History shows. Never branch it from `main` (§1).
   > **Adding a variable to an existing environment is the same step, later.** `OPENAI_API_KEY` joins the `develop` branch's Preview scope when CV extraction lands — branch-scoped, like every other §2 variable for `develop` (step 7). Because `lib/config.ts` validates at boot and a missing variable fails the boot loudly, the deploy that first reads it must not land before the variable does.
9. **Seed production:** migrations, then the single `users` row, the set-piece questions, and rubric **`v1.0`** for both `ja` and `en`. *Amended 2026-09-27:* this said `v1.2`, a label from the artboards' sample data; no rubric existed (`06`). The set pieces are 自己紹介, 自己PR and 転職理由 (`hr`) and 志望動機 (`ceo`), with their English counterparts, each carrying its content version — **no 逆質問**. Both seeds are real, checked-in data (`11` §8), written by the round loop's tracer (English) and Japanese slices; this step waits for them. **The English half exists since #42** (`lib/rubric/en-1.0.ts`, `lib/questions/set-pieces.ts`) and is seeded on `develop`; `db:seed` gains it after the user's review of rubric `en` v1.0, not before. **The Japanese half exists since #43** (`lib/rubric/ja-1.0.ts`, the same `set-pieces.ts`), under the same condition for rubric `ja` v1.0. Both halves are seeded by the two functions this step will call — `seedRubrics` and `seedSetPieces` in `db/seed-questions.ts`, idempotent on `(version_label, language)` and on body and content version — and `db/seed-questions.integration.test.ts` holds what they write. The user row is inserted by the hand-run seed script from `ALLOWED_EMAIL`, with `email_verified = true` — **not by migration**, which would commit the email to a public repository. `disableSignUp: true` means it cannot be created by signing in (`08` §2).
10. **Verify the allowlist twice:** sign in with the allowlisted account (works), and confirm a second Google account is rejected. `08` §2 deliberately has two independent mechanisms; this checks both, before there is anything to protect.
11. **Sentry:** project, DSN, and the scrubbing configuration in §7 — **configured before the first real error, not after.** The integration is built (#54); what is left is the owner's: a Sentry project **named `suburi`** in the organization **`personal-projects-ge`** (`next.config.ts` names both), an **organization** auth token with the source-map upload scope, and both variables in Production and the `develop` branch's Preview scope, never general Preview (step 7). In the project's settings, leave server-side data scrubbing on. Then prove it on `develop`: one deliberate test exception arrives tagged `develop`, with no body in it. A failed upload does not fail the build; it logs `401` or `403` from the upload step (on 2026-09-30 it was `403`, from the organization lookup), so read `develop`'s first build log for either.
12. **`CRON_SECRET`:** generate one (`openssl rand -base64 32`) and add it to **Production only**, before the first production deploy that carries the cron routes — `lib/config.ts` refuses to boot production without it (§2). The user's step (#55); the first *scheduled* run on the status page is #21's criterion (`06`, 2026-09-29).

---

## 4. Deploying

**Migrations are only ever additive. `main`'s are run by hand, before the deploy; `develop`'s are run
by its own deploy.** *Amended 2026-10-06:* `develop`'s were by hand too, until Neon `develop` was found
five migrations behind the code Vercel was serving (`06`).

**Branch flow:** feature branch → PR into `develop` → `develop` accumulates → release is a PR from
`develop` into `main`. Nothing is committed straight to `main`, and `main` is never ahead of `develop`.

```
1. Review the SQL diff.            drizzle-kit generate; read the file
2. Merge the feature into develop. CI green (11 §7)
3. Vercel migrates Neon develop.   the develop build's first step; nothing to run
4. Verify on the develop URL.      the real browser→S3 path, real presigned URLs
5. Migrate Neon main.              drizzle-kit migrate, production DATABASE_URL_UNPOOLED
6. Merge develop into main.        Vercel builds and promotes production
7. Smoke-check production.         §9
```

**Step 5 before step 6, always.** The migration reaches production's database before the code that
needs it reaches production. Expand-only (below) is what makes that ordering safe in both directions:
the currently-deployed build can still read the new schema, and the new build finds the columns it
expects.

**Why `main` is by hand.** These migrations touch the table that holds the six-month measurement. An
automated migration on deploy means a destructive statement can reach the measurement record
unattended, and `04` §5 makes nothing recoverable by deletion — only by restore. The cost is
remembering a step; the `.github` PR template and §9's checklist carry the reminder.

**Why `develop` is not.** Neon `develop` holds a synthetic seed (§1), so the argument above does not
reach it, and a forgotten step there is not a reminder missed but a test site that errors on features
already merged. So step 3 is the build's:

- **`vercel.json`'s `buildCommand` is `npm run db:migrate:deploy && npm run build`.** The first half is
  `scripts/migrate-on-deploy.mts`, and it migrates only when Vercel's own variables say the build is
  `develop`'s: `VERCEL_ENV` = `preview` and `VERCEL_GIT_COMMIT_REF` = `develop`, the test Sentry's tag
  already uses (§1). On `main`'s build, in CI and locally it prints that it migrates nothing and exits
  `0`, having read no database variable.
- **Migration first, build second, promotion last.** A migration that fails exits non-zero, the build
  fails, and Vercel keeps serving the previous deployment — red in the Vercel dashboard and on the
  commit's status in GitHub. Pending migrations apply in one transaction, so one that fails applies none
  of them. A build that fails *after* a migration leaves the schema ahead of the code, which expand-only
  (below) makes safe.
- **It needs one variable, `DATABASE_URL_UNPOOLED`,** in the Preview scope (§2), and reads no other:
  `lib/config.ts` parses it apart from the rest, as it does Sentry's, under the same `verify-full`
  rule. A missing or malformed one fails the build, naming the variable.
- **The URL's role must be `suburi_develop`.** Neon `main` refuses that role (§3 step 8), so a Preview
  variable pointed at `main` by mistake fails the build before it connects. It is reported as
  malformed.
- **It is `drizzle-kit migrate`'s migrator and journal** (`db/migrate.ts`), so `npm run db:migrate` by
  hand and a deploy agree on what is applied. Two builds at once are serialised by a Postgres advisory
  lock, which is one more reason the URL is the direct one.
- **A skipped migration fails the build.** drizzle applies only the migrations whose journal `when` is
  later than the newest applied one, so a migration generated on a branch that merged second, and
  renumbered at the merge, keeps its earlier timestamp and is passed over in silence. After migrating,
  `db/migrate.ts` counts the rows in `drizzle.__drizzle_migrations` against the entries in
  `db/migrations/meta/_journal.json` and fails when the database has fewer, naming that cause. The fix
  is to regenerate the migration so its timestamp is the newest. A database with *more* than the
  folder — an older commit redeployed — passes.
- **The log line is counts only:** `Migrated the develop database: 2 applied, 15 in its journal.` A
  failure prints the error and the statement that raised it — migration SQL, which is in the
  repository — with the URL, its host and its password scrubbed, and a missing or malformed variable
  goes through the same path. It does not say whether anything was applied: the check above fails
  after drizzle's transaction has committed.
- **Seeding is not part of it.** `npm run db:seed:develop` stays a hand-run step (§3 step 8).

**Extending it to `main` is a decision, not an edit** — it reverses the paragraph above. The mechanism
is shaped for it: `deployMigrationRoles` in `lib/config.ts` lists each deployment that migrates with the
role its URL must carry, and `production` is absent.

**Expand-only, always.** Adding a column, adding a nullable column then backfilling then switching
reads, adding an index. A rename is *add, dual-write, backfill, switch, drop in a later release* —
**never in one.** A drop happens only after the code that referenced it has been in production long
enough that rolling back to it is not a plan.

- No down-migrations against production. Ever.
- Never `drizzle-kit push` against production — generated, reviewed files only.
- **Never a migration that rewrites `cv_versions.body`** (`04`): every span in the database indexes into it.
- **Never `delete` or `truncate` in a migration** on `answers`, `scoring_attempts`, `scores`, `questions`, `cv_versions` or `cv_claims`.

**Green CI is required** (`11` §7). Because `main`'s migrations run before the deploying push, CI runs
against the schema production is about to have.

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

**A stamp change is not a rollback.** If a deploy changed the scoring model string or the scoring
prompt version and the scores look wrong, reverting the change does not un-stamp the attempts written
in between — nor should it. Procedure:

1. Revert the change: Vercel instant rollback, then fix forward on `develop` as above.
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
| `scoring_attempts` in `pending` for over **24 hours** | any | status page — Hobby cron is daily-only, see below |
| `scoring_attempts` in `failed`, not superseded by an `ok` attempt | any | status page |
| Week-to-date OpenAI spend, from every stored token column, each row counted in its own `created_at` week | > 3× the round-cost baseline × max(1, rounds started that week) | status page — the baseline is a fixed constant, see below |
| `spans_rejected > 0` on the current CV | any | status page — the anti-hallucination guard actually firing (`07` §5.2) |
| `claims_split > 0` on the current CV | any | status page — the extractor is cutting sentences into fragments again (`07` §5.2) |
| `claims_duplicated > 0` on the current CV | any | status page — the same assertion returned more than once |
| `unclaimed_run_max` on the current CV | > **2,000** code points | status page — a section of the CV may have gone unread |
| `quotes_outside_window > 0` on the current CV | any | status page — an extraction call quoted outside the window it was given (`07` §5.2, #29) |
| A completed round with no `round_feedback` | for over **24 hours** | status page — feedback failed and was never retried (`07` §5.12) |
| The daily dump (§8) failed | any | status page — a missing dump is the staleness line: no `self-check` run, no dump (#56) |
| Near-duplicate near-misses | weekly count and score distribution | the weekly digest — this is the record the threshold gets tuned from (`03` §11). The threshold starts at **0.90, unverified**. Stored in `near_duplicate_checks` (`04`) and reported by #47: the week's near-misses, their lowest, median and highest similarity, and the candidates reused as duplicates |
| Unhandled exception | any | Sentry, scrubbed per §7 (#54) |
| App down | — | **not alerted.** You will know. |

**The three reading counters are why this table is not blind to a bad extraction** (#27). Measured
against the real documents on 2026-09-23, `spans_rejected` was **0** on a reading that cut sentences
into uncitable fragments and skipped 27% of the English CV, so that row alone would never have fired.
The first two are strict because the measured separation is clean — 63 and 68 on the bad reading, **0
and 0** after #27. The third is a threshold rather than zero, and deliberately loose: a document that
repeats another's qualifications now leaves that whole block unclaimed by design, which measured
1,071 code points, while the skipped `PROJECTS` block that started #27 measured 3,875. Tighten it when
there is more than one CV's worth of readings to tune from, the way §6's near-duplicate row is tuned.

**The five CV-upload rows read columns on `cv_versions`** (`04`), written by the save in the same
insert. A cron cannot read Vercel logs, and the counters used to live only there and in the save's
response (`06`, 2026-09-29). The current-version selection rule is in `04` `cron_readings`.

**The round-cost baseline is a constant, not a measurement yet** (`06`, 2026-09-29). It is set from
`03` §6's estimate plus #74's measured model-answer spend, **$0.70 a round**. Spend is counted
from every stored `tokens_in`/`tokens_out` row — `questions`, `scoring_attempts`, `round_feedback`,
`follow_ups` and `model_answers` (`04`) — each counted in the week of its own `created_at`, with no
round attribution. The threshold is 3× the baseline × max(1, rounds started that week). Rows are priced
by per-model constants beside the pinned strings in `lib/ai/models.ts`. Transcription, speech, embeddings and CV extraction
store no tokens and are not in it, so the threshold is loose until it is re-measured: **after eight
real rounds, the constant is replaced by the measured cost of those rounds**, recorded in `06`.
**Model answers (#74) added spend to the original estimate**: measured on synthetic input at about
$0.22 for an English round of three questions and their follow-ups and about $0.35 for a Japanese
one (`03` §4, 2026-10-04). The owner raised the baseline from $0.40 to $0.70 on 2026-10-05,
making the 3× threshold $2.10 per round started. The re-measurement after eight real rounds includes
model answers.

**One failure no row here sees: a lumped reading** (#29). A late, dense section returned as a few
paragraph-sized claims leaves coverage complete, abuts nothing and repeats nothing, so every counter
reads clean. It is prevented by windowed extraction, not detected. The `quotes_outside_window` row
guards the windowing itself and is strict, because it measured 0 across every windowed call.

**Implementation** (#55): two Vercel Cron routes under `/api/cron/` (`07` §5.17, §5.18), authenticated
with `CRON_SECRET`, returning `401` without it. `self-check` (daily, `0 19 * * *` UTC) **writes the
daily dump first** (§8, #56) and then covers the first ten rows; `digest` (weekly, `0 20 * * 0` UTC,
Monday morning in Tokyo) reports the Asia/Tokyo week's rounds, tokens and spend, and — since #47 —
the near-duplicate guard's week. Each run is **appended** to `cron_runs` with its `cron_readings`
(`04`) and the status page reads the newest.

How the rows are read, decided in #55 (`06`):

- **Every threshold is a named constant** in `lib/monitor/thresholds.ts`, red when the reading is
  **above** it; each has a unit test at, below and above it. The ages are strict: an attempt pending
  for exactly 24 hours is not yet red.
- **"This week" is the Asia/Tokyo week, Monday 00:00 to Monday 00:00**, the user's local week, as
  "today" is the user's local day (`06`, 2026-09-28). Spend is week-to-date at the run; the digest
  reports the week that has ended.
- **Spend prices each token row by its own model's rate** — `MODEL_PRICES` beside the pinned strings in
  `lib/ai/models.ts`, per million tokens, verified against OpenAI's pricing page with the date. Every
  input token is priced as uncached. A row stamped with a model that has no price is excluded from the
  dollar sum; `self-check` is red and names that model even below the dollar threshold. A missing model
  stamp is named as such. The digest likewise names any model excluded from its spend figure.
- **The five CV rows read the current version in each language** (`04` `cron_readings`): null
  counters are no reading, never zero.

**Vercel Hobby cron, verified 2026-09-12:** 100 cron jobs per project, **minimum interval once per
day**, **per-hour scheduling precision** — a job set to `0 1 * * *` fires somewhere between 01:00 and
01:59. A more frequent expression does not degrade; it **fails the deployment** with *"Hobby accounts
are limited to daily cron jobs."*

Two things follow, one of which reverses a worry this section used to carry:

- **The `pending` threshold is 24 hours, not one.** As anticipated. That is still enough to catch the
  failure that matters — the loss is a delayed discovery, not a lost row — and it is not worth a
  vendor or a plan to shorten.
- **Two routes are fine.** The old note assumed daily-only might force one job to do both. It does
  not: the limit is a *floor* on the interval, so a weekly `digest` is legal precisely because weekly
  is less frequent than daily. Keep them separate.

The ±59 minute jitter touches nothing here. Both jobs are "sometime that day" work, and §8's dump is
sized for a daily boundary, not a precise hour.

**Where the alerts go: a private status page, not email** (decided by the user 2026-09-28, `06`).
Each cron run is appended to the database, and a signed-in page shows every row above with its latest
reading and when each job last ran. It sits behind the same session and allowlist as every other page:
the user's own page, not an admin route (`07` §6) and not a sharing surface (invariant 6). No email
vendor, which keeps `08` §2's reason for rejecting magic links intact.

**The cost, accepted:** a page is only read when the user opens it, and an alert nobody opens is not
monitoring. Two things narrow that. Both signals are slow by nature (a day-late discovery loses
nothing, as the `pending` threshold already accepts), and **the page leads with staleness**: if
`self-check` has not run for over 48 hours it says so before anything else, so a dead cron never reads
as "all clear". **Home also carries one line when any check is red or `self-check` is stale**, and
nothing when all is well (`10` §1, decided 2026-09-29, `06`), so a red check shows where the user
already looks.

**Cost ceiling as a control, not a chart:** each `OPENAI_API_KEY` carries a monthly usage cap at a
multiple of the expected $3–5 (`03` §6). A runaway loop then fails closed instead of quietly spending.
*Corrected 2026-09-27:* this said the cap fails as `503 model_unavailable`. **Upstream it is `429
project_spend_limit_exceeded`** (OpenAI's spend-limits guide, found in #14). The round loop maps it:
the preflight reports it as `503 model_unavailable`, which the app already handles honestly, and no
route retries it as though it were a rate limit (`07` §2, `06`, confirm 5).

**As built (#48).** `lib/ai/upstream.ts` classes the `429` by its code — `project_spend_limit_exceeded`
or `organization_spend_limit_exceeded` — instead of as `upstream_429`, marks it not retryable for the
SDK, and the scoring loop stops on it after one call. **Not verified, and not verifiable without
spending a project to its limit:** whether OpenAI refuses `GET /v1/models/{id}`, the preflight's
probe, for a spent project. If it does not, the limit is first met mid-round, where each call fails
once and is stated as such — a transcription to retry or type, a score that reads as failed, a
follow-up recorded as missing — and the next round's start is refused as soon as a probe is.

---

## 7. What is never in a log, a trace or an error report

`03` §8's rule, restated here because a deployment adds three new places to break it: Vercel runtime
logs, Sentry, and the status page the cron routes write (§6).

**Never:** transcript text, corrected text, **CV document text**, CV text or claim text, **a document's
`source_filename`**, company notes, prompt bodies, model response bodies, salary expectations. A
rejected span's sliced text is CV text and is on this list; `spans_rejected` is a count, and a count is
all that is ever logged or shown about it (§6). **Logs and reports carry ids, counts, durations and error
classes** — nothing else. `07` §2 applies the same rule to `error.detail`, and `11` §3.10 tests it with
sentinel strings.

Sentry configuration, decided here so it is not decided under pressure:

- `sendDefaultPii: false`. *SDK v11 removed that option and collects everything by default, bodies included;* its replacement, `dataCollection`, turns every category off (`lib/sentry.ts`, `06`, 2026-09-30).
- A `beforeSend` that **drops request and response bodies entirely** rather than filtering fields — an allowlist of safe keys is a list someone forgets to extend when a column is added.
- Breadcrumbs from `fetch` keep the URL and status, never the body. The URL loses its query string: a presigned S3 URL carries its signature there, and the OAuth callback its code.
- Console breadcrumbs are dropped, and a failed query's exception loses its `params:` text. Drizzle and Better Auth log a failed query with its parameters: a session token, or an answer's transcript.
- Source maps uploaded at build and **not served publicly**: the SDK deletes the browser's maps from `.next/static` after upload and strips their `sourceMappingURL` comments. Where Sentry is off, no browser map is generated at all.
- **Errors only: no performance tracing, Session Replay or release-health sessions** (`06`, 2026-09-29; 2026-09-30). Replay records the DOM, which shows CV and transcript text; a tracing sample carries request detail `beforeSend` never sees. The SDK's setup wizard can turn tracing and Replay on; both stay off. Browser and process session integrations are removed, and Node HTTP request sessions are disabled.
- The configuration is one module, `lib/sentry.ts`, shared by the server, edge and browser inits. The sentinel test is specified in `11` §3.10.
- The status page and the cron runs behind it hold numbers and identifiers only, including model
  identifiers for unpriced spend. Never the answer.

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
| Postgres | Neon point-in-time restore, **6 hours and not extendable on Free**, plus a **daily dump** written to `s3://<bucket>/backups/`, SSE-S3, by its own write-only IAM user (§3 step 5). Built by #56, below | Restore into a Neon branch, verify, then promote |
| Audio in S3 | Bucket versioning on; no lifecycle rule on `prod/` | Object version restore |
| Prompts, rubrics, seeds | Git | Checkout |
| Secrets | Vercel env is the store of record; not backed up | Regenerate from the source consoles (§3) |

The `pg_dump` exists because Neon's retention window is a plan feature and this data outlives any
plan. **It runs daily, from the `self-check` cron route** (§6) — not weekly, as this section
originally said.

**How it is written** (#56, `06` 2026-09-30). Not the `pg_dump` binary: `lib/backup/` writes a
**logical, data-only dump in-process**, inside the function, from one `repeatable read` snapshot over
`DATABASE_URL_UNPOOLED` (verify-full). Each table's rows are the text Postgres writes for `COPY … TO
STDOUT`, in a psql script of `COPY … FROM stdin` blocks ordered parents first, streamed to S3 a part at
a time — never the whole dump in memory. The key is `backups/<run instant>.sql`
(`backups/2026-09-30T19-12-40.123Z.sql`), fixed by the run, never by a caller. A failed dump is a red
row on the status page (§6), and its log line carries the key, size, duration and error class only
(§7). The schema is not in the file; it is the migrations in git, and the file's header names the one
it was taken at. drizzle's migration journal, `drizzle.__drizzle_migrations`, is in the file.

**Restoring one** (the drill is #21's criterion, `06` 2026-09-29):

1. Download the object as the account owner. The backup-writer cannot read it back, and nothing
   deployed can.
2. Make the target: a Neon branch created **Schema only** from `main` (§3 step 8), which fits only
   while `main` has applied no migration since the dump; otherwise an empty database migrated with
   `drizzle-kit migrate` at the commit that has the migration the header names. The file refuses any
   other schema: it carries a fingerprint of `public`'s tables, columns, constraints and indexes, and
   checks the target's against it before it writes a row.
3. `psql "<target's unpooled URL>" -f <file>`. The file sets `ON_ERROR_STOP` itself and is one
   transaction: it refuses a target that already holds rows, checks every table's row count before it
   commits, and a file cut short commits nothing. It writes the source's migration journal into the
   target's only when the target's is empty: a Schema only branch copies the table but not its rows,
   and a branch promoted with an empty journal would have `drizzle-kit migrate` re-run `0000` against
   tables that exist. A target `drizzle-kit migrate` built keeps its own journal.
4. Sign in again: `sessions`, `accounts` and `verifications` are not in the file.

CI restores a dump this way on every run (`11` §3.18), into a fresh database, and compares every
table's rows. What CI cannot do is the drill against a real production dump.

**Retention: every dump in `backups/` is kept forever**, with no lifecycle rule, like `prod/`
(`06`, 2026-09-29). Nothing here is deleted, and at this data size a daily object costs next to
nothing. **The dump leaves out `sessions`, `accounts` and `verifications`**: they hold session tokens
and Google's OAuth tokens, a restore does not need them (signing in again rebuilds them), and a
forever-kept file should not carry credentials.

**Neon's history window, verified 2026-09-12:** Free is **6 hours by default and 6 hours at maximum**,
capped at 1 GB of change history. Launch is 1 day rising to 7; Scale is 1 day rising to 30. Six hours
is a ceiling on Free, not a default that can be raised.

**Why that moved the dump.** Six hours plus a weekly dump leaves a worst case of about **seven days of
rounds** — a bad write on a Sunday, found on Monday, is past the PITR window and behind the last dump.
This project's own premise is that the accumulated measurement is the only unrecoverable thing here, so
a week-wide hole in it is not a limitation to note, it is the failure the backup exists to prevent. A
daily dump closes the worst case to roughly **24 hours**, inside which the 6-hour window covers the
recent tail. At this data size the cost is one small S3 object a day.

**What was deliberately not done:** no Neon plan upgrade, no per-round dump. The plan upgrade buys a
7-day window the daily dump already covers. A per-round dump would put a backup write on a
user-facing path and give it a failure mode there, to protect against losing one round — the wrong
trade in a system whose §6 monitoring already assumes the keyboard tells you when something is broken
*now*, and whose backups exist for what has no symptom.

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
- [ ] After the first scheduled run only: confirm `self-check` appears on the status page (§6).
- [ ] After the first deploy only: run the restore drill (§8).

---

## 10. Deliberately not built

| Not built | Why |
| --- | --- |
| A fourth environment | `develop` **is** staging — a long-lived branch with its own long-lived Neon branch. A separate staging tier would be a third database to seed, migrate and keep honest. |
| A Neon branch per preview | §1 — bookkeeping without a payoff at this scale; feature work integrates against Neon `develop`. |
| Blue/green or canary | One user. Vercel's instant rollback is the entire deployment-risk story. |
| Infrastructure as code | One Next.js app, one managed database, one bucket. This is the same reason `13-infrastructure-and-security.md` is not written (`00-status.md`); revisit together. |
| Automated migrations on `main`'s deploy | §4 — the measurement record does not get unattended DDL. `develop`'s deploy does migrate, since 2026-10-06. |
| An uptime monitor | §6 — the one user is the uptime monitor. |
| Log drains / a second observability vendor | §7 — every extra destination is another place the never-log rule can be broken. |
| A deploy-time smoke test suite | §9 is a checklist on purpose: half of it is a judgement about whether feedback arrived fast enough to feel immediate, which is not assertable. |
