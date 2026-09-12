# Decision log

Newest first. Every entry records what was chosen, why, and what was rejected.

---
## Phase 5b — engineering-skills scaffolding

### [2026-09-12] Issues live in GitHub Issues, not local markdown

**Decided:** `docs/agents/issue-tracker.md` is the GitHub template. `to-spec`, `to-tickets`, `triage`
and `wayfinder` all drive `gh` against `yutaasakura96/suburi`.
**Alternatives considered:** local markdown under `.scratch/<feature>/`, which is what
`docs/00-status.md` instructed this session to choose; freeform prose describing a Backlog (Nulab)
workflow.
**Reason:** this reverses the status file, and the reversal is the point of recording it. That note was
written on the belief that Backlog was the tracker in play and that Backlog is unsupported — the second
half is true, the first was never checked against the repo, which has had a working GitHub remote since
Phase 5. Local markdown was the fallback for a repo with no remote; this repo has one. GitHub gives real
issue numbers, label queries that `triage` needs, and native issue dependencies that `wayfinder`'s
blocking graph reads directly — under local markdown that graph degrades to a `Blocked by:` line
maintained by hand.
**Not a privacy change:** the repo is already public. Invariant 6 governs *round data* — transcripts,
scores, the CV — none of which goes near an issue. Tickets are about code.
**PRs as a request surface: left off.** Single-user repo; there are no external PRs to triage.

### [2026-09-12] No `docs/adr/`; the decision log stays the single ADR surface

**Decided:** `docs/agents/domain.md` diverges from the skill's seed template. It points at
`docs/06-decision-log.md` and states that `docs/adr/` should not be created.
**Alternatives considered:** taking the template verbatim, which sends every skill to `docs/adr/` and
would have `/domain-modeling` create it lazily on the first resolved decision.
**Reason:** two decision records is none. This log is append-only and `CLAUDE.md` already calls it the
answer to every "why is it like this?" — a parallel `docs/adr/` would split thirty-seven entries of
history from everything written after Phase 6 starts, and the split would be invisible until someone
searched the wrong one. A new decision is a new entry here.
**Also written into `domain.md`:** the invariants are not negotiable in a ticket, and a ticket needing
one relaxed edits `04` §6, `07` §6 and `11` §3 first. The skills that generate tickets read this file;
that rule needed to be in their path, not only in `CLAUDE.md`.

---


## Phase 5 — repo configuration

### [2026-09-12] No branch guard hook; no hooks at all in v1

**Decided:** `.claude/hooks/` is not created. Nothing blocks an edit on `main`.
**Alternatives considered:** lfca-lab's `pre-edit-branch-guard.sh`, which refuses edits on `main` and
`master`; extending it to `develop` so `12` §4's feature-branch flow is enforced rather than followed.
**Reason:** the user's call, stated plainly — the agent is trusted to handle the work. Worth recording
because the docs argue the other way: `12` §4 says nothing is committed straight to `main`, and a push
to `main` promotes production. That rule is now a convention in `CLAUDE.md` rather than a mechanism.
**What still protects the measurement record:** migrations are manual and expand-only, so no unattended
DDL reaches Neon `main`; `drizzle-kit migrate` / `push` / `drop`, `psql`, `pg_dump`, all `aws` and every
writing Neon MCP tool sit in `ask`; and Vercel's instant rollback covers a bad code deploy. The branch
guard was the weakest of these, and it was the one removed.
**Precedent honoured:** the catalog records that a `pre-push-main-guard.sh` existed from 2026-09-02 to
2026-09-06 and was deliberately removed, partly because a guard that is a text match on a shell command
is not a guard. `git push:*` is therefore in `allow`, not `ask`.

### [2026-09-12] Four plugins named explicitly, two of them off

**Decided:** `.claude/settings.json` sets `openai-developers` and `mattpocock-skills` to `true`, and
`superpowers` and `frontend-design` to `false` — the two `false` entries written out rather than left
absent.
**Alternatives considered:** enabling nothing and inheriting the global layer; enabling `superpowers`
for its TDD and systematic-debugging skills.
**Reason:** `openai-developers` because every model call here is OpenAI and its bundled Docs MCP is the
tool that closes the open TBD on the transcription model id and price (`03` §4). `mattpocock-skills`
because Phase 6 runs on `/grill-with-docs`, which is unreachable while the pack is disabled globally.
`superpowers` is off because it must not share a repo with mattpocock-skills, and because its
`brainstorming` skill is model-invocable and describes itself as mandatory — in a planning repo it will
try to seize any interview. `frontend-design` is off because `05` and `10` were *extracted* from a built
prototype, and a skill that forces a fresh design frame works against a design system that was measured
rather than invented.
**Why the explicit `false`:** absence reads as disabled today, but a later flip at user scope would leak
both plugins into this repo silently. The `false` is the record of a decision, not a no-op.

### [2026-09-12] No `.mcp.json`

**Decided:** no project-scoped MCP servers.
**Alternatives considered:** Playwright (the testing plan drives the recorder with it); the GitHub MCP;
a project-scoped Neon server.
**Reason:** context7 and Neon already resolve above project scope, so wiring them again would be a
second copy to keep current. Playwright has no application to drive yet — wire it at the first E2E
ticket, against a real dev server, not before. The catalog also records that both existing GitHub MCP
wirings use the deprecated legacy npm server; `gh` covers what is needed here.

### [2026-09-12] No `.claude/agents/` and no `.claude/rules/`

**Decided:** neither directory is created.
**Alternatives considered:** copying the house roster (code-reviewer, db-agent, security-agent) and the
per-concern rule files from portfolio-v2 and ss-platform.
**Reason:** there is no code. Rules written now would be a second copy of `docs/` and `CONTEXT.md` that
drifts from them, which is the configuration smell the catalog names directly. Revisit once there is a
codebase to have conventions about — the roster is a copy-paste away.

---

## Phase 4b — the deferred Tier 2 docs

### [2026-09-12] Two long-lived branches, each with its own Neon branch

**Decided:** `main` is production and deploys to Vercel production against the Neon `main` branch.
`develop` is development, has a **stable** Vercel URL, and runs against the Neon `develop` branch.
Feature branches are cut from `develop`, merge back into it, and their previews share Neon `develop`.
The branch ↔ database mapping is one-to-one, and **nothing but `main` points at Neon `main`.**
**Alternatives considered:** trunk-based on `main` alone with per-preview Neon branches (what `12` said
before this); a separate long-lived staging tier on top of both.
**Reason:** the user's call, and it lands well here for a reason worth writing down — every write in this
schema is permanent (`04` §5), so the protection that matters is keeping unfinished code away from the
Neon `main` branch, and a one-to-one branch mapping states that as a rule about credentials rather than
a rule someone remembers. A per-preview Neon branch was bookkeeping without a payoff at eight rounds a
month; a third tier would be a third database to seed, migrate and keep honest.
**Consequences that are not obvious:**
- **`develop` needs a stable domain**, because Google's authorised redirect URIs are an exact-match list
  and a generated per-commit hostname can never complete sign-in. Feature-branch previews therefore
  cannot sign in at all — feature work is verified on `develop`.
