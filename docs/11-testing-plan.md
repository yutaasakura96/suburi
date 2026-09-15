# Testing plan — Suburi

**Date:** 2026-09-12
**Status:** Phase 4b. Tier 2, triggered: `01-project-brief.md` sets a **six-month** horizon, and the
success criterion is a trustworthy instrument — which is a claim about the code still being correct in
March, not about it working today.

---

## 1. What is actually at risk

The usual answer to "what must have tests" is money, auth and data deletion. Suburi has no money, one
auth path, and **no deletion at all** — so the list transfers badly. Here the irreplaceable thing is
**measurement**, and the failure that matters is not a crash. It is a silent one:

> The app keeps working, the charts keep drawing, and the numbers stop meaning what they claim to
> mean.

Four ways that happens, and every one of them is a test in §3:

1. **A first attempt gets overwritten**, so the chart shows a practised answer as a cold one.
2. **A score lands without its full stamp set**, so a boundary Progress should draw is invisible.
3. **A composite score appears** somewhere — a helper, a view, a response field — and the per-dimension
   discipline the brief is built on quietly collapses into one number.
4. **A CV quote is rendered from model output** instead of sliced from stored text, and the instrument
   cites a line that was never written.

None of these throws. All four are enforced by things a unit test with a mocked database cannot see —
Postgres constraints, partial unique indexes, the absence of a column. That is why §2 puts a real
database in the loop.

**A note on what tests are for here.** There is one developer and one user, and they are the same
person. Tests are not a handover artefact and not a coverage number; they are the only thing standing
between a refactor in month five and a chart that lies. Every test below earns its place by naming the
specific lie it prevents.

---

## 2. The stack

| Layer | Tool | Runs against |
| --- | --- | --- |
| Units | Vitest | pure functions, no I/O |
| Integration | Vitest | **a real Postgres 18 + `pgvector`** — Docker locally, a service container in CI |
| End-to-end | Playwright, Chromium | the built app, with S3 and OpenAI intercepted |
| Scoring quality | `scripts/rescore-held-out.ts` | the real model. **Not a test** — see §6 |

**Integration tests use a real database, not a mock.** The four headline invariants are a partial
unique index, two check constraints and a not-null set. Mocking Postgres would test the mock and leave
the guarantees unguarded — which is the exact failure mode this document exists to prevent. Each test
file runs inside a transaction that is rolled back, against a schema built by the same migrations
production runs.

**Chromium only.** Desktop-only in v1, stated by the app rather than degraded (decision log Phase 2).
Testing Firefox and WebKit would be testing a claim the product does not make. `MediaRecorder` output
format also differs across browsers, and only one is supported.

**No test ever calls OpenAI or S3.** Every model path goes through the port in `lib/ai/` with a fake;
S3 is intercepted at the network boundary in Playwright and faked at the port in integration tests.
Determinism is the point, but so is cost and so is the key.

---

## 3. Must be automated

Ordered by what each one prevents. **These are the tests that may not be deleted to make a refactor
pass** — if one becomes inconvenient, the invariant has changed and `04-database-schema.md` needs
amending first.

### 3.1 The four invariants, against real Postgres

