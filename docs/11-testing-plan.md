# Testing plan — Suburi

**Date:** 2026-09-12
**Status:** Phase 4b. Tier 2, triggered: `01-project-brief.md` sets a **six-month** horizon, and the
success criterion is a trustworthy instrument — which is a claim about the code still being correct in
March, not about it working today. **Amended 2026-09-27 for the round loop** (`06`, "Phase 6 — the
round loop"): §3.1, §3.4–§3.7, §3.9, §3.12–§3.15, §4, §5. **Amended 2026-10-04 for the failure paths
(#48):** §3.5, §3.16, §4.

---

## 1. What is actually at risk

The usual answer to "what must have tests" is money, auth and data deletion. Suburi has no money, one
auth path, and **no deletion at all** — so the list transfers badly. Here the irreplaceable thing is
**measurement**, and the failure that matters is not a crash. It is a silent one:

> The app keeps working, the charts keep drawing, and the numbers stop meaning what they claim to
> mean.

Five ways that happens, and every one of them is a test in §3:

1. **A first attempt gets overwritten — or a practised question is counted as one** — so the chart
   shows a practised answer as a cold one.
2. **A score lands without its full stamp set**, so a boundary Progress should draw is invisible.
3. **A composite score appears** somewhere — a helper, a view, a response field — and the per-dimension
   discipline the brief is built on quietly collapses into one number.
4. **A CV quote is rendered from model output** instead of sliced from stored text, and the instrument
   cites a line that was never written.
5. **A CV is read badly and every counter says it is fine**, so Coverage is computed over a set that
   omits the applicant's best material and is padded with lines no answer will cite. Found for real in
   [#27](https://github.com/yutaasakura96/suburi/issues/27): `spans_rejected` was **0** on a reading
   that skipped 27% of the English CV and cut sentences into uncitable fragments. Found again in
   [#29](https://github.com/yutaasakura96/suburi/issues/29), after #27's fix: the same late block came
   back as paragraph-sized lumps that every counter read as clean. That one is prevented by windowed
   extraction rather than counted, so its tests are the windowing's (§3.3).

None of these throws. The first four are enforced by things a unit test with a mocked database cannot see —
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
S3 is intercepted at the network boundary in Playwright — `e2e/mock-s3.ts`, reached through a
localhost-only `S3_ENDPOINT` (`06`, 2026-10-01) — and faked at the port in integration tests.
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
| Stamp completeness | A `scoring_attempts` insert missing any of `cv_version_id`, `rubric_version_id`, `generator_prompt_version`, `model_id`, `scoring_prompt_version` raises not-null. *Amended 2026-09-27:* `generator_prompt_version` — stamp 3 — was missing from this list (`06`) | An unstamped score, invisible boundary (refusal #5) |
| Score range | `scores.value` outside 1–5 raises a check violation | — |
| One score per dimension | A duplicate `(scoring_attempt_id, dimension)` raises a unique violation | Two values for one dimension |
| Span sanity | `span_end <= span_start` raises a check violation | — |
| Answer is question XOR follow-up | Both set, or neither, raises a check violation | An answer with no provenance |
| Restrict, not cascade | Deleting a `questions` row that an answer references raises a foreign-key violation | Rewriting history by deleting a bank row |
| Enumerated values | A value outside its list (`04` §0) in any enumerated `text` column raises a check violation | A misspelt `language` splitting one first-attempt series into two |
| A round's questions are fixed | A second `round_questions` row at the same `(round_id, position)`, or the same question twice in one round, raises a unique violation | A refresh swapping a question already heard; a repeat inside a round |
| One follow-up per answer | A second `follow_ups` row for one `parent_answer_id` raises a unique violation; `generated` with a null `prompt_text`, or `missing` with one, or `generated` with an `error_class`, raises a check violation; a row without `model_id` or `prompt_version` raises not-null; deleting its parent answer raises a restrict violation | A second follow-up; a hole that is not recorded as one |
| Flag span sanity | `answer_flags.span_end <= span_start` raises a check violation | — |
| A flag keeps its attempt | Deleting a `scoring_attempts` row that an `answer_flags` row names raises a foreign-key violation | A flag with nothing saying which scorer raised it |
| Language only on an `ok` attempt | `answered_language` set on a `pending` or `failed` attempt raises a check violation | A wrong-language exclusion resting on a call that never finished |
| One model answer per answer | A second `model_answers` row for one `answer_id` raises a unique violation; a row without its `body`, `model_id` or `prompt_version` raises not-null; deleting an answer that has one raises a foreign-key violation | A model answer re-rolled after the round, or one that cannot say what wrote it |
| One General practice | A second `role_contexts` row with `kind = 'general'` for one user raises a unique violation | General practice split across rows, and its rounds grouped as two |

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
- **Multibyte:** spans are character indices into Japanese text. A span that would split a surrogate pair or land mid-grapheme is a test case, not a hypothetical — `請求処理を40%短縮` is 10 characters and 24 UTF-8 bytes (corrected from 9 and 27 in #14), and confusing the two silently shifts every quote in the document.
- A valid span round-trips byte-identically.

**The validator is not a quality check, and §1's fifth failure is why** (#27). It answers one
question — is this quote really in the stored text — and a reading can pass it completely while being
useless. `lib/cv/reading.ts` answers the other question, and its tests are the ones that may not be
deleted:

- A sentence cut at a 連用形 or a participial hinge counts **both halves** in `claims_split`.
- Two claims on **consecutive lines** — a 学歴・職歴 table, a bullet list — count **zero**.
- Two **finished sentences sharing one line** count zero. A `.docx` paragraph is one line, so without
  this the counter calls every well-read 職務要約 a fragment.
- **Overlapping spans** count, whatever punctuation surrounds them: one assertion read twice.
- The same normalised text twice in one version is **one claim**, and the drop is counted.
- `unclaimed_run_max` is measured **per document**, never across the join, and in code points.

**Windowed extraction** (#29, `lib/cv/windows.ts`, `lib/cv/windowed-extraction.ts`,
`lib/cv/surviving-claims.ts`). The fan-out is where a save could half-happen, so these are the tests
that hold it to all-or-nothing:

- One document's windows cover it **exactly**, end to end, and **no window crosses a document**.
- Windows are cut at **blank lines only** and **never inside a paragraph**; a paragraph over the
  target, line-wrapped or not, is a window of its own.
- Every call is sent the **whole set**; the calls run in parallel.
- **One window failing fails the save and writes nothing**, even when every other window came back
  (integration, against Postgres).
- A transient failure is retried **once**, only if enough of the deadline is left; a 4xx the same
  request would get again is not retried.
- A quote outside its window — another document, another window, across the edge — is **dropped and
  counted** in `quotes_outside_window`, never kept; a quote not in the text at all is still
  `spans_rejected`.

### 3.4 First-attempt computation

The index is the backstop; this is the logic that should never reach it.

- Realistic + bank question + never answered → `true`.
- Practice mode, any question → `false`, always.
- Follow-up → `false`, always (and structurally impossible).
- Second realistic round asking the same question → `false`.
- **Answered in practice first, then asked in a realistic round → `false`** (`06`, 2026-09-27). This
  is §1's first failure, and the case the old rule got wrong.
- **Answered in an abandoned round, then asked again → `false`.** The question is seen for good.
- **Fixed in an abandoned round's `round_questions` but never answered → still unseen**, and its first
  realistic answer is `true`. Choosing a question does not consume it.
- **A failed or denied recording writes no row** — the slot opens only once a take exists — so the
  question's next realistic answer is `true`.
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
- **An answer whose `answered_language` is not its round's language contributes nothing** to that language's trend (PRD §7).
- **An abandoned round contributes nothing**, though its answers keep their rows and their first-attempt flags.
- **A typed answer contributes nothing** (PRD §7): `transcript_raw` set with `transcriber_model_id` null (`07` §5.8). #48 writes the mark and asserts it is stored with no pace and no duration; the exclusion itself is Progress's test (#51).

### 3.6 Boundary lines on Progress

Refusal #5. Given a fixture where `model_id` changes mid-series, then `rubric_version_id`, then
`scoring_prompt_version`, then `cv_version_id`, then **`generator_prompt_version`** — including a set
piece's content version: a boundary is drawn at each, and **no trend line is drawn across a boundary as
if continuous.** *Amended 2026-09-27:* the generator stamp was missing from this list (`06`).

### 3.7 The near-duplicate guard

With a stubbed embedder returning fixed vectors, so the test is about the decision rule, not the model.

- Similarity at or above the threshold → the existing question row is **reused**; no insert. The threshold is one constant, **0.90 to start** (`06`, 2026-09-27); the test reads the constant rather than repeating the number, so tuning it changes no test.
- Below → insert, with its embedding stored.
- Candidate slice is `(user_id, language, round_type) where retired_at is null` — a near-identical question in another language or round type does **not** suppress the insert.
- A retired question does not suppress an insert but **keeps** every answer that referenced it.
- Every near-miss is stored with its score (`04`); test that the record persists so the threshold can be tuned from the weekly digest.

### 3.8 CV carry-forward

`04`'s exact-match rule, and the absence of anything cleverer.

- Byte-identical `text_normalised` in the immediately previous version → `supersedes_claim_id` set, coverage inherited through the chain.
- Whitespace-only difference → normalises to identical → carries forward.
- Full-width-only difference (`４０％`/`40%`, `（AT限定）`/`(AT限定)`) → `NFKC` makes it identical → carries forward; `validate` still refuses the same quote one full-width character off (#28).
- `0004_claim-text-nfkc` rewrites every stored `text_normalised` to what `normaliseClaimText` returns, touches nothing else, and a version saved after it carries forward from one saved before it.
- One character different → **new claim, empty coverage.** No fuzzy match, no threshold.
- A match two versions back, absent from the immediately previous one → does **not** carry forward.
- Coverage inheritance follows a chain of three versions correctly.
- A claim moved from one document to another between versions → carries forward (`04`: from any document).
- Two previous claims with one `text_normalised` → the new claim points at the lower `span_start`; two new claims with one text both point at it.
- `cv_unchanged` is refused before any model call, and again inside the write when an identical save committed in between.
- Two saves in one language on two connections are serialised: the second waits for the first's lock, becomes `v{n+1}`, carries forward from it, and is dated after it.

### 3.9 Derived measures

`rewrite_magnitude` (identical text → 0; total rewrite → 1; monotonic in edit distance; stable under
pure whitespace changes) and `words_per_minute`, which is **the pace in the language's own unit**:
characters per minute of `transcript_raw` for `ja`, words per minute for `en` (`06`, 2026-09-27,
confirm 4). The expected values in the test are the specification — `10` §5's `3:12・約250字/分・800字`
is one of them: 800 characters in 192 seconds is 250 per minute.

### 3.10 API contract and error catalogue

- Every endpoint in `07` §5: response validated against its schema; `401` with no session; `404` — **not `403`** — for another user's row; unknown query parameter → `400`.
- **Every code in `07` §3 has copy in both `ja` and `en`, and no copy key exists without a code.** Both directions. A `502` with no Japanese sentence is `03` §8's generic-error rule broken in production.
- **No error response body contains anything on `03` §8's never-log list.** Asserted by forcing each failure with recognisable sentinel text in the transcript, CV and notes, then scanning every envelope and every log line for it. This is the one test that guards the privacy posture directly.
- **No Sentry event contains those sentinels.** `lib/sentry.test.ts` sends a request carrying them through the real SDK, triggers an exception during handling, and checks the captured event. `lib/sentry.defaults.test.ts` confirms the SDK's default configuration would have included the request-body sentinel. The deployed `develop` check is in `12` §3 step 11.

### 3.11 Session scoping

Two seeded users in the test database — the only place a second user ever exists — asserting that
every read and every write is scoped by `user_id`, and that `disableSignUp` plus the `ALLOWED_EMAIL`
assertion both independently reject a non-allowlisted account (`08` §2: the guarantee does not rest on
one library flag).

### 3.12 The answer-side span validator

`answer_flags` (`04`) gets `§3.3`'s rules on the other text. The scorer returns a verbatim quote and a
start hint; the server locates it in `transcript_corrected`.

- The rendered quote is `substring(transcript_corrected, span_start, span_end - span_start)` — never model text.
- A quote not in the corrected text, a span outside it, an inverted or zero-width one, or one that splits a grapheme → **dropped and counted**, never clamped.
- A quote that occurs only in `transcript_raw` → dropped. The flag is about what the user submitted.

- The start hint chooses between occurrences and **never clamps**: a hint past the end, or on the wrong occurrence, still finds the quote or drops it.
- Two quotes that locate to one span are **one flag**.
- A failed attempt stores **no citation, no flag and no `answered_language`**; an `ok` one stores all three with its scores, in one transaction.

**Citations** (`claim_citations`, `07` §5.10). The scorer is shown numbered claims and returns numbers:

- The scorer is sent the CV version's claims **sliced from the stored body in span order** — never `text_normalised`, never model text.
- A stored claim whose span no longer validates, or whose slice no longer normalises to `text_normalised`, is **not shown**, so it cannot be cited; it is counted as `claims_rejected`.
- A number that names no shown claim — zero, past the end, not an integer — is **dropped and counted**.
- The same claim and relation twice is one row; `supported_by` and `contradicted_by` survive as the scorer gave them.

**Untouched material** (`round_feedback.untouched_claim_ids`): an id that is not a claim of the round's
CV version, or that some answer in the round cited, is **dropped and counted**; never more than three
are stored.

- The feedback call is sent **only** the round's never-cited claims; a claim cited with **either** relation is not among them.
- It is sent each answer's unsupported quotes **by stored span**, and only the latest `ok` attempt's.
- A pick that names nothing it was shown is dropped and counted; a repeat is ignored; a fourth is dropped. **Feedback whose picks are all invented is still written**, with none.

**What is counted is in the log line and nothing else is**: `scoring_ok` and `round_feedback_written`
carry the counts, and an integration test asserts the answer's text and the sentinel never reach a log
line.

**Screen 8's grounding view** (`10` §8), from stored rows: the quotes are slices by span, a
wrong-language answer is named and one in the round's language is not, and a round whose attempts
carry no `answered_language` has **no grounding region**.

**Coverage on `/cv`** (`10` §13, `lib/cv/coverage.ts`), against Postgres: a citation of a v1 claim
reads as used on its v3 descendant; **a citation of a later version does not reach back**; a forked
lineage inherits on both branches; `contradicted_by` counts as used; a reworded claim starts unused.

### 3.13 A round's questions, chosen once

With a stubbed generator and embedder.

- `POST /api/rounds` writes exactly `length` `round_questions` rows in the round's transaction; a failure before it writes neither.
- **A reload returns the same prompt at every position**, and never calls the generator.
- At most **one set piece**, and only an **unseen** one, of the round's own type; `behavioural` and `technical` rounds get none.
- Unseen generated questions come before seen ones; new ones are generated only when the unseen pool cannot fill the round.
- **Practice prefers seen questions**, and falls back to unseen ones.
- No `cv_version_id` in the request is accepted — a strict schema makes it a `400` — and the round is stamped with the current version.

### 3.14 `complete` with a score still pending

`07` §5.12, invariant 2. With a fake scorer that can be held pending and a fake feedback generator.

- **The rating and `completed_at` are committed before the feedback call is made** — a feedback failure leaves both written.
- A score that lands inside the bound → the feedback is generated from every score.
- A score still pending when the bound runs out → **no `round_feedback` row**, `502 feedback_generation_failed`, the round complete. Feedback from an incomplete set is never written.
- No model call is made inside a transaction.
- The retry (`07` §5.16) writes the row once; a second retry returns it and calls nothing.
- **A score that ended `failed`** → the feedback is generated without that answer; retrying the answer's
  score later writes a new attempt and **never touches `round_feedback`**.
- **That answer never reaches the generator** — its transcript is absent from the feedback call.
- **Every answer's score ended `failed`** → `502 feedback_generation_failed` with `no_scores`, no model
  call, and screen 8 states the findings are unavailable without offering a retry.

### 3.15 The derived round status

- A newer round started → the older open round is `abandoned`, and `resume` is null.
- The newest open round, started today → `in_progress`, and resumable.
- An open round started on an earlier day → `abandoned`. **The day is Asia/Tokyo's**: a round started at
  23:50 JST is abandoned at 00:10 JST the next day, whatever the server's time zone (`06`, 2026-09-28).
- A realistic round's `GET /api/rounds/{id}` carries **no score, flag or scores field** until it is complete; a practice round's carries them once each answer is `ok` (US-8, `07` §5.5).

### 3.16 `write_failed` on every round route

- A database failure forced on each round route returns `500 write_failed` in the `07` §2 envelope,
  never a bare `500`, with only ids and `pg_<SQLSTATE>` in `detail` — no sentinel text (§3.10).
- Nothing the call would have written exists afterwards, and `GET /api/rounds/{id}` resumes at the
  same call.
- **As built (#48), `lib/round/failure-paths.integration.test.ts`:** each route it walks is run with
  its first database call failing, then its second, and so on until a run gets through — so every call
  a handler makes has been the one that failed, the limiter's upsert and the reads between two writes
  included. The injected error carries sentinel text in its message, and the envelope and every log
  line are scanned for it. A session read that throws is asserted separately on `GET /api/rounds/{id}`,
  `POST …/answers`, `GET …/speech` and `POST …/model-answers`: it is the envelope too, with
  `error_class: unexpected`.
- **The routes that walk covers are ten:** `POST /api/role-contexts`, `POST /api/rounds`,
  `GET /api/rounds/{id}`, `GET …/speech`, `POST …/answers`, `POST …/transcribe`, `POST …/transcript`,
  `POST …/submit`, `POST …/complete` and `POST …/feedback`. The four History routes — `GET /api/rounds`,
  `GET /api/answers/{id}/audio`, `POST /api/scoring-attempts` and `POST /api/scoring-attempts/{id}/run`
  — carry the same guard and are in neither this walk nor the sentinel walk below; their guard is
  covered only by the thrown session read §3.20 records. #74's `POST …/model-answers` carries it too,
  and is in neither walk: its guard is covered only by the thrown session read above.
- **`complete` is the one route whose write can land before a later call fails.** Until
  `completed_at` commits a failure is `write_failed`; after it, the call answers `201` with
  `feedback: null`, the same call again answers `200` with that completed result, and the feedback
  route writes what was pending (`07` §5.12). A call that failed in #74's model answers instead leaves
  the feedback whole and none of them written, for their own route (`07` §5.19).
- **§3.10's sentinel test, on the nine of those ten routes that follow `POST /api/role-contexts`:**
  one test forces the refusals they give a signed-in caller — invalid bodies, missing rows, an
  abandoned and a completed round, each `422`, the upstream failures and a failed preflight — with
  sentinels in the transcripts, the typed answer and the follow-up, and scans every envelope and log
  line for them and for every claim of the CV. A posting's text is #47's own test
  (`generated-questions.integration.test.ts`).
- **A spent OpenAI project:** `429 project_spend_limit_exceeded` classes as itself, is not retryable,
  refuses the round as `503 model_unavailable` — met by the preflight, or by question generation
  after the preflight passed — and fails a mid-round score after one call, not three.

### 3.17 The monitoring jobs (#55)

The one failure `12` §6 exists to prevent is a check that reads "all clear" when it is not, so each
row is tested firing as well as quiet.

- **Every `12` §6 threshold is a named constant with a unit test at, below and above it** — the two
  24-hour ages, the 48-hour staleness, `unclaimed_run_max`'s 2,000, the spend threshold's 3× baseline ×
  max(1, rounds), and zero for every "any" row.
- **Against the real database:** seeded rows that trip each of the ten `self-check` signals appear red
  on the next run, with the tripping rows' ids; a healthy fixture yields none red; a CV version with
  null counters is no reading, not zero; the Asia/Tokyo week boundary puts a token row on the right
  side; `digest` reports the ended week's rounds, tokens and spend.
- **A request without `CRON_SECRET` writes nothing** — no header, a wrong one, and an unset secret
  each return `401` and leave `cron_runs` as it was.
- **Runs are appended:** a second run is a new row, and the first run's readings are unchanged.
- **§3.10's sentinel test, for the run and the page:** with sentinel text in a CV body, a transcript,
  a question and round feedback, neither a stored run's rows nor the rendered status page nor the
  route's response and log lines contain it.
- **Playwright:** an authenticated call to each route writes a run the status page then shows, and
  Home's status line appears for a red check and a stale `self-check`, and is absent when neither.

### 3.18 The daily dump (#56)

The one failure `12` §8 exists to prevent is a backup that exists and does not restore, so the test
restores it.

- **Round trip, with psql:** a row in every table, with the values COPY must escape (tabs, newlines,
  backslashes, a `\.` line, Japanese), a `vector`, `jsonb`, arrays with a null element and both
  self-references on `answers`, is dumped from one snapshot and loaded with `psql -f` into a fresh
  database built by the migrations. **Every table's row count and a digest of its rows' full text
  match the source.**
- **The three auth tables are left out:** with rows in `sessions`, `accounts` and `verifications`
  holding a sentinel token, the dump names none of them and contains no sentinel, and the restored
  tables are empty.
- **The file guards its own restore:** loaded into a target that already holds rows it fails and
  writes nothing; cut short before its `COMMIT`, it commits nothing; loaded into a target whose schema
  differs (a migrated database with one extra column), it is refused and writes neither rows nor journal.
- **drizzle's journal travels with it:** into a migrated target whose journal was emptied (a Schema
  only branch), the journal afterwards matches the source's and `drizzle-kit migrate` applies nothing;
  into a target `drizzle-kit migrate` built, the journal is left as it was.
- **The S3 write goes through the `BackupStore` port** with a fake: the object lands under the run's
  dated key and its size is the logged size; a refused write is an outcome with S3's error class, never
  a throw, and its log line carries the key, duration and error class only (§3.10).
- **Against the cron route:** a written dump is `0`, a failed one is red on the status page and Home
  while the run's other rows still land, no backup key is no reading, and neither a caller without the
  secret nor `digest` starts a dump.

---

### 3.19 Follow-ups (#44)

`07` §5.9, with a fake follow-up generator. The pure derivation (`roundStep`) and the port's output
check have unit tests of their own.

- **`submit` writes the `follow_ups` row before it returns**, in both modes: `generated` with its text,
  model, prompt version and tokens, and `next` is that row at **its parent's position**.
- The generator is sent the question as asked and the **corrected** text, never the raw one, and is
  **never called inside a transaction**.
- **A follow-up's answer is never a first attempt**, realistic mode included, and its attempt's stamp 3
  is the follow-up prompt's version; the other three stamps are the round's.
- **No follow-up for a follow-up's own answer, or for an answer-again**: one row and one call per
  bank question.
- **A failed generation is a `missing` row** with its `error_class` and no text, after one retry — and
  after none for a refusal a second call would get again. The call returns
  `502 followup_generation_failed`; the same body again returns `200` with `next` degraded to
  `question`, `pressure` or `feedback`, generates nothing, and the round completes with the hole.
- **Resume reads the stored follow-up**: the same text on every read, no model call.
- A `submit` whose follow-up write failed leaves the answer committed and no row: the round reloads
  onto the saved answer, the slot is `422` and `complete` is `409`, and the same body again writes
  the follow-up exactly once. A row a concurrent `submit` stored first is kept, and returned.
- **An abandoned round gets no follow-up**: no call when it is abandoned before generation, no row
  when it is abandoned during it.
- Screen 8 reads each answer's follow-up as asked, with its own scoring status, or as missing.
- **No follow-up text reaches a log line or an error envelope** (§3.10); `next.text` returns it to its
  owner, by design.

### 3.20 History (#50)

`lib/round/history.integration.test.ts`, over the synthetic rounds (`12` §1), and
`db/seed-rounds.integration.test.ts` for the seed itself.

- **`GET /api/rounds`**: newest first, with the derived status, the counts and the stamps; another
  user's rounds never listed; `language`, `round_type` and `mode` filter and nothing else does — an
  unknown parameter, a repeated one, a `limit` outside 1–100 and a cursor this server did not mint are
  each a `400` naming the field. **Paged one at a time through three rounds a microsecond apart with
  none skipped or repeated** — the case a millisecond cursor loses.
- **Abandoned on the Asia/Tokyo day** (§3.15), through the list: the newest open round is in progress
  at 23:59 JST and abandoned a minute later, on the same UTC date; and one started at 08:30 JST is
  still in progress after midnight UTC.
- **`GET /api/answers/{id}/audio`**: `404 audio_missing` for a null key **and for a key that points at
  nothing** — no URL is minted for an absent object; a URL, its expiry and the duration for a stored
  one; `404 not_found` for another user's answer; `502 upstream_s3` when S3 cannot be reached, with the
  error class logged and the key in no log line or envelope.
- **`POST /api/scoring-attempts`**: a new `pending` row beside the failed one, which is unchanged, with
  server-derived stamps — the follow-up's prompt version for a follow-up's answer; `422
  scoring_not_retryable` for an `ok` and for a `pending` latest attempt, and for a second retry while
  the first is pending; a body carrying a stamp is a `400` naming it; `write_failed` leaves no row.
- **`run`**: scores the one answer, in the rubric's order, with **no total, average or overall** in
  the body; **`round_feedback` and every other answer's attempt are byte-for-byte what they were**;
  the scorer is sent the corrected text; a finished attempt is returned as it stands with **no model
  call**, so an `ok` score is not re-rolled; spent retries are `502 scoring_failed` and the answer can
  be retried again; **a held claim is `409 scoring_in_progress` with no model call, still held one
  second short of the invocation ceiling, and taken over at it**; a realistic round in progress gets
  the status alone; each route counts in its own rate-limit bucket. **A pending attempt run later is
  stamped with the scorer that scored it**, its other three stamps unmoved, and a failed one keeps the
  stamp it was given.
- **Never a bare `500`** (§3.16, `07` §2): a session read that throws on each of the four routes above
  is `500 write_failed` with `error_class: unexpected` and the id it was called with, the error's text in no
  envelope or log line, no model call and no new attempt.
- **The detail loader**: question, follow-up and missing-follow-up rows in order; a practice retry
  directly under the answer it retries; both transcripts on every answered row; **an unreached
  question's text absent from the whole serialised result**, and a held score's attempt id with it.
- **No record text in any envelope or log line** these routes produce (§3.10).
- **The seed**: four rounds in the four states, once — a second run writes nothing and changes no row;
  every model stamp names a fixture; no recording; a first attempt claimed only where the question has
  no earlier answer; and it refuses, writing nothing, without the CV, rubric and questions it stamps.

### 3.21 Model answers (#74)

`07` §5.12 and §5.19, with a fake model-answer generator. The port's output check and its input
block have unit tests of their own, and §3.1 holds `model_answers` to one row per answer.

- **`complete` writes one `model_answers` row per submitted answer** — each bank question and each
  follow-up — with the body, the model, the prompt version and the tokens, and reports
  `model_answers: { written, failed, pending }`.
- The generator is sent the question as asked and the **corrected** text, never the raw one; a
  follow-up's call carries the question it followed and that answer. **It is sent no score.**
- **A mark is a span the server found**: a quote that stands in the answer is stored as its span, in
  code points; an invented one is dropped and counted, never clamped. A Japanese round's row carries
  its English translation with spans into the English text.
- **A digit figure neither the CV text nor the user's own answer holds is marked by the server**,
  whatever the writing call marked, in the answer and in its English translation
  (`lib/round/model-answer-figures.test.ts`; the rule is `04` `model_answers`).
- **A failed call never fails `complete`**: the round completes, its feedback is written, the other
  answers' rows are written, and `failed` counts the one that is not.
- **A slow call never holds the feedback**: past the wait, `complete` answers with the calls that
  finished stored and the rest counted as `pending`; a pending call's row is written in `after()`,
  and one that then fails leaves a gap the retry fills.
- **The rows are written even when the feedback is not**, and a round completed before the table
  existed has none.
- **The retry writes only what is lacking**: `201` with the count, one call per missing answer and no
  call for an answer that has a row; `200` and no model call when nothing is lacking; `502
  model_answer_generation_failed` when a call fails again, with what succeeded stored; `500
  write_failed` when the insert fails; `409 round_not_complete`; `404` for another user's round.
- **A row is never rewritten**: one a concurrent call stored first is kept, and the later result is
  discarded.
- **No model answer for a practice answer-again.**
- Screen 8 reads each answer's model answer as segments cut at the stored spans, the follow-up's
  beside the follow-up, and a missing one as missing.
- **No model answer, and nothing it was written from, reaches a log line or an error envelope**
  (§3.10).
- The week's spend counts `model_answers` tokens (§3.17).

### 3.22 Practice mode (#49)

Practice is where a second row for one prompt is written on purpose, so what it must not disturb is
tested with it. Through the handlers, against Postgres.

- **The re-take**: a second and a third slot-open for the same prompt return the same answer row and
  presign the same object key; once the take is transcribed the next is `422
  transcript_already_final`, with no new presign and no second transcription.
- **Answer again** writes a new row with `retry_of_answer_id`, the original's position, question and
  prompt text, `is_first_attempt = false`, its own key and its own scoring attempt. **The original row
  is byte-for-byte what it was**, the round's `next` is what it was, and **no follow-up is generated
  or stored** for the retry. A follow-up's answer can be given again, beside that answer.
- A retry of a retry points at the original. A repeat while a retry is open returns that row and key;
  transcribed, it is `transcript_already_final`.
- Refused, writing nothing: in a realistic round (`400`, `retry_of_answer_id`), for an answer not yet
  submitted (`400`), for an id that is not an answer of this round — unknown, or another round's
  (`404`).
- **`complete` with an empty body** closes a practice round with `felt_pressure` null and writes the
  round feedback; a rating is still `422 pressure_not_applicable`, and a realistic round with no
  rating is still `422 pressure_required`.
- **The round feedback uses original answers when one scored**, omitting retries from the generator
  input and CV region. When none scored, a scored retry produces feedback under the new prompt version.
  Screen 8 gives both question retries and follow-up retries their own pages, numbered when repeated;
  a retry's page reads the model answer of the answer it follows (§3.21).
- **After the round's last answer the page opens on that answer's frame with the feedback next**,
  never on screen 7 — the defect #44's review left for this slice.
- The page opens, in order, on an open answer-again, the open answer to the current prompt, the frame
  of the answer sent last (`10` §15).
- **Practice prefers seen questions, end to end**: questions answered through the handlers in one
  round are the first asked by the next practice round, and their practice answers are not first
  attempts.
- `GET /api/rounds/{id}` (§3.15): `resume.at` for each state of the open answer, `submit` when a
  follow-up is not stored, `complete` at the end, null for an abandoned round; a `failed` attempt as
  its status alone; **no key anywhere in the response that names a composite**, and no answer or
  prompt text in a log line.

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
| Upload failure | Intercepted S3 PUT fails → "held on this device", retry offered, tab-close warning present, blob still in IndexedDB after a reload. The retry then delivers the held bytes to the same answer row, and nothing is left held. In practice, an answer-again take whose slot call never reached the server is offered again after a reload, on its question headed `· again`, and its retry opens the slot beside the answer it follows (`06`, 2026-10-07). |
| Rejected upload | For each refusal — over the size cap, and an unsupported type — the take is still in IndexedDB, the one refusal notice and the typing fallback are shown with no upload retry, and a reload returns to them. In both languages, with the take stored and with IndexedDB unavailable, that notice is the frame's whole text: no retry wording and nothing about the tab. The typed answer is stored on a slot with no key, and the take is still held after it. In practice, a refused answer-again take answered by typing is still held but not offered again: once that answer is sent, a reload opens on its per-answer frame (`06`, 2026-10-07). |
| Transcription failure | Take kept; both retry **and** the typing fallback are reachable, and a reload returns to them. A typed answer is stored with no transcriber, no pace and no duration, and its take is kept; a retry that succeeds transcribes the same take. |
| Mic denied | With the microphone refused, screen 3 names the fix, no request is made, no answer row exists, and the round's read still asks the same question. |
| Spent project | With the mock answering the preflight `429 project_spend_limit_exceeded`, Setup shows the `model_unavailable` sentence, no round is created, and the preflight is asked once. |
| Transcript editor | The rewrite-magnitude meter moves with edits and its submitted value matches what the server stores. |
| Screen 7 is not skippable | Realistic mode offers no way past the felt-pressure rating to feedback. **This screen is load-bearing for latency** (`03` §3) as well as for the brief's falsification test — a future "skip" link is a regression in two places at once. |
| Pending score renders | The feedback screen states a pending score plainly and **does not spin** (`03` §5, §8). A failed one reads `Not scored` / `未採点`, and neither holds the round-level findings back. |
| The round's two waits | With each of the take's calls held open in the browser: the take on its way names the upload, then the transcription, on a two-segment track whose clock keeps counting across both; a failed transcription ends the wait, and trying again starts it and its clock again. The round closing says `N of M done` with a segment per answer and one for the feedback, then that scoring is finished, **against the round's real read**, with two scoring calls and then the feedback's held open in the mock (`06`, 2026-10-06). While it closes, pressing another rating changes nothing: the one sent stays selected. After a failed close the rating changes again, and trying again sends and records the one picked then. Both in Japanese in a Japanese round. **A practice round closing says the same, counting a question given again once:** six questions, one of them answered again, held at "4 of 6 done" with a segment per question, never seven; and with every original scored and an answer given again still pending, it says scoring is finished, six of six (`06`, 2026-10-06). |
| Resume | Reload mid-round returns to **the same** question, with earlier answers intact. Starting another round, then opening the first, shows it read-only as abandoned; so does the newest round once its Asia/Tokyo day has passed, with its own sentence. A reload before upload confirmation resumes at `upload` with the held take; after confirmation it resumes at `transcribe`, with no new take — except a practice re-take held beside an older confirmed take, which the reload sends to the same slot and object, transcribing nothing unasked (`06`, 2026-10-06). A reload onto a slot opened as typed resumes at `transcript`: the typing box is open, nothing offers to record, and the saved text lands on that slot. |
| Follow-up | Each question is followed by its one follow-up at the same position, named in the header; a reload on it shows the same text and makes no generator call; screen 8 shows it as a row under its answer's scores. |
| Missing follow-up | With the fake generator failing, screen 6 says the follow-up was not generated, the answer is locked, and one control goes on to the next question; screen 8 shows the gap on that answer. |
| Follow-up not stored | A reload onto an answer committed without its follow-up shows the saved answer and one control, which writes the follow-up and asks it. |
| Spoken question | Realistic mode requests the speech route for the prompt on screen, by position; practice mode never requests it. A round opened with no gesture offers the control that plays it. A failed request puts the `speech_failed` notice where the speaker line was, and the take is recorded as usual. |
| Model answer | Screen 8 shows what was said beside the stored model answer, for the question and for its follow-up, with the located unsupported quotes and independently found unsupported figures underlined and the legend naming the CV stamp; a Japanese round's reads in English from the stored translation when the pill is on, and what was said does not change. |
| Model answers not written | With the fake generator failing, the round completes and its feedback renders; each answer says its model answer is not written, with a control — **no spinner**; a retry that fails shows the catalogue's sentence, and one that succeeds fills every answer of the round. |
| Feedback not ready | With the fake feedback generator failing, screen 8 renders every score, a plain pending sentence and a retry — **no spinner** — and the retry fills the round-level region. |
| CV grounding | The mock scorer and feedback call each return one thing the server can verify and one it cannot. Screen 8 shows one `Unsupported` rail per answer quoting the corrected text and one `Unused` rail quoting the CV; **the invented quote and the invented claim number appear nowhere.** |
| Wrong language | A Japanese answer in an English round carries the wrong-language line on its own page of the pager and no other, is still scored, and its attempt stores `answered_language = 'ja'`. |
| Coverage marks | After the round, `/cv` draws the cited claim with the heavier mark, the rest without, and the count line states how many were never used. |
| Practice frame | After a practice submit, the per-answer frame states the score as pending, then shows it once scored; "answer again" writes a second answer at the same position with no follow-up. **As built (#49), `e2e/practice.spec.ts`:** the mock holds the scoring call open while the frame is read, so "pending" is asserted, not raced; the follow-up is ready beside the pending rows. |
| Practice re-take | Record, stop, record again: one answer row and one object key throughout, and no clock, cap line or timer on the frame. |
| Practice ends without a rating | The last per-answer frame offers the feedback; screen 7 never renders, the round is complete with `felt_pressure` null, and the feedback call uses scored retries when no original answer scored. A round sent to its end through the API opens on the same frame. |
| Practice asks seen questions | Setup's `Practice` starts a round whose first questions are the ones an earlier round answered, with no set piece. |
| History's rail | Every round newest first; `Unscored — retry scoring` on the rounds with a pending or failed score, `Abandoned — not counted in progress` on the open one, no line on the scored one; the chrome English on a Japanese round; the newest open round started today offered for resuming; with no rounds, a sentence and the way to start one. After 120 older rounds are loaded, a detail refresh keeps all 120 visible, two of them a microsecond apart still in the server's order; a round started elsewhere before the refresh appears at the top and the oldest loaded round stays; and a page `Older rounds` adds while that refresh is in flight stays. |
| History's matrix | Each question with its follow-up under it; 10 §10's sample row `4 3 4 3 4 2 3`; **the missing follow-up as a row spanning the score columns**; seven dimensions in a Japanese round and the pill renaming them without changing a score; an unreached question shown by its number alone. |
| History's playback | Every answered row opens its raw transcript beside the correction. A stored recording loads in the `<audio>` element from a presigned URL minted on open; **a missing one and an unplayable one are each a sentence, with the transcripts still there.** |
| History's retry | A failed score's retry scores that answer alone: one scoring call, **no feedback call, `round_feedback` unchanged**, a new attempt beside the failed one, the rail's line cleared, and no control left on an `ok` score. A retry that fails says so on the row and stays offered. A pending score is run as it is, with no new attempt. If creation commits but its response is lost, the row refreshes to the pending attempt and remains runnable. |
| History's answer-again | A practice round with an answer and its "answer again", inserted by the spec: the retry is the row directly under the answer it retries, labelled `Answered again`, with its own scores; **the first answer's scores are still shown beside it** (refusal #3), and each row opens its own transcript. |
| No deletion surface | No delete or share control on History, a round, an answer or a score (refusals #3, #6). **As built (#50):** on every round's page with a row open, no control's name matches a delete, share or export word, every button is one of the four History has — a play toggle, the pill, `Retry scoring`, `Older rounds` — nothing takes input, and `DELETE` on a round, an answer and an attempt finds no route. |

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
- [ ] Realistic mode's TTS pronounces the question correctly, including company names and 役職 — in both languages, with the model pinned in `lib/ai/models.ts`. `npm run ear-check` speaks synthetic questions in both languages through the real port and writes them, with a page to play them from, to `private/ear-check/` (#45).
- [ ] **The round loop's latencies are measured and recorded in `03` §4** — scoring, follow-up generation, round feedback, question generation, transcription and TTS — before release. Re-measure changed models or prompts; the Japanese follow-up awaits a real round with follow-ups on `develop`, and `feedback-en-1.2` has not been re-measured (`06`, #44).
- [ ] **Model answers, read on a real round** (#74): each one answers the question asked, keeps the example given, says nothing the CV or the user's own words do not hold, and underlines what the CV does not back. Measured and read on synthetic rounds only so far (`03` §4, 2026-10-04); **no model answer for the real CV has been read.**
- [ ] **The rubric v1.0 read**: the user has reviewed every dimension's per-level anchors in both languages, and the Japanese has had its native read, before it is seeded anywhere real.
- [ ] The felt-pressure screen still feels unhurried. It is instrumentation and it is where the last score lands; if it starts feeling like a loading screen, both purposes are damaged.
- [ ] Feedback renders **while you are still sitting there.** PRD §9 calls a spinner that outlives the sitting a defect — this is the acceptance test for that sentence, and no automated test can make it.
- [ ] Every new Japanese string has had a **native read** (`05-design-system.md` §6). Not a review of the translation — a read for whether a person would write it.

**Per CV upload:**

- [ ] Claims on a **real** CV: eyeball extraction quality — no paragraph-sized lumps in a late, dense section — and check `spans_rejected`, `quotes_outside_window` and `claims_duplicated` are zero. First run 2026-09-23 (#20, one call); the windowed re-measure and eyeball, 2026-09-27 (#29), judged good and kept `lib/cv/limits.ts`'s caps (`03` §4).
- [ ] Every rendered quote is genuinely in the CV. Sample five.

**The CV feature's read** is collected as one batch in `docs/checklists/native-read-cv.md`: every
Japanese string #14–#18 added, the new `cv_too_large` sentence, and the three prose strings that said
`職務経歴書` where they meant the set. **Done 2026-09-27 as an AI review, not a native read** — the user
does not read Japanese and delegated it (#38). No native speaker has read these strings.

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
6. `npm audit --audit-level=high`, run as `npm run audit:ci`: it fails on every high or critical
   advisory except GHSA-vfj7-8cjw-p6xm on `braces` `<=3.0.3` at high severity, until a patched
   `braces` ships (`06`, 2026-10-03)

Dependabot weekly (`03` §9). Better Auth, Drizzle and the OpenAI SDK are **not** auto-merged: they are
pinned and upgraded deliberately, and the OpenAI SDK sits on the scoring path.

**Green CI is required to deploy** (`12-deployment.md` §4), and `main`'s migrations are run by hand
*before* the push that deploys — so CI runs against the schema production is about to have, not the one
it had. `develop`'s are applied by its own build (`12` §4); `db/migrate.integration.test.ts` holds that
step: from empty, from one behind, a migration that fails, a migration drizzle skipped for its older
timestamp, a database ahead of the folder, and two builds at once.

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
| **A model answer's truthfulness** | Deterministic tests cover digit figures in both languages against the CV and the candidate's own answer, comparing normalized value and kind (plain number, percent, or multiplier); spelled-out numbers are tracked in #84, and other invented facts still require a real model read. Tests also hold that marks are real spans and a row is written once (§3.20). §5's checklist item is the read. | A real round shows an unmarked nonnumeric invention — then a second, checking call (`07` §7). |
| **TTS output** | Nothing to assert programmatically beyond "audio was produced"; the thing that matters is whether 役職 is pronounced correctly, and that is an ear. | — |
| **Real transcription accuracy** | Depends on a model whose exact id is still unconfirmed (`03` §4), and the correction step exists precisely because transcription is imperfect. | The transcription model is pinned, then measure word error rate on a fixed set of real takes. |
| **Mobile and other browsers** | Desktop-only, stated by the app, no breakpoints (decision log Phase 2). Testing it would test a claim not being made. | Mobile is ever in scope. |
| **Load and performance** | One user, eight rounds a month. The only latency that matters is feedback rendering while the user is there, and that is §5's checklist item. | A second user exists. |
| **Multi-user isolation beyond query scoping** | §3.11 covers scoping, which is the part that is free to test now. Invite flows, roles and sharing do not exist and must not (`08` §7, refusal #6). | Tenancy activates — and then `08` §7's step 3 comes first. |
| **Accessibility beyond keyboard reachability and contrast** | One known user, desktop, with the design system's contrast already fixed in `05`. | Anyone else uses it. |
| **Backup restoration against production** | §3.18 restores a dump of synthetic rows on every CI run; a real production dump restored into a Neon branch is not tested until `12` §8's drill. **This is the weakest link in this document** — an untested restore is a hope. | Immediately after the first production deploy (#21): restore into a Neon branch and check a round reads back whole. |

---

## 10. The one test that would have caught each past mistake

There are no past mistakes yet — the repo has no commits. This section exists so that when there is
one, it lands here with the test that now prevents it. **A bug in any of §1's four silent failures gets
a test before it gets a fix.**