- **Neon `develop` is reset from a fresh synthetic seed, never branched from `main`.** Branch-from-parent
  is the convenient move and it would copy the real CV, transcripts and salary expectations onto a
  branch that unfinished code writes to.
- **Cron is off on `develop`**: the self-check would mail alerts about synthetic data, and an alert
  channel that cries wolf is one you stop reading.
- **Migrate Neon `main` before merging `develop` into `main`**, not after. Expand-only is what makes that
  ordering safe from both sides.
- **A rollback does not un-merge.** `main` keeps the bad commit; the fix goes forward through `develop`.
  `main` is never force-pushed — a rewritten `main` is one whose relationship to what is running stops
  being knowable.

### [2026-09-12] Every mutation is a Route Handler; no Server Actions

**Decided:** every write in the app is an HTTP endpoint under `/api` with one shared error envelope.
Reads are Server Components, except the three the live round client needs as JSON (resume, History's
list, and minting a playback URL).
**Alternatives considered:** Server Actions by default with Route Handlers only for
presign/transcribe/score; a split where the live round is HTTP and setup is Server Actions.
**Reason:** the round loop is client-driven whatever happens — the recorder holds a blob and the upload
is a direct PUT to S3 — and `03` §8 requires a specific sentence for every failure, which means one
error surface the UI can map exhaustively. Two conventions would give two half-mapped failure
surfaces. One HTTP surface is also curl-able, testable without a browser, and documentable, which is
what `07` is.
**Cost accepted:** round setup and the CV upload would be less code as Server Actions. They are
endpoints anyway.

### [2026-09-12] The answer row is created at presign, not at submit

**Decided:** `POST /api/rounds/{id}/answers` creates the `answers` row with nullable audio and
transcript columns and returns its uuid with the presigned PUT. `transcribe` and `submit` then address
that uuid.
**Alternatives considered:** a client-generated uuid plus an `Idempotency-Key` header with server-side
upsert; one write at submit with nothing partial in the database.
**Reason:** it makes `transcribe` and `submit` idempotent for free — a double-click, a retried fetch or
a flaky connection cannot produce a second row. Given `answers_first_attempt_uniq` and the
never-overwrite rule, a duplicate answer row is not an annoyance, it is a corrupted measurement. It
also keeps the server as the sole author of the S3 key, the `position`, and `is_first_attempt`. The
client-uuid option was rejected specifically because it hands the client a primary key.
**Consequence:** partial answer states are database facts, so a refresh mid-round resumes correctly —
which `03` §7 already promised.

### [2026-09-12] A practice retry reuses the original answer's `position`