| Test | Asserts | Prevents |
| --- | --- | --- |
| Second first attempt | Inserting a second `answers` row with `is_first_attempt` for the same `(question_id, language)` raises a unique violation | A practised answer charted as a cold one |
| Follow-up as first attempt | `is_first_attempt = true` with `question_id is null` raises a check violation | A follow-up entering progress data (PRD §2) |
| Retry does not overwrite | A retry writes a new row with `retry_of_answer_id` set; the original keeps `is_first_attempt`; both rows persist | Refusal #3 |
| Practice with a pressure rating | `mode = 'practice'` with a non-null `felt_pressure` raises a check violation | Corrupting the brief's falsification test |
| Pressure out of range | `felt_pressure = 0` or `6` raises a check violation | — |
| Stamp completeness | A `scoring_attempts` insert missing any of `cv_version_id`, `rubric_version_id`, `model_id`, `scoring_prompt_version` raises not-null | An unstamped score, invisible boundary (refusal #5) |
| Score range | `scores.value` outside 1–5 raises a check violation | — |
| One score per dimension | A duplicate `(scoring_attempt_id, dimension)` raises a unique violation | Two values for one dimension |
| Span sanity | `span_end <= span_start` raises a check violation | — |
| Answer is question XOR follow-up | Both set, or neither, raises a check violation | An answer with no provenance |
| Restrict, not cascade | Deleting a `questions` row that an answer references raises a foreign-key violation | Rewriting history by deleting a bank row |
| Enumerated values | A value outside its list (`04` §0) in any enumerated `text` column raises a check violation | A misspelt `language` splitting one first-attempt series into two |

### 3.2 No composite score — asserted three ways

Refusal #1 is the one invariant with no single constraint behind it, because it is an **absence**. So
it is tested as an absence, in the three places it could reappear:

1. **Schema:** no column on any table whose name matches `/total|average|avg|overall|composite|sum|score_sum/`, and no view or materialised view in the schema at all. Queried from `information_schema` against the live test database.
2. **Application code:** a source-level assertion that no aggregate (`sum`, `avg`, `count(*)` over `value`) is applied to `scores.value` anywhere in `db/`, `lib/` or `app/`. Grep-shaped and deliberately blunt — a false positive is a conversation, which is the correct outcome.
3. **API:** every response in `07-api-design.md` §5 is schema-validated in the E2E pass; a new field named like a composite fails the contract.

**If a future session wants "just a quick overall", all three fail.** That is the design: the cost of
adding one is editing `04`, `07` and this document, in that order, on purpose.

### 3.3 The CV span-slicing validator

The anti-hallucination mechanism (`03` §11, `04`). The most load-bearing pure function in the codebase.

- A quote is `substring(body, span_start, span_end - span_start)` — never model text.
- A span outside `[0, length(body))` → citation **dropped**, not clamped, not stored.
- A span whose sliced text does not match what the extractor claimed → **dropped**.
- Inverted, zero-width, and off-by-one-at-the-end spans → dropped.
- **Multibyte:** spans are character indices into Japanese text. A span that would split a surrogate pair or land mid-grapheme is a test case, not a hypothetical — `請求処理を40%短縮` is 9 characters and 27 UTF-8 bytes, and confusing the two silently shifts every quote in the document.
- A valid span round-trips byte-identically.

### 3.4 First-attempt computation

The index is the backstop; this is the logic that should never reach it.

- Realistic + bank question + never answered → `true`.
- Practice mode, any question → `false`, always.
- Follow-up → `false`, always (and structurally impossible).
- Second realistic round asking the same question → `false`.
- Same question, **other language** → `true`. Two languages are two measurements.
- A retry of a first attempt → `false` on the retry, `true` still on the original.

### 3.5 Progress excludes pending and failed

`03` §5 and `04`: **excluded from trend lines, not treated as zero.** A zero is a score of "terrible";
an exclusion is "no measurement". Fixtures: a first-attempt set where one attempt is `pending`, one is
`failed`, and one has *two* attempts where the superseding one is `ok`.

- Pending and failed contribute nothing to any trend point.
- The trend point uses the **latest `is_superseding` attempt**, not the first and not an average across attempts.
- A held-out re-score (`is_superseding = false`) **never** appears in a trend.
- A dimension present in the `ja` rubric and absent in `en` (`keigo`) does not produce a null point in an English trend — it produces no point.

### 3.6 Boundary lines on Progress

Refusal #5. Given a fixture where `model_id` changes mid-series, then `rubric_version_id`, then
`scoring_prompt_version`, then `cv_version_id`: a boundary is drawn at each of the four, and **no
trend line is drawn across a boundary as if continuous.**

### 3.7 The near-duplicate guard

With a stubbed embedder returning fixed vectors, so the test is about the decision rule, not the model.

- Distance above threshold → the existing question row is **reused**; no insert.
- Below → insert, with its embedding stored.
- Candidate slice is `(user_id, language, round_type) where retired_at is null` — a near-identical question in another language or round type does **not** suppress the insert.
- A retired question does not suppress an insert but **keeps** every answer that referenced it.
- Every near-miss is logged with its score (that log is how the threshold gets tuned; a test that it is written is a test that tuning is possible).

### 3.8 CV carry-forward

`04`'s exact-match rule, and the absence of anything cleverer.

- Byte-identical `text_normalised` in the immediately previous version → `supersedes_claim_id` set, coverage inherited through the chain.
- Whitespace-only difference → normalises to identical → carries forward.
- One character different → **new claim, empty coverage.** No fuzzy match, no threshold.
- A match two versions back, absent from the immediately previous one → does **not** carry forward.
- Coverage inheritance follows a chain of three versions correctly.

### 3.9 Derived measures

`rewrite_magnitude` (identical text → 0; total rewrite → 1; monotonic in edit distance; stable under
pure whitespace changes) and `words_per_minute` (counted on Japanese text without spaces — a real
tokenisation decision, so the expected values in the test are the specification).

### 3.10 API contract and error catalogue

- Every endpoint in `07` §5: response validated against its schema; `401` with no session; `404` — **not `403`** — for another user's row; unknown query parameter → `400`.
- **Every code in `07` §3 has copy in both `ja` and `en`, and no copy key exists without a code.** Both directions. A `502` with no Japanese sentence is `03` §8's generic-error rule broken in production.
- **No error response body contains anything on `03` §8's never-log list.** Asserted by forcing each failure with recognisable sentinel text in the transcript, CV and notes, then scanning every envelope and every log line for it. This is the one test that guards the privacy posture directly.

### 3.11 Session scoping

Two seeded users in the test database — the only place a second user ever exists — asserting that
every read and every write is scoped by `user_id`, and that `disableSignUp` plus the `ALLOWED_EMAIL`
assertion both independently reject a non-allowlisted account (`08` §2: the guarantee does not rest on
one library flag).

---

## 4. End-to-end, in Playwright

Chromium, fake media device, S3 PUT and OpenAI intercepted. What this pass exists to catch is the
wiring between screens that no unit test sees.

| Flow | Asserts |
| --- | --- |
| Route protection | Unauthenticated `/progress`, `/history`, `/cv`, `/round/*` → `/sign-in`. **`/api/*` → `401` with no redirect** (`08` §5). |
| A route added later | Every path in the App Router is either in the public list or redirects. Fails when someone adds a page the proxy's matcher misses — the exact hole `08` §5 warns about. |
| Round setup | The four stamps are displayed before 開始; a failing model preflight disables 開始 and says why, with **no option to start anyway**. |
| The cap fires | Fake device, realistic mode: recording stops at 240s and **the take is retained** — screen 4 promises `4分で自動的に止まります。そこまでの録音は残ります。` |
| The runaway guard fires | Practice mode: at 15 minutes it behaves exactly like the cap, take kept, **and it is not rendered as a timer** (`03` §7 — not shown as pressure, not part of practice's rhythm). |
| Upload failure | Intercepted S3 PUT fails → "held on this device", retry offered, tab-close warning present, blob still in IndexedDB after a reload. |
| Transcription failure | Take kept; both retry **and** the typing fallback are reachable. |
| Transcript editor | The rewrite-magnitude meter moves with edits and its submitted value matches what the server stores. |
| Screen 7 is not skippable | Realistic mode offers no way past the felt-pressure rating to feedback. **This screen is load-bearing for latency** (`03` §3) as well as for the brief's falsification test — a future "skip" link is a regression in two places at once. |
| Pending score renders | The feedback screen states a pending score plainly and **does not spin** (`03` §5, §8). |
| Resume | Reload mid-round returns to the right question, with earlier answers intact. |
| No deletion surface | No delete or share control on History, a round, an answer or a score (refusals #3, #6). |

**Not in Playwright, deliberately:** any assertion about transcript *content*. The fake device
produces a synthetic tone, so a transcript assertion would be asserting on the stub. Real speech is
§5.

---

## 5. Manual, with a written checklist

Kept in `docs/checklists/` and run before anything is called done. These are the things that are
either irreducibly human or need a real human ear.

**Per release:**

- [ ] Real mic, real Chrome, real 4-minute take: audio uploads, transcribes, and plays back from History.
- [ ] Japanese transcription is good enough to correct rather than retype — on **spoken keigo**, which is the hardest case and the one the rubric scores.
- [ ] Realistic mode's TTS pronounces the question correctly, including company names and 役職.
- [ ] The felt-pressure screen still feels unhurried. It is instrumentation and it is where the last score lands; if it starts feeling like a loading screen, both purposes are damaged.
- [ ] Feedback renders **while you are still sitting there.** PRD §9 calls a spinner that outlives the sitting a defect — this is the acceptance test for that sentence, and no automated test can make it.
- [ ] Every new Japanese string has had a **native read** (`05-design-system.md` §6). Not a review of the translation — a read for whether a person would write it.

**Per CV upload:**

- [ ] Claims on a **real** CV: eyeball extraction quality, and check `spans_rejected` is zero. Explicitly unmeasured (`CONTEXT.md`) — this checkbox is where it first gets measured.
- [ ] Every rendered quote is genuinely in the CV. Sample five.

**Per stamp change** — model, rubric, prompt or CV version:

- [ ] Run `scripts/rescore-held-out.ts` and read the drift table **before** trusting the next chart.
- [ ] Confirm Progress drew a boundary at the change.

---

## 6. Scoring quality is a harness, not a test

`lib/ai/score.ts` is a port with one implementation specifically so the scoring call is not inlined at
its call sites (`03` §10). Tests use `FakeScorer`:

- fixed valid rubric output → the happy path,
- **malformed output** → `error_class` recorded, model output **not** recorded (`03` §8),
- **a refusal** → same handling as a failure, no special case,
- a span outside the CV body → the citation is dropped, not rendered,
- a missing dimension, an extra dimension, a `value` of `6` → rejected before any row is written,
- a slow response → retries three times with backoff, then `failed`.

Real scoring quality is measured by **`scripts/rescore-held-out.ts`**, which re-scores the held-out set
against the live model and prints a per-dimension drift table against the baseline. It writes
`held_out_rescores` rows with `is_superseding = false`, so a re-score **never** becomes a displayed
score (`04`).

**It is a script and not a CI test, on purpose.** Its output is a judgement about whether the
instrument still reads true — drift of 0.3 on one dimension might be fine or might be the whole
project failing, and that call needs a person looking at which dimension moved and in which
direction. A red/green assertion would either be so loose it never fires or so tight it fires on
noise, and either way it would launder the judgement it exists to inform. It is run when any of the
four stamps changes, and the manual checklist in §5 is what makes that non-optional.

---

## 7. CI

GitHub Actions, on every push and every pull request:

1. `tsc --noEmit`
2. `eslint`
3. `vitest run` — units
4. `vitest run --project=integration` — against a `pgvector/pgvector:pg18` service container, schema built by the real migrations
5. `playwright test` — Chromium, against a production build
6. `npm audit --audit-level=high`

Dependabot weekly (`03` §9). Better Auth, Drizzle and the OpenAI SDK are **not** auto-merged: they are
pinned and upgraded deliberately, and the OpenAI SDK sits on the scoring path.

**Green CI is required to deploy** (`12-deployment.md` §4), and migrations are run by hand *before* the
push that deploys — so CI runs against the schema production is about to have, not the one it had.

**No coverage threshold.** The target is the list in §3, not a percentage. A coverage number would be
satisfiable by testing the easy half of the codebase, and the four things that matter here are worth
more than every other test combined.

---

## 8. Test data — one hard rule

**The real CV, real transcripts, real company notes and real salary expectations never appear in a
fixture, a seed, a snapshot or a CI log.** Every fixture is synthetic: an invented CV in both
languages, invented postings, invented answers. This is the same rule as `03` §8 and `12` §7 — the
sensitive material has exactly two homes, and a checked-in fixture would be a third, in a public
repository, forever.

Set-piece questions **are** real seed data and are checked in — they are the bank, not user data.

---

## 9. Deliberately untested in v1

Each of these is a decision, with what would change it.

| Not tested | Why that is acceptable | Revisit when |
| --- | --- | --- |
| **Scoring quality as pass/fail** | §6 — it is a judgement, and automating it would launder the judgement. | Never as a CI gate. Possibly as a tracked metric once there are enough held-out rounds to know what noise looks like. |
| **TTS output** | Nothing to assert programmatically beyond "audio was produced"; the thing that matters is whether 役職 is pronounced correctly, and that is an ear. | — |
| **Real transcription accuracy** | Depends on a model whose exact id is still unconfirmed (`03` §4), and the correction step exists precisely because transcription is imperfect. | The transcription model is pinned, then measure word error rate on a fixed set of real takes. |
| **Mobile and other browsers** | Desktop-only, stated by the app, no breakpoints (decision log Phase 2). Testing it would test a claim not being made. | Mobile is ever in scope. |
| **Load and performance** | One user, eight rounds a month. The only latency that matters is feedback rendering while the user is there, and that is §5's checklist item. | A second user exists. |
| **Multi-user isolation beyond query scoping** | §3.11 covers scoping, which is the part that is free to test now. Invite flows, roles and sharing do not exist and must not (`08` §7, refusal #6). | Tenancy activates — and then `08` §7's step 3 comes first. |
| **Accessibility beyond keyboard reachability and contrast** | One known user, desktop, with the design system's contrast already fixed in `05`. | Anyone else uses it. |
| **Backup restoration** | Untested until `12` §8 is exercised. **This is the weakest link in this document** — an untested restore is a hope. | Immediately after the first production deploy: restore into a Neon branch and check a round reads back whole. |

---

## 10. The one test that would have caught each past mistake

There are no past mistakes yet — the repo has no commits. This section exists so that when there is
one, it lands here with the test that now prevents it. **A bug in any of §1's four silent failures gets
a test before it gets a fix.**