**Decided:** a retry writes a new `answers` row with `retry_of_answer_id` set and **the same
`position`** as the answer it retries. Ordering ties break by `created_at`.
**Alternatives considered:** giving the retry the next position; making `answers (round_id, position)`
unique.
**Reason:** the retry belongs beside its original when the round is rendered, not at the end of it. It
is also why the index in `04` §3 is not unique, and it must not be made unique later — that change
would make every practice retry fail at insert.
**Unchanged:** only the original ever carries `is_first_attempt` (refusal #3).

### [2026-09-12] The error envelope's `message` is never rendered to the user

**Decided:** one envelope everywhere — `{ error: { code, message, detail } }`. `code` is a closed
snake_case catalogue the UI switches on; `message` is an English sentence for the developer and the log
line; `detail` carries ids, counts, durations and error classes only.
**Alternatives considered:** returning user-facing text from the server; returning the text in the
round's language.
**Reason:** `03` §8 demands a specific sentence per failure and a server string cannot be the Japanese
one. More importantly, **the bilingual chrome rule is still open** — routing every user-visible string
through the copy layer means `07` does not accidentally decide it. `detail` obeys `03` §8's never-log
list for the same reason a log line does: an error payload would otherwise be a third home for
sensitive material.

### [2026-09-12] `422` means an invariant refused the request

**Decided:** `422` is reserved for well-formed requests that a guarantee in `04` refuses — a
felt-pressure rating on a practice round, retrying a score that already succeeded, a second first
attempt. Its `code` names the invariant. `403` is never used anywhere.
**Reason:** those are not client bugs and not server errors; they are the schema answering back, and a
`422` in a log means the invariant did its job. `403` is absent because there are no roles (`08` §4) —
another user's row is `404`, so the API never confirms that someone else's id exists.

### [2026-09-12] Felt pressure and round completion are one endpoint

**Decided:** `POST /api/rounds/{id}/complete` takes the optional `felt_pressure`, closes the round and
generates the round feedback in one call.
**Alternatives considered:** a separate `pressure` endpoint followed by `complete`.
**Reason:** `04` requires the rating to be captured **before any feedback**, and one endpoint makes that
ordering structural instead of a rule someone has to remember — feedback cannot be generated without
the rating already written in the same transaction. It also enforces the mode rules in one place:
realistic without a rating is `422`, practice with one is `422`.

### [2026-09-12] A raw transcript is final once obtained; a typed answer says so

**Decided:** `transcribe` is idempotent and has no `force`. If `transcript_raw` is set, the stored value
is returned and no model call is made. Retry is possible only while it is null — exactly the state a
failure leaves. The typing fallback writes `transcript_raw` with `transcriber_model_id: null` and
`words_per_minute: null`.
**Reason:** PRD §9 says raw transcripts are never discarded, and an overwrite is a discard. The null
transcriber id exists so the record says honestly that no transcriber produced that text, and the null
WPM because a typed answer has no delivery to measure — silently treating it as spoken would put a
fabricated number in the delivery record.

### [2026-09-12] Scoring is dispatched by a client call that is not awaited

**Decided:** `submit` creates the `scoring_attempts` row as `pending` with all four stamps and returns
immediately; the client then fires `POST /api/scoring-attempts/{id}/run` without awaiting it. The
handler is idempotent and only transitions `pending`.
**Alternatives considered:** holding the submit request open until scoring finishes; a queue vendor
(QStash, Inngest); Next.js's `after()`.
**Reason:** `03` §3 requires scoring to happen during the round rather than in a burst at the end, and
the user is recording the next answer while it runs, so nothing is waiting. A queue is a vendor for one
job at eight rounds a month.
**Open:** whether `after()` completes ~60s of post-response work reliably inside a Vercel Hobby
function. **Unverified — confirm before implementation.** If it does, the trigger moves server-side and
`run` survives only for the History retry path.
**Mitigation either way:** an abandoned request leaves a `pending` row, which is alerted on daily
(`12` §6) and retryable from History. Pending is already a first-class state.

### [2026-09-12] Cursor pagination, a fixed sort, and a closed filter set

**Decided:** `?limit=&cursor=` everywhere, keyset on `(started_at, id)`, `next_cursor` in the response.
Sort order is fixed per collection and is not a parameter. Filters are named columns only —
`language`, `round_type`, `mode` — and an unknown parameter is a `400`.
**Alternatives considered:** offset/limit; no pagination in v1.
**Reason:** offset drifts when a round is inserted mid-scroll, and a skipped or repeated row in a
measurement list is a wrong answer that looks right. The filters match the existing index in `04` §3
exactly, so no new index is needed. Rejecting unknown parameters rather than ignoring them matters for
the same reason: a silently dropped filter returns the wrong set with no sign.

### [2026-09-12] Integration tests run against a real Postgres, and Playwright drives the recorder

**Decided:** Vitest for units; Vitest integration tests against a real Postgres 17 + `pgvector`
(Docker locally, a service container in CI); Playwright on Chromium over the UI **including the
recorder's mechanics** with a fake media device and S3/OpenAI intercepted.
**Alternatives considered:** mocking the database; Playwright limited to auth and navigation; a full
end-to-end round against live services.
**Reason:** the four headline invariants are a partial unique index, two check constraints and a
not-null set — mocking Postgres would test the mock and leave exactly those unguarded. On the recorder:
a fake device cannot say anything about transcript quality, but it can prove the 240-second cap and the
15-minute practice runaway guard fire **and keep the take**, which is a promise printed on screen 4.
**Line held:** no test asserts on transcript content, and no test calls OpenAI or S3.

### [2026-09-12] No composite score is tested as an absence, in three places

**Decided:** refusal #1 is asserted by (1) querying `information_schema` for any column named like a
total or average and for the existence of any view, (2) a source-level check that no aggregate is
applied to `scores.value`, (3) schema-validating every API response.
**Reason:** it is the one invariant with no constraint behind it, because it is an absence and Postgres
cannot enforce the absence of a column someone might add. Three failing tests is the intended cost of
"just a quick overall" — it forces editing `04`, `07` and `11` on purpose.

### [2026-09-12] Scoring quality is a harness, not a CI test — and there is no coverage target

**Decided:** automated tests always use a fake behind the `lib/ai/score.ts` port. Real quality is
measured by `scripts/rescore-held-out.ts`, run when any of the four stamps changes, which prints a
per-dimension drift table and writes `held_out_rescores` rows with `is_superseding = false`. No
coverage threshold anywhere.
**Alternatives considered:** recorded fixtures replayed in CI; live model calls in CI.
**Reason:** drift of 0.3 on one dimension might be fine or might be the project failing, and that call
needs a person looking at which dimension moved and which way. A red/green assertion would be either so
loose it never fires or so tight it fires on noise — and either way it would launder the judgement it
exists to inform. A coverage number would be satisfiable by testing the easy half of the codebase while
the four things that matter went unguarded.

### [2026-09-12] Three environments; previews get a Neon branch and synthetic data

**Decided:** Local, Preview (per branch: a Neon branch, `dev/` S3 prefix, synthetic seed) and
Production. `03` §12's two-environment table is superseded by `12` §1.
**Alternatives considered:** previews pointed at production data; previews off entirely.
**Reason:** a preview is unfinished code, and every write in this schema is permanent (`04` §5) — a
half-built handler writing to the measurement record cannot be undone, only outlived. The same Google
allowlist applies to previews, so a discovered preview URL still opens nothing. Local keeps the
production model strings, because a cheaper local model would make local behaviour unrepresentative of
the thing being measured.

### [2026-09-12] Migrations are manual, expand-only, and run before the deploy

**Decided:** review the SQL diff, apply to the preview branch, verify, apply to production, then merge
to `main` and let Vercel build. Additive changes only — a rename is add, dual-write, backfill, switch,
then drop in a **later** release. No down-migrations against production, ever. Rollback is Vercel's
instant rollback and nothing else.
**Alternatives considered:** migrating automatically in CI on deploy; keeping the freedom to drop and
rename in one release.
**Reason:** these migrations touch the table holding the six-month measurement, and `04` §5 makes
nothing recoverable by deletion — only by restore. Expand-only is precisely what makes instant rollback
safe: the previous build can still read the schema. The cost is remembering a step, and the checklist in
`12` §9 carries the reminder.
**Never:** a migration that rewrites `cv_versions.body`, or deletes from `answers`,
`scoring_attempts`, `scores`, `questions`, `cv_versions` or `cv_claims`.

### [2026-09-12] Monitoring watches pending scores and cost, not uptime

**Decided:** Sentry for exceptions with bodies dropped wholesale in `beforeSend`, plus two cron routes —
a daily self-check (pending over an hour, unsuperseded failures, rejected CV spans) and a weekly digest
(tokens, spend, near-duplicate near-misses). **App-down is deliberately not alerted.**
**Alternatives considered:** Vercel built-ins only; a full stack with a log drain and an uptime monitor.
**Reason:** there is one user, who will notice an outage within one attempted round. What has no symptom
at the keyboard is a scoring path that silently fails — pending is rendered honestly and excluded from
trends, so the result is a chart built on fewer points than you think, discovered months later — and
cost drift, since model spend dominates infrastructure by two orders of magnitude. Sentry drops request
bodies rather than filtering fields because an allowlist of safe keys is a list someone forgets to
extend when a column is added.
**Open:** Vercel Hobby's cron frequency limit, and who sends the mail. Both in `12` §6. **Do not solve
the cron limit by adding a vendor.**

### [2026-09-12] A weekly `pg_dump` sits alongside Neon PITR, and the restore gets drilled

**Decided:** Neon point-in-time restore **plus** a weekly `pg_dump` to `s3://<bucket>/backups/`,
encrypted. S3 bucket versioning on, no lifecycle rule on `prod/`. The restore is drilled into a Neon
branch immediately after the first production deploy.
**Reason:** the six-month chart is the product, and `04` §5 means it cannot be rebuilt from a later
state. Neon's retention window is a plan feature and this data outlives any plan, so the dump is
deliberately independent of what that window turns out to be. The drill is listed because an untested
restore is a hope, and this one guards the only irreplaceable thing in the project.

## Phase 4 — technical design

### [2026-09-12] The app is hosted; a CV and audio do leave the machine

**Decided:** Next.js on Vercel, Postgres on Neon, audio in AWS S3, models from OpenAI. Docker
Postgres locally, Neon in production. This answers `IDEA.md` §10.8 with **yes, it leaves the
machine.**
**Alternatives considered:** a fully local desktop app with local Whisper and a local LLM (nothing
leaves); a local app with cloud models only (data at rest stays local).
**Reason:** local models could not be shown to score 敬語 reliably, and round-end feedback must render
while the user is still at the machine — PRD §9 calls a spinner that outlives the sitting a defect,
and local inference on consumer hardware puts that at risk. Privacy is then served by access control
and encryption rather than by locality.
**Revisit if:** the privacy posture stops feeling acceptable, or local models become demonstrably good
enough at Japanese register that the latency maths works.

### [2026-09-12] Postgres, not SQLite

**Decided:** Postgres 17 with `pgvector`.
**Alternatives considered:** SQLite, which is genuinely simpler and viable for one user.
**Reason:** three things, none of them "Postgres is better" — Vercel Functions have no persistent
disk, so SQLite would have forced a different host; near-duplicate question detection wants vector
search and `pgvector` is in the box; and the multi-tenancy decision below makes Postgres the safer
floor. At one user today, SQLite would have worked.
**Revisit if:** the hosting model changes to something with a real disk *and* vector search and
tenancy both turn out to be unnecessary.

### [2026-09-12] The schema is multi-tenant; the door admits one person

**Decided:** every table carries `user_id` from day one. Access is Better Auth with Google as the
only IdP, `disableSignUp: true`, and a hardcoded email allowlist. No invite flow, no roles, no
signup route.
**Alternatives considered:** a strictly single-owner schema with no `user_id` anywhere (the original
PRD §1 position); full multi-tenancy including an invite flow and roles.
**Reason:** the user's call, made with the trade-off stated. **This reverses PRD §1 as written**, so
`01` and `02` were amended rather than left contradicting the schema. The countervailing argument —
that a scope column holding one value taxes every query and index forever — was raised and
overruled in favour of not having to migrate later.
**Revisit if:** it becomes clear Suburi will never be a product, in which case the columns are dead
weight and can be dropped.
**Does not change:** screen-spec refusal #6. Multi-tenancy is not permission to build a sharing
surface, a leaderboard, or comparison with anyone.

### [2026-09-12] One pinned model for all three jobs; no model picker in the UI

**Decided:** `gpt-5.6-sol` in config for question generation, follow-up generation and scoring. No
UI control can change any model.
**Alternatives considered:** tiering by job (Sol for scoring, Luna for follow-ups); `gpt-6-astra` for
scoring; a per-session model picker on Round setup.
**Reason:** cost is not a constraint — a round is roughly $0.40 on Sol and the 30-day target of eight
rounds is a few dollars — so consistency decided it. The picker was rejected specifically: a
scoring model chosen per session makes drift **voluntary, invisible and biased**, because the pull is
to re-roll after a round that scored badly. Screen-spec refusal #5 already handles a changed scoring
model by drawing a boundary on Progress; a per-session picker would shred a 30-point chart into
segments of one.
**Revisit if:** the OpenAI bill becomes noticeable, in which case downgrade deliberately, re-score the
held-out set, and accept one boundary line.

### [2026-09-12] Never point at a model alias; stamp model, prompt and tokens separately

**Decided:** the scoring model is an exact version string. `model_id`, `prompt_version`, `tokens_in`
and `tokens_out` are stored on every AI-touched row.
**Alternatives considered:** a `-latest` alias; a single combined "version" stamp.
**Reason:** OpenAI's own docs state the `gpt-daybreak-*-latest` aliases will be repointed at newer
models as they ship — an alias in the scoring path would make the six-month chart measure OpenAI's
release schedule. Model and prompt are separated because the same model with a revised prompt is a
different experiment. Token counts exist so "which tier is good enough for the money" is answerable
from data rather than argued from memory.
**Revisit if:** never, for the alias. The stamps can only grow.

### [2026-09-12] Answers are scored as they are submitted, not at round end

**Decided:** scoring dispatches the moment an answer is submitted, while the user records the next
one. The round-end feedback screen is a read.
**Alternatives considered:** batch-scoring all sixteen answers when the round ends.
**Reason:** PRD §9 requires feedback to render while the user is still there. Batching would put a
reasoning model on the critical path at exactly the worst moment. The residual risk is the last
answer, which is covered by screen 7 — the felt-pressure rating already sits between the last answer
and feedback, and is unhurried by design.
**Revisit if:** never without also solving the last-answer case. **Do not make screen 7 skippable in
realistic mode** — it is now load-bearing for latency as well as for the falsification test.

### [2026-09-12] Audio lives in AWS S3

**Decided:** S3, one bucket, uploaded browser → S3 directly with a short-lived presigned PUT.
**Alternatives considered:** Neon Object Storage (S3-compatible, forks with the DB branch, but in
beta with GA only expected this quarter); Cloudflare R2; Vercel Blob.
**Reason:** the services are genuinely interchangeable at ~300 MB over six months, so the tiebreaker
was alignment with where the user's infrastructure is heading — a self-built deployment platform on
AWS. The direct upload is not a preference: a Vercel Function caps bodies at 4.5 MB and a four-minute
take can exceed that.
**Revisit if:** the AWS platform does not materialise, in which case any S3-compatible store is a
credentials-and-endpoint change.

### [2026-09-12] The citable unit of a CV is an atomic claim with an exact span

**Decided:** on upload, a model splits the CV into atomic claims, each stored with a character span
into the version's immutable text. Extraction runs **once per CV version and is frozen**. Rendered
quotes are sliced from stored text by span.
**Alternatives considered:** bullet/line-level units, split deterministically; verbatim CV text with
no units at all.
**Reason:** only claim-level units make two of the four differentiators expressible — "claims
unsupported by the CV" and "CV material never used". The span is an anti-hallucination mechanism, not
a nicety: a quote of a CV line the user never wrote would destroy trust in the instrument faster than
a wrong score. Freezing at upload removes the determinism objection to using a model.
**Revisit if:** extraction quality on a real CV turns out to be poor — it is currently unmeasured.

### [2026-09-12] CV coverage carries forward on exact text match only

**Decided:** a claim in a new CV version whose normalised text is byte-identical to one in the
previous version inherits its coverage history. Everything else is a new claim with empty coverage.
No fuzzy matching, no similarity threshold, no review step.
**Alternatives considered:** embedding-similarity suggestions with manual confirmation; resetting
coverage entirely on every new CV version.
**Reason:** deterministic, explainable, and correct in the common case where one section is edited
and the rest is untouched. A reworded claim honestly *is* a different thing to cite. The related
worry — that a new CV makes old rounds less comparable — is already handled by the CV version stamp
and Progress's boundary lines, and should not be solved twice.
**Revisit if:** CV phrasing is polished often enough that coverage history is repeatedly lost.

### [2026-09-12] Near-duplicate questions are caught with pgvector before insert

**Decided:** embed every generated question, store the vector, and compare by cosine distance against
non-retired questions in the same `(user_id, language, round_type)` slice before inserting. Above
threshold, reuse the existing row.
**Alternatives considered:** no duplicate detection; exact-text matching only.
**Reason:** progress data is keyed by question id, so a bank holding five rephrasings of one question
silently fragments the measurement into five questions with one first attempt each instead of one
with five — which directly attacks the six-month criterion of 30 first attempts per language.
**Revisit if:** the threshold proves wrong. It is a guess until there is real data — start strict,
log every near-miss with its score, and tune from the log rather than from intuition.

### [2026-09-12] Practice mode gets a runaway guard, not a timer

**Decided:** a hard 15-minute cap per answer in practice mode. Not displayed as pressure, not part of
the practice UI's rhythm; when it fires it behaves exactly like the realistic cap and the take is
kept.
**Alternatives considered:** no cap at all; reusing realistic mode's visible 4-minute timer.
**Reason:** practice mode is defined by having no timer, so a visible countdown would change the
mode. The cap exists only so a forgotten open tab cannot produce an unbounded upload.
**Revisit if:** a legitimate practice answer ever approaches 15 minutes.

### [2026-09-12] Drizzle as the ORM

**Decided:** Drizzle.
**Alternatives considered:** Prisma; raw SQL.
**Reason:** Better Auth ships a first-class Drizzle adapter, the schema is TypeScript agents can
read, and migrations are plain SQL that diffs well. Raw SQL was rejected because the schema's many
version-stamp columns are exactly where an untyped mistake would be most expensive and least visible.
**Revisit if:** the Better Auth adapter becomes a constraint.

---

### [2026-09-12] The project is named Suburi (素振り)

**Decided:** `interview-lab` was a working title and is retired. The project is **Suburi**, written
素振り in Japanese contexts and `suburi` as the repo and directory name.

**Why:** 素振り is repeated solo practice of a form with no opponent — which describes the product and,
honestly, its riskiest assumption at the same time. It is bilingual-native rather than English with a
Japanese toggle, which is the exact failure the brief's 30-day language floor exists to catch. It is
also distinctive in a category of invented Latinate names (Yoodli, Skillora, Qwyse, Revarta, Verve,
Articuler).

**Verified before choosing, not assumed:** npm registry free; no GitHub repository of consequence
(highest is 4 stars); not in use by any interview-prep product in the surveyed field (Yoodli,
Skillora, Qwyse, Revarta, Verve AI, Big Interview, Final Round AI, HotSeat, interviewing.io, Pramp,
Google Interview Warmup). `suburi.com` is registered; `suburi.dev` showed no DNS records, which
suggests but does not prove it is available — unconfirmed, and it does not matter for a single-user
desktop tool.

**Rejected:** **Ichie** (一会, from 一期一会 — one encounter, never repeated) — the closest runner-up and
arguably a better match for first-attempt-only measurement, but more oblique and diluted by an
existing GitHub handle. **Rejected:** **Cold Open** — self-explaining but undistinctive in an
English-named category. **Rejected:** **Keiko** (稽古) — collides with keikoproj/keiko, 275 stars.
**Rejected:** **Honban** (本番) — npm name taken.

**Note:** the name does not contain the word "interview." Deliberate. The brief calls the product an
instrument rather than a coach, and there is exactly one user, who knows what it is.

---

### [2026-09-12] Feedback for a Japanese round is written in Japanese

**Decided:** A Japanese round's feedback, including rubric dimension names, is written in Japanese,
with a toggle to view it in English. English rounds are English.

**Why:** 敬語 feedback is the case that decides it — a note about the difference between ご覧になる and
拝見する barely survives being explained in English. Staying in the language is also reps. The toggle
exists because a nuanced point that does not land is worse than a translation.

**Rejected:** English everywhere (loses 敬語 precision). **Rejected:** Japanese with no toggle —
immersion is not worth quietly skimming feedback that would have been read carefully.

---

### [2026-09-12] All four §8 suggestions are v1 scope; only CV-grounding gates round one

**Decided:** CV-grounded evaluation, audio retention, the story bank and AI company research are all
committed v1 features with full stories. Only **CV-grounded evaluation** must work before the first
realistic round; audio capture ships early because it is unrecoverable later; the story bank and
research land during the 30-day window.

**Why:** MUST has a specific cost here — the 30-day criterion is 8 realistic rounds, and every gate
delays the first felt-pressure rating, which is the falsification test for the project's riskiest
assumption. Splitting "in v1" from "blocks round one" keeps the scope intact while letting the test
start running.

**Rejected:** all four as hard gates — the riskiest assumption would stay untested for the whole
build. **Rejected:** demoting company research to SHOULD.

---

### [2026-09-12] One generated follow-up per answer, in both modes, is a v1 MUST

**Decided:** Exactly one follow-up per submitted answer, generated from the corrected text, in
practice and realistic alike. Follow-ups are scored but **excluded from progress data**.

**Why:** IDEA.md §8 calls it the highest-value feature after the core loop, and it is the only
element of this design that *adds* pressure rather than subtracting it — which matters directly to
the riskiest assumption. Excluded from progress because a follow-up is generated from the user's own
answer and therefore has no stable question identity; it can never be a first attempt.

**Consequence:** a model call between turns inside a timed round, so the latency budget becomes a
hard requirement for Phase 4 rather than a nicety.

---

### [2026-09-12] Transcript correction is inline, with the diff stored and its magnitude shown

**Decided:** One inline editable field pre-filled with the raw transcript. Raw and corrected are both
stored permanently and the diff is computed every time. Realistic mode shows a rewrite-magnitude
figure before submit and stores it. **No block, no adjudication.**

**Why:** Nothing can decide what counts as "an obvious recognition error" versus "rewriting what I
said," so v1 measures the thing it cannot enforce. This is IDEA.md §4's own argument — if only the
corrected version survives, the record flatters the user — applied to the rewrite itself.

**Rejected:** word-level editing gated on recognizer confidence — genuinely enforces the rule, but
depends on an unverified speech-engine capability and blocks fixing confidently-wrong words.
**Rejected:** a hard edit-magnitude cap — the threshold is arbitrary and character-level magnitude
does not mean the same thing in Japanese as in English.

---

### [2026-09-12] Desktop only in v1

**Decided:** The full loop is desktop only. The app states this rather than degrading on a phone.

**Why:** Correcting a Japanese transcript on a phone keyboard would push the user toward accepting
recognition errors, which destroys the one feature no surveyed competitor has. Desktop also matches
the setting real interviews happen in, so it is fidelity as well as cost.

**Rejected:** responsive history screens — deferred until there is evidence of reviewing on the move.

---

### [2026-09-12] Realistic mode speaks the question aloud; practice mode is text only

**Decided:** Realistic mode speaks the question and leaves the text on screen. Practice mode displays
it silently.

**Why:** Hearing a question in Japanese is materially harder than reading it, so this is listening
fidelity, not only pressure. Leaving the text visible keeps **hiding the text after asking** in
reserve as an escalation if felt-pressure ratings come back at 1–2, per the brief's falsification
test.

**Rejected:** text-only everywhere (spends eight rounds discovering a known-missing feature may have
been the problem). **Rejected:** spoken in both modes (TTS cost and latency on every practice drill,
and it spends more of the reserve).

---

### [2026-09-12] Round length is chosen at the start — 3, 5 or 7 — and recorded

**Decided:** The user picks 3, 5 or 7 questions when starting a round. The chosen length and each
question's position within the round are stored with every answer.

**Why:** "Reps never happen" is a named secondary risk, and a fixed ~20-minute round turns a
ten-minute window into no practice at all. Recording length and position keeps fatigue and position
effects visible in the data instead of silently confounding the six-month trend.

**Rejected:** a fixed 4 every round. **Rejected:** fixed 4 with follow-ups as the optional
length control — that makes the hardest part the first thing switched off under time pressure.

---

### [2026-09-12] A sitting is exactly one round; the four-round run is LATER and unshaped

**Decided:** One round type, one language, one mode per sitting. The full four-round run is deferred
to LATER and is deliberately **not** pre-shaped into v1's data model.

**Why:** IDEA.md §3 already calls the four-round run a later feature. One round keeps the sitting
inside the window where round-end feedback still lands while the user is at the machine, and keeps
spacing meaningful — a four-round sitting exercises every round type on the same day, which collides
with the spacing requirement. The 30-day target then counts sittings rather than fragments.

**Rejected:** shaping v1's model around a later four-round run — speculative structure for a feature
with no committed date.

---

### [2026-09-12] Generated questions carry version stamps; progress is charted within round type

**Decided:** Every question records round type, language, a declared difficulty tier set at
generation, and the generator prompt version. The progress screen plots within round type × language,
and a generator or rubric version change draws a visible marker on the chart.

**Why:** Once generated questions feed the chart, nothing otherwise holds difficulty constant, and a
six-month trend could be measuring the generator rather than the user. Charting only the set pieces
was considered and is arithmetically dead: there are roughly 5–10 set pieces per language, so the
≥30 first-attempts-per-language criterion could never be met from them.

**Rejected:** freezing the generator for six months — guarantees comparability but forbids improving
question quality during the measurement window. **Rejected:** accepting drift with a UI caveat — makes
the 6-month criterion untrustworthy.

---

### [2026-09-12] Questions come from a hybrid bank: fixed set pieces plus persisted generated questions

**Decided:** The set pieces (自己紹介, 志望動機, 転職理由, 自己PR, 逆質問 and their English counterparts)
are hand-authored, fixed and identity-stable. Role-specific questions are generated from CV + role
context and written into the bank with a permanent ID on first use, deduplicated against existing
entries.

**Why:** IDEA.md §7's first-attempt measurement needs stable question identity, and §8 says the
Japanese set pieces have expected shapes that should not be regenerated. But §5 requires questions
about *this* role, which a fixed bank cannot produce. The hybrid contains difficulty drift to the
generated half, where the version stamping above can make it visible.

**Rejected:** a fixed authored bank only — cannot be role-specific, and the unseen pool is finite.
**Rejected:** pure generation — every question is trivially unseen, which sounds convenient but
leaves nothing holding difficulty constant.

---

### [2026-09-12] Riskiest assumption is pressure, not engagement

**Decided:** The project's riskiest assumption is that a turn-based, unobserved, self-paced simulation
with an editable transcript generates enough pressure to train what fails in real interviews.
Instrumented by a 1–5 felt-pressure self-report per realistic-mode round, collected before feedback.

**Why:** The core loop's defining features each subtract the variable the research says carries the
effect (Behroozi et al. FSE 2020: observed performance halved; Low et al. 2021 pressure-training
meta-analysis g = 0.67, CI [0.43, 1.12], concluding that pressurised environments beat added volume).

**Rejected:** "I won't do the reps" as the primary risk — downstream, since Google's free, login-free
Interview Warmup was retired anyway. **Rejected:** scorer drift as the primary risk — real, but has a
known mitigation (re-score held-out past answers), so it is a Phase 4 technical risk.

---

### [2026-09-12] Scores are integers 1–5 per dimension, with no composite score

**Decided:** Every rubric dimension is scored as an integer 1–5. **No overall or composite score is
ever computed or displayed.**

**Why:** A trend line needs an ordinal scale, so bands and labels are out — they can only be plotted by
secretly converting them to numbers at lower resolution. 1–5 rather than 1–10 because an LLM rater
will not use 7-vs-8 consistently across six months. The no-composite rule comes from Kluger & DeNisi
(1996): across 607 effect sizes and 23,663 observations, over a third of feedback interventions
*decreased* performance, with self-directed rather than task-directed attention as the mechanism. A
single "interview score" is a verdict on the person; per-dimension scores are statements about the
work.

**Rejected:** bands, labels, and any aggregate score. Note that the 1–5 granularity is a measurement
argument, not a research finding — the literature does not speak to scale resolution.

---

### [2026-09-12] Language is scored as two dimensions, not one

**Decided:** Split IDEA.md §6's single "Language and register" dimension into **fluency** and
**accuracy**, scored separately. 敬語 remains its own dimension in Japanese as IDEA.md §8 proposed.

**Why:** Task-repetition research in second-language acquisition (Bygate and successors) finds
repetition reliably improves fluency while effects on complexity and accuracy are mixed, with a
documented trade-off — gains in one bought at the cost of the other. Collapsed into one score, an
accuracy regression is masked by a fluency gain and the chart flattens for a reason that is not true.

---

### [2026-09-12] Feedback is withheld during a round and delivered within minutes of its end

**Decided:** No per-answer feedback during a realistic-mode round. Round-end feedback must appear while
the user is still at the machine. Asynchronous evaluation that lands later is a defect, not a
scheduling detail.

**Why:** IDEA.md §6's instinct survives, but not for the reason it gave. The retention literature
favours *immediate* feedback — a 2024 study of 177 EFL undergraduates found immediate feedback beat
delayed feedback for long-term retention, and both beat no feedback. The case for withholding is about
preserving the pressure condition during the round, not about retention. A round of roughly fifteen
minutes still counts as immediate by this literature's standards.

---

### [2026-09-12] Spacing is a v1 requirement

**Decided:** The app tracks when each round type and language was last practised and surfaces what is
due. Not deferred.

**Why:** Dunlosky et al. (2013) rated ten study techniques; only *practice testing* and *distributed
practice* earned "high utility." The core loop is practice testing. Nothing in IDEA.md schedules
anything, which leaves half the evidence base unimplemented and invites the six-rounds-in-a-weekend-
then-nothing pattern.

---

### [2026-09-12] Success at 6 months is an honest instrument, not an improved user

**Decided:** 30 days — core loop working plus 8 realistic-mode rounds, ≥3 per language. 6 months — a
per-dimension trend across first attempts at unseen questions, ≥30 first-attempt points per language,
and the user can name one dimension that rose and one that did not.

**Why:** Macnamara et al. (2014) found deliberate practice explained under 1% of performance variance
in professions, the weakest domain in their meta-analysis. Holding the app responsible for the
improvement curve sets it up to fail for reasons outside its control. The app controls whether the
measurement is trustworthy; that is what it is held to.

**Rejected:** "the chart goes up" as the 6-month criterion. **Rejected:** "it works and I use it" — not
falsifiable.

---

### [2026-09-12] Scale: serious side project

**Decided:** Serious side project. No interview is scheduled.

**Why:** IDEA.md §7 requires data that survives and accumulates over months, which a weekend hack
cannot deliver; §9 rules out the accounts, sharing and multi-user work that would make it a product.

---

### [2026-09-12] Out of scope gains "real-time assistance during an actual interview"

**Decided:** Added as out-of-scope item 7, alongside IDEA.md §9's original six. Interleaving round
types within a session added as item 8, deferred to LATER.

**Why:** The "interview copilot" category (Final Round AI and imitators) is adjacent enough that a
later session could drift toward it, and it is widely treated as cheating by employers. Naming it
prevents the drift. Interleaving is deferred because contextual-interference benefits are contested in
field settings and low interference suits less-skilled performers.

---

## Phase 2 — Design exploration

**19. Visual direction: B — Instrument.**
Cool near-white ground, IBM Plex Sans JP + IBM Plex Mono, hairline rules. Each rubric dimension
renders as a single marker on a fixed five-tick scale — a position, not a filled quantity — with the
numeral small and set to the side.

*Why:* the PRD's hardest constraint is that no composite score may exist anywhere, and that is a
constraint on what the eye can do, not only on what is computed. A marker on a scale cannot be
summed by glance. Secondly, the six-month success criterion is per-dimension trends over ≥30 first
attempts; a dot on a fixed scale generalises to the progress screen as a dot plot with no
reinvention, so the feedback screen and the progress screen are one visual idea rather than two.
Thirdly, the brief asks for a measurement instrument rather than a coach — Kluger and DeNisi (1996)
is the cited reason — and the instrument register points attention at the answer rather than at the
person.

*Rejected — A, Paper record* (cream, Shippori Mincho B1, filled squares on a printed form): the most
authority of the three and the only direction that natively honoured Japanese-first typography, but
filled-through squares read as quantity, so seven stacked rows invite the glance-sum the PRD forbids.
Its per-dimension prose reasons also introduced a parallel commentary stream the PRD does not have
(7 × 5 = 35 pointers per round against "two or three things to fix").

*Rejected as the system — C, Ledger* (dark, BIZ UDPGothic + Inconsolata, one 5×7 matrix): densest and
fastest to scan, but a matrix invites row-summing, and the sketch had to print 合計・平均は出しません
on screen — a layout admitting its own problem.

**20. C's matrix is kept for the History screen only.**
Reviewing a round from months ago, comparing across answers *is* the task, and the eye-summing risk
is materially lower once the user is not sitting in the aftermath of the round. Everything else uses
B's vocabulary.

**21. Remaining six screens: static by default, two clickable, one as a state series.**
Artboards on the design canvas share no runtime state, so a walk-the-flow click-through is not
buildable there at all; interactivity can only live inside a single screen. It is therefore spent
only where the design question *is* state: **transcript correction** (does the rewrite-magnitude
figure read as an accusation while editing?) and **felt-pressure rating** (does selecting 1–5 feel
like scoring yourself? — this is where the riskiest assumption is instrumented). **Question + record**
is built as a series of static frames — idle, recording with timer, transcript arrived — because
Phase 3 writes screen specifications and a state hidden behind a click is a state easily missed in
the spec. Round setup, Progress and History stay static.

**22. Open, deliberately not settled in Phase 2.**
Whether a short neutral justification sits beside each dimension score. Direction A had them and the
review flagged them as drift from "two or three things to fix"; that criticism is correct about the
praise-worded ones. But score provenance is how the scorer earns trust, and an honest instrument is
the actual six-month criterion. Decide in Phase 3 against the screen specifications.

**23. The realistic per-answer timer is 4 minutes.**
Shown on the record frames as 最長4分, with the take ending automatically at the cap and whatever was
captured kept.

*Why:* the number was forced by an artboard that already existed. `Main.dc.html`'s feedback screen
scores 第1問 at 3分12秒 and flags 長さ・配分 as 2 with the pointer 「2分以内に収める」. A cap at or
below 3 minutes would make that answer impossible; a cap far above it makes the timer decorative. 4
minutes lets the existing data stand and keeps 「2分以内」 a quality pointer rather than a limit the
app enforces. It also fixes the round-length estimate on Round setup: 5問＋深掘り5問 at 4 minutes is
最長 約40分.

*Open:* practice mode's hard recording cap (§7 requires one in both modes) is not drawn. Practice
mode has no timer, so the cap is a runaway-recording guard, not a design element — settle it in
Phase 3 or 4.

**24. History drops Direction C's 「合計・平均は出しません」 line.**
Decision 20 kept C's 5×7 matrix for History. The disclaimer that rode with it is not kept.

*Why:* decision 19 rejected C partly *because* it had to print that line — a layout admitting its own
problem. Carrying the sentence into B would import the flaw along with the matrix. If the matrix in
B's light vocabulary still invites row-summing, the honest fix is to change the layout, not to
caption it. Phase 3 should check this against the screen specification rather than assume it.

**25. The English column on Progress is drawn with 4 first attempts, not enough to trend.**
日本語 gets 8 first attempts within 行動面接 and a trend line; English gets 4 and bare dots.

*Why:* §6 makes "too few first attempts to trend" a requirement — no line below 5 for that dimension
× language × round type, and the screen says how many remain. A mockup where both columns are
comfortably populated would let that state ship undesigned. The counts against the ≥30 target
(日本語 12 / 30, English 9 / 30) are stated separately at the top, as US-13 requires.

**26. The trend mark is a least-squares line, not a line through every point.**
Each dimension row is a dot plot of first attempts with a single straight trend segment behind the
dots.

*Why:* connecting consecutive points draws attention to round-to-round noise, which is exactly the
reading the six-month criterion does not want. It is also the mark decision 19 already committed to
— the same dot on the same fixed scale as the feedback screen, generalised. Hover detail (date,
question number) is specified in the screen's own footer rather than drawn, because an artboard
cannot show a hover state and its resting state at once.

**27. The canvas is split into two pages; Main stops calling itself "Direction B".**
Page 1 is the screen set, page 2 is the three exploration directions with their notes.

*Why:* the direction is picked, so the comparison is a record rather than the working surface. The
direction label on `Main.dc.html` was exploration chrome and would have had to be repeated on eight
new artboards or omitted inconsistently. The rejected directions are kept, not deleted — decisions
19 and 20 both cite them, and decision 24 is a live question about C's matrix.

**28. The sample data across the artboards is one coherent record, not per-screen filler.**
A review pass found Home's "Due" column contradicting History on three of four rows, and the
transcript screens claiming a length their own text did not have. Both are fixed by making the
numbers reconcile rather than by softening them.

- History's rounds are dated so that the last realistic round of each pair lands exactly on Home's
  figures: 行動面接・日本語 2026-08-25 (18d), HR・English 2026-09-01 (11d), 技術面接・日本語
  2026-09-06 (6d). **No CEO・最終 round appears at all**, because Home shows it as 未実施 and US-14's
  never-practised-sorts-first detail depends on that staying true. The 未採点 and 中断 states moved
  onto HR and 行動面接 rounds old enough not to disturb the arithmetic.
- Home is the state *before* today's round; the feedback panel beside it is the state after. That
  reading is what makes 18d and a completed 2026-09-12 round consistent, and it is the better
  narrative: the thing that was most overdue is the thing that was just run.
- The raw transcript is 800 characters and the stamp is 3:12, so the rate is **約250字/分**, not 340.
  Main's 340 was invented before any transcript existed. 250字/分 is slow for spoken Japanese, which
  is the right reading for a hesitant answer full of えーと — and 第1問 has to stay over two minutes
  for its own pointer 「2分以内に収める」 to mean anything.

*Why this matters beyond tidiness:* Phase 3 writes screen specifications by reading these files. A
contradiction between two artboards becomes a contradiction between two specifications, and the
build inherits it.

**29. Progress carried the disclaimer decision 24 had just removed from History.**
Its footer read 「合計や平均はありません。」 — the same caption that disqualified Direction C.
Removed. The dot plot makes the argument; a screen that has to say it is a screen that has not.

**30. Version markers on Progress show 出題 as well as 評価基準 and 職務経歴書.**
US-13 requires a visible marker when the **generator prompt version** changes; the CV-version marker
is the §7 edge case and does not substitute for it. Three vertical rules now cross every plot, and
the legend names all three.

---

## Phase 3 — Extract

**31. Decision 22 settled: no ambient per-dimension justification.**
A score row carries a label, a five-tick scale, a dot and a numeral. No prose beside it. Provenance
comes from the round-level 直すところ list, and per row on demand — hover **or keyboard focus** —
reusing the tooltip already specified for Progress.

*Why:* seven dimensions × five answers is thirty-five strings of prose per round. That is the
parallel commentary stream decision 19 rejected Direction A for, and it would bury the three items
the user is meant to act on. The score that mattered in the sample round — 長さ・配分 at 2 — is
already explained by 直すところ item 1. The trailing empty flex cell in the score row is not spare
room waiting for text; it is what keeps seven rows readable as one column of dot positions.

*Cost, accepted:* the scorer earns trust more slowly for the dimensions that did not make the
round-level list. The brief asks for an honest instrument, and an instrument shows its reading before
its reasoning.

**32. Decision 24 settled: the History matrix needs no guard.**
Tested against the built matrix rather than assumed. Four measured properties already stop a row
reading as a total: the row ends with a duration and a play control where a sum would sit; the
duration is demoted one size step and three ink steps below the scores, so it cannot be misread as an
eighth value; every answer row is followed by a follow-up row a full ink level lighter, so the matrix
is never more than one uniform row deep; and the attention colour on 4 of 63 cells pulls the eye to
single positions, which is the opposite of summing. Direction C's matrix had none of these and had to
caption itself.

**33. The measured token set was larger than the design intends, and is collapsed in the spec.**
The artboards contain **16 ink levels and 8 rule weights**, against the expected five and three.
`05-design-system.md` defines 9 inks and 6 rules and lists exactly which measured values each one
absorbs, so the build produces a palette rather than a census.

*Why not just record all 16:* a specification that reproduces every grey an artboard happened to
contain is a transcription, not a system, and the next screen has no basis for choosing among them.

**34. Three off-scale type sizes are rounded to the scale.**
`11.5px`, `12.5px` and `13.5px` (19 uses, only in `History` and `FeltPressure`) build as **11, 13 and
13**. Nothing in either layout depends on the half-pixel.

**35. The mono stack's `IBM Plex Sans JP` fallback is load-bearing and must not be removed.**
Plex Mono has no CJK coverage, and Japanese is set in the mono role throughout — `第1問 / 5問`,
`未実施`, `評価基準 v1.2`, `3:12・約250字/分`. All 170 mono declarations carry the fallback; a future
tidy-up that drops it silently breaks every one of those strings.

**36. The transcript-rewrite figure is specified as an LCS character ratio.**
`round((1 − LCS(raw, edited) / max(|raw|, |edited|)) × 100)`, clamped 0–100, per the working artboard.
Recorded because a word-level diff or a plain edit-distance ratio yields visibly different numbers for
the same edit, and the figure is shown to the user at 34px.

**37. The review pass was re-run at the start of Phase 3 and found no regressions.**
Checked: all 20 `text-transform: uppercase` declarations are on Latin-only strings; the single
remaining Latin middle dot is inside an English sentence, where it is correct; the
`3:12・約250字/分・800字` triple is arithmetically consistent and the sample transcript is exactly 800
characters; Q1's scores agree across round feedback, Progress and History. The decision 28 coherence
holds.
