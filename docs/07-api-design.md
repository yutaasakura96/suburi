# API design — Suburi

**Date:** 2026-09-12
**Status:** Phase 4b. Tier 2, triggered: there is a real API surface — the round loop is client-driven
and audio never crosses a function, so the browser talks to endpoints. **Amended 2026-09-27 for the
round loop** (`06`, "Phase 6 — the round loop"): §1, §3, §5 intro, §5.3–§5.6, §5.9, §5.10, §5.12, and
two new endpoints, §5.15 and §5.16.

Written against `03-technical-design.md` §3 (the round loop in calls), `04-database-schema.md` (every
entity), `08-auth-and-permissions.md` §5 (route protection). Every invariant in PRD §9 and
screen-spec §11 binds this document; where an endpoint exists in the shape it does *because* of one of
them, it says so.

---

## 1. The shape of the surface, and why

**Every mutation is a Route Handler under `/api`. Reads are Server Components, except the three the
live round client genuinely needs as JSON.**

*Why not Server Actions:* the round loop is driven by the client — the recorder holds a blob, the
upload is a direct PUT to S3, and the transcript editor is a controlled buffer. Those steps are
`fetch` calls no matter what, and `03` §8 requires a **specific sentence** for every failure, which
means one error envelope the UI can map exhaustively. Two conventions (thrown Server Action errors and
HTTP responses) would give two half-mapped failure surfaces. One HTTP surface is also `curl`-able,
testable without a browser, and documentable — which is this document.

*Cost accepted:* round setup and the CV upload are forms, and as Server Actions they would be less
code. They are endpoints anyway, for the uniformity.

**Reads that are Route Handlers, and only these:**

| Read | Why it cannot be a Server Component |
| --- | --- |
| `GET /api/rounds/{roundId}` | Resume after a refresh mid-round; the client reconciles its own state against it. In a practice round, also practice's per-answer frame (§5.5). |
| `GET /api/rounds` | History's cursor-paginated list. |
| `GET /api/answers/{answerId}/audio` | Mints a short-lived credential on demand, at play time. |
| `GET /api/rounds/{roundId}/speech` ⚡ | Streams the synthesised question audio at ask time (§5.15). |

Everything else — Home's intervals, Progress's trends, History detail, the feedback screen — is a
Server Component reading Postgres directly. **The feedback screen in particular is a read** (`03` §3):
by round end the scores are already rows.

### Rules that apply to every endpoint

1. **Session required.** No public endpoint exists except Better Auth's own. Enforced in the proxy
   *and* re-asserted inside the handler (`08` §5) — the proxy's matcher is not a security boundary.
   **The one exception is the two cron routes (§5.17, §5.18),** which Vercel calls with no session:
   each authenticates the caller with `CRON_SECRET` instead, and answers `401` without it (`06`,
   #55). They are not public — a request without the secret is refused before anything is read —
   and they return counts and ids only.
2. **Every query is scoped by the session's `user_id`.** A row belonging to another `user_id` is
   `404`, never `403`: the API does not confirm that someone else's id exists.
3. **Zod at the boundary, server-side.** Client validation is for feedback speed and counts for
   nothing (`03` §9).
4. **No `403` anywhere.** There are no roles (`08` §4). Unauthenticated is `401`; not yours is `404`.
5. **Rate-limited per session on every route that calls a model** — marked ⚡ below (`03` §9, second
   worst thing an attacker could do). **One shared limiter**, not a rule re-implemented per route;
   `429 rate_limited` carries `Retry-After`. **Mechanism (#18): a fixed window per `(session, route)`
   in Postgres** — `rate_limit_windows`, one atomic upsert (`04` §2), `lib/api/rate-limit.ts`. Each ⚡
   route has its own bucket, with its limit and window as a constant beside the limiter. **The count is
   taken right after the session check and before the body is parsed**, so every authenticated
   request counts, a refused one included, and a flood never reaches Zod or the database's real work.
   `POST /api/cv-versions`: **6 per 10 minutes.** Why not Vercel's WAF: `06` "Phase 6 — #18".
   **The round routes' limits (#42), from the round's own shape** — a 7-question round makes 14
   `transcribe` and 14 `submit` calls: `POST /api/rounds` **6 per 10 minutes**; `transcribe` and
   `submit` **30 per 10 minutes** each, two of the longest rounds with retries to spare; `complete` and
   `feedback` **6 per 10 minutes** each. Every one its own bucket. **The speech route (#45): 30 per 10
   minutes** — one request per prompt asked, 14 in the longest round, and a reload asks again. A later
   slice's ⚡ route sets its own here the same way: `model-answers` (#74, §5.19) **6 per 10 minutes**,
   as `feedback` is.
   **History's retry (#50):** `POST /api/scoring-attempts` and `scoring-attempts/{id}/run` **30 per 10
   minutes** each, in two buckets (`scoring-attempts`, `scoring-run`) — the longest round has 14
   answers, and retrying every one of them is 14 of each call.
6. **The client never chooses an S3 key, an object prefix, a `user_id`, a `position`, an
   `is_first_attempt`, a question, a CV version, text to be spoken, or any version stamp.** All are
   server-derived. This is not defensive coding; it is what makes the four stamps and first-attempt
   uniqueness trustworthy.

---

## 2. The shared error envelope

Defined once. Every non-2xx response from every endpoint, without exception.

```json
{
  "error": {
    "code": "transcription_failed",
    "message": "Transcription returned no text for answer c001. The take is retained.",
    "detail": { "answer_id": "c001e8a2-…", "audio_duration_ms": 94000, "attempt": 2 }
  }
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `string` | snake_case, machine-readable, from the closed catalogue in §3. **This is what the UI switches on.** |
| `message` | `string` | English, one full sentence, for the developer and the log line. |
| `detail` | `object` | Ids, counts, durations, error classes. Nothing else. |

**`message` is never rendered to the user.** The UI maps `code` to localised copy held with the rest
of the copy. Two reasons: `03` §8 demands a specific sentence per failure and a server string cannot
be the Japanese one; and the bilingual chrome rule belongs to the screens, not the API. **It is decided
now** (`06`, 2026-09-27): a round screen renders the code in the **round's language**, Home, Setup,
Progress and History in **English**, and the CV screen in the panel's language (`10` §0). The API
still sends no user-visible string, so it cannot get that wrong.

**`detail` obeys `03` §8's never-log list.** No transcript text, no corrected text, no CV text or
claim text, no company notes, no prompt bodies, no model response bodies, no salary expectations. A
validation failure reports *which field* failed, never the value. This is the same rule as for logs,
for the same reason: an error payload is a third home for sensitive material.

### Status codes, defined once

| Code | Means | Body |
| --- | --- | --- |
| `200` | Read or idempotent re-request succeeded | resource |
| `201` | A row was created | resource, with `Location` |
| `400` | Malformed request — bad JSON, failed Zod | envelope, `code: "invalid_request"` |
| `401` | No session, or session expired | envelope, `code: "unauthenticated"`. **No redirect** (`08` §5) |
| `404` | Not found, or not this user's | envelope |
| `409` | Valid request, wrong state — e.g. scoring a round that is already scored | envelope |
| `422` | Refused by an invariant — the request is well-formed and would corrupt the record | envelope |
| `429` | Per-session rate limit on a model route | envelope, `Retry-After` |
| `500` | A database write failed on a round route | envelope, `code: "write_failed"` — never a bare `500` (`06`, 2026-09-28) |
| `502` | Upstream failed — OpenAI or S3 | envelope, `code` names which |
| `503` | Preflight says the scorer is unavailable | envelope, `code: "model_unavailable"`. **Includes a spent OpenAI project** — upstream that is `429 project_spend_limit_exceeded`, and it is mapped here, never retried as a rate limit (`06`, 2026-09-27, confirm 5) |

**`422` is the interesting one.** It is the code for *"this is refused by design"* — submitting a
felt-pressure rating for a practice round, retrying a score that succeeded, a second first attempt.
Those are not client bugs and not server errors; they are the schema's guarantees answering back.
A `422` means **the invariant did its job**, and its `code` names which invariant.

---

## 3. Error code catalogue

Closed set. Adding a code means adding copy for it in both languages — `11-testing-plan.md` has a test
that asserts the two lists match.

| Code | Status | Raised by | Rendered on |
| --- | --- | --- | --- |
| `unauthenticated` | 401 | every route | — (client redirects) |
| `invalid_request` | 400 | every route | inline, per field |
| `not_found` | 404 | every route | — |
| `rate_limited` | 429 | ⚡ routes | inline, with wait |
| `model_unavailable` | 503 | `/api/health/model`, `POST /api/rounds` | screen 2 — round cannot start |
| `question_generation_failed` | 502 | `POST /api/rounds` | screen 2 — the round is not created |
| `presign_failed` | 502 | `POST …/answers` | screen 4 — the take is held |
| `upload_too_large` | 422 | `POST …/answers` | screen 4 — after the take, before any upload |
| `unsupported_content_type` | 422 | `POST …/answers` | screen 3 |
| `audio_missing` | 404 | `transcribe`, `audio` | screen 4 / History playback |
| `transcription_failed` | 502 | `transcribe` | screen 5 — keep take, retry or type |
| `transcript_already_final` | 422 | `transcribe`, `transcript`, `POST …/answers` | screen 5 |
| `answer_already_submitted` | 422 | `submit`, `POST …/answers` | screen 6 |
| `followup_generation_failed` | 502 | `submit` | screen 6 — answer is saved |
| `scoring_failed` | 502 | `scoring-attempts/{id}/run` | screen 8 — stated as pending; History — on the answer's row, with the retry still offered |
| `scoring_not_retryable` | 422 | `POST /api/scoring-attempts` | History |
| `scoring_in_progress` | 409 | `scoring-attempts/{id}/run` | History — on the answer's row: it is being scored, wait and try again (§5.10) |
| `pressure_not_applicable` | 422 | `complete` | — (a client bug in practice mode) |
| `pressure_required` | 422 | `complete` | screen 7 |
| `round_already_complete` | 409 | `complete`, `answers`, `submit` | — |
| `round_not_complete` | 409 | `complete` | screen 7 |
| `round_abandoned` | 409 | `answers`, `submit`, `complete` | the round screen — the round takes no more writes; start a new one (§5.5) |
| `feedback_generation_failed` | 502 | `complete`, `feedback` | screen 8 — the round is complete and its scores show; the round-level note is pending and retryable, unless `detail.error_class` is `no_scores`, which no retry can fix (§5.12) |
| `model_answer_generation_failed` | 502 | `model-answers` | screen 8 — under the question whose model answer is not written; the round, its scores and its feedback are untouched, and the retry stays (§5.19) |
| `role_context_too_large` | 422 | `POST /api/role-contexts` | Setup's add form — before anything is saved. The cap is measured (§5.3) |
| `speech_failed` | 502 | `speech` | screen 3 — a short notice; the question stays as text and the round goes on (§5.15) |
| `write_failed` | 500 | every round route | the screen that made the call — nothing half-written; the round stays resumable |
| `cv_unchanged` | 422 | `POST /api/cv-versions` | CV screen — the save is refused, nothing written |
| `cv_too_large` | 422 | `POST /api/cv-versions` | CV screen — before any model call |
| `cv_extraction_failed` | 502 | `POST /api/cv-versions` | CV screen |
| `upstream_s3` / `upstream_openai` | 502 | any | per the table in `03` §5 |

**Four codes are added by the round loop** (`06`, 2026-09-27 and 2026-09-28).
`feedback_generation_failed` and `write_failed` **landed with the round-loop tracer (#42)**, in
`lib/api/errors.ts` with their `ja` and `en` copy; `speech_failed` **landed with the spoken question
(#45)** and `role_context_too_large` **landed with its measured cap (#47)**, each with its copy in the
same change, as `11` §3.10 requires.

**`scoring_in_progress` landed with History (#50)**, with its copy: §5.10 always said a second `run`
while the first is in flight is a `409`, and no catalogued `409` meant that — the three there are about
a round's state, not an attempt's.

**`model_answer_generation_failed` is added by model answers** (#74, `06`, 2026-10-04), with its
copy. **Only the retry route raises it**: `complete` never fails for a model answer (§5.12).

**`round_abandoned` landed with the tracer too** (#42 review): `answers`, `submit` and `complete` read
the derived status (§5.5) inside their locked transaction, so a stale tab cannot write into a round a
newer one, or a new Asia/Tokyo day, has abandoned.

**`write_failed` is the one answer to a database failure mid-write, on every round route** (`06`,
2026-09-28). The write is one transaction, so a failure leaves nothing half-written; the handler
returns the envelope with `detail` carrying only `pg_<SQLSTATE>` and ids — the rule #14 set for the
CV route, whose drizzle error carried query parameters. **The round stays resumable**: nothing the
failed call would have written exists, so `GET /api/rounds/{id}` (§5.5) points the client back at the
same call.

---

## 4. Conventions

**Pagination — cursor, one style, everywhere.**

```
GET /api/rounds?limit=20&cursor=eyJzIjoiMjAyNi0wOC0zMFQxMjowMDowMFoiLCJpIjoiNzdhZiJ9
```

`limit` defaults to 20, maximum 100. `cursor` is an opaque base64 of `{ s: started_at, i: id }` —
keyset, not offset, so a round inserted mid-scroll never causes a skipped or repeated row. The
response carries `next_cursor: string | null`; `null` means the end. This matches the existing
`rounds (user_id, started_at desc)` index (`04` §3) and needs no new one.

**Sorting is fixed per collection, not a parameter.** `/api/rounds` is `started_at desc`, always —
History's rail has one order and a `sort` parameter would be an unused index waiting to be added.

**Filtering** is a closed set of named parameters, never a query language: `/api/rounds` accepts
`language`, `round_type`, `mode`. These are exactly the columns in the
`rounds (user_id, language, round_type, started_at desc)` index. Unknown parameters are a `400`, not
ignored — a silently dropped filter on a measurement list is a wrong answer that looks right.

**No `PATCH` anywhere.** Most of this schema is append-only; the rows that *are* filled in
progressively (an answer between presign and submit) are advanced by named endpoints — `transcribe`,
`submit` — not by a generic partial update. A `PATCH /api/answers/{id}` is how `transcript_raw` gets
overwritten by accident.

**Timestamps** are ISO-8601 UTC with `Z`. **Ids** are the uuids from `04`. **Dimension scores** are
returned as an array in the rubric's own order, never an object keyed by dimension — the order is part
of the rubric version.

---

## 5. The round loop, endpoint by endpoint

The four-call shape the loop settles into, per answer — **after the take is recorded**:

```
(record in the browser — nothing is written yet)
POST /api/rounds/{id}/answers            → answer_id + presigned PUT
PUT  <presigned url>                     → S3, direct from the browser
POST /api/answers/{answer_id}/transcribe → transcript_raw
POST /api/answers/{answer_id}/submit     → scoring dispatched + the next prompt
```

**The answer row is created at presign, not at submit — and presign happens once a take exists**
(`06`, 2026-09-27). That is what makes `transcribe` and `submit` idempotent: they address a row that
already exists, so a double-click, a retried fetch or a flaky connection cannot produce a second
`answers` row. Given `answers_first_attempt_uniq` and the never-overwrite rule (`04`), a duplicate row
is not an annoyance — it is a corrupted measurement. Opening the slot only after recording means a
failed or denied recording writes nothing and leaves the question unseen (PRD §7), and the take's real
size is known when it is checked.

**What is asked is never chosen here.** Every bank question is fixed in `round_questions` when the round
is created (§5.4), and every follow-up is a `follow_ups` row once generated (§5.9). Every read and every
next prompt comes from those rows, so a refresh cannot swap a question the user has already heard.

### 5.1 `GET /api/health/model` ⚡

Round-setup preflight. `03` §5: **a round is never started into a broken scorer**, because a round
that cannot deliver feedback while the user is there is a defect, not a degraded experience.

Cheap probe against the pinned model — not a scoring call.

```http
GET /api/health/model
```
```json
200
{ "ok": true, "model_id": "gpt-5.6-sol", "latency_ms": 412, "checked_at": "2026-09-12T04:11:09Z" }
```
```json
503
{ "error": { "code": "model_unavailable",
             "message": "Model preflight failed: upstream returned 529.",
             "detail": { "model_id": "gpt-5.6-sol", "error_class": "upstream_overloaded" } } }
```

Screen 2 disables 開始 on `503` and says what is wrong. **It does not offer to start anyway.**

### 5.2 `POST /api/cv-versions` ⚡

Save one language's **whole CV** as a new version and extract its claims. JSON, not multipart — the
client extracts text from the file in the browser; a Vercel function caps bodies at 4.5 MB and a CV is
text (`03` §3). **The file itself never reaches the server**, only the text the user checked and
approved.

**Immutable on arrival.** There is no `PUT`, `PATCH` or `DELETE` for this resource, in this version or
any later one: every `cv_claims.span_start/end` and every `cv_documents.start/end` in the database
indexes into `body`, and every quote ever rendered is a slice of it (`04`).

```http
POST /api/cv-versions
{ "language": "ja",
  "documents": [
    { "kind": "rirekisho", "text": "…" },
    { "kind": "shokumu_keirekisho", "source_filename": "keirekisho_v3.docx",
      "text": "…経理システムの刷新を主導し、請求処理を40%短縮。チーム5名を統括…" },
    { "kind": "additional", "title": "Mercari SRE 提出用ポートフォリオ",
      "source_filename": "portfolio.pdf", "text": "…" }
  ] }
```
```json
201
{ "id": "3f2a91c4-…", "version_label": "応募書類 v3", "language": "ja",
  "created_at": "2026-08-30T09:14:22Z",
  "extractor_model_id": "gpt-5.6-sol", "extractor_prompt_version": "cv-extract-ja-1.2",
  "documents": [
    { "id": "d001…", "kind": "rirekisho", "title": null, "start": 0, "end": 412 },
    { "id": "d002…", "kind": "shokumu_keirekisho", "title": null, "start": 414, "end": 2860 },
    { "id": "d003…", "kind": "additional", "title": "Mercari SRE 提出用ポートフォリオ",
      "start": 2862, "end": 3401 }
  ],
  "claims": { "total": 34, "carried_forward": 27, "new": 7 },
  "validation": { "spans_checked": 35, "spans_rejected": 0,
                  "claims_split": 0, "claims_duplicated": 1, "unclaimed_run_max": 118,
                  "quotes_outside_window": 0 } }
```

**The client chooses none of the stamps.** `version_label`, `body`, every document's `start`/`end`,
`extractor_model_id` and `extractor_prompt_version` are all derived server-side. The request carries
text and structure; everything a later answer is stamped with is the server's (`04`, and §6's refusal
of a model or rubric selector for the same reason).

**Composition rules, checked by Zod at the boundary** and stated once in `04`:

| `language` | Required | Optional | Refused |
| --- | --- | --- | --- |
| `ja` | exactly one `rirekisho` | ≤ 1 `shokumu_keirekisho`, 0–5 `additional` | any `cv` |
| `en` | exactly one `cv` | 0–5 `additional` | any `rirekisho` or `shokumu_keirekisho` |

**Documents arrive in `04`'s one order** — the required document, then the `shokumu_keirekisho`, then
the `additional` documents — and that order is `position`. Any other order is `400 invalid_request`
naming `documents`; the server does not sort. A kind the language refuses is named at
`documents.<i>.kind`. `title` is required on `additional` and refused on every other kind. An `additional` document may be
written in either language whatever the set's `language` is. A violation is `400 invalid_request`
with the offending field, before any model call. **The total text-size cap is per language** —
`ja` **30,000** code points, `en` **45,000** — held in `lib/cv/limits.ts` and checked **before the
database is read and before any model call**. Over it is `422 cv_too_large`, whose `detail` carries
`body_chars` and `max_body_chars`. The unit is code points, the unit of every span and range, so the
number a refusal names is the number the record counts in. **Both numbers were measured** on the real
documents, not guessed: duration tracks claims rather than characters, and claim density differs about
2.3x between the languages (`03` §4, `06`, #20). Raising one is a measurement on a set that size.
Both were measured for **one** call and held when the real sets were re-measured windowed (#29,
2026-09-27), since windowed wall time follows the largest window rather than the whole set.

**`version_label` is derived**, `応募書類 v{n}` / `CV v{n}`, numbered per language. `unique (user_id,
language, version_label)` is the backstop; saves in one language are serialised by a
transaction-scoped advisory lock, so two concurrent saves become `v4` then `v5`, never two `v4`s, and
`created_at` order matches label order (`04`).

**`carried_forward` is `04`'s exact-match rule and nothing more.** Stated there, once: this endpoint
reports the count and decides none of it.

**`spans_rejected` is the anti-hallucination counter.** The extractor returns each claim as a verbatim
quote with an approximate start, and the server locates the quote in its document (`06`,
2026-09-21). A claim whose quote is not in the document verbatim, whose span falls outside `body` or
splits a grapheme, or which **crosses a document boundary**, is dropped — not clamped, not stored, not
shown.

**The other three say how the model *read*, which `spans_rejected` cannot** (`lib/cv/reading.ts`,
[#27](https://github.com/yutaasakura96/suburi/issues/27)). Measured against the real documents on
2026-09-23, `spans_rejected` was **0** in both languages while a quarter of the English CV went
unread, sentences were cut into uncitable fragments, and a 履歴書's qualifications were extracted
twice. Every one of those slices back verbatim, so a guard that asks only whether the quote is real is
blind to all of them.

| field | is | on a bad reading (2026-09-23) | after #27 (2026-09-24) |
| --- | --- | --- | --- |
| `claims_split` | claims abutting another claim on the same line, with no sentence ending between them | 63 `ja`, 68 `en` | **0**, **0** |
| `claims_duplicated` | claims dropped for repeating a claim this version already carries | 5 `ja`, 0 `en` | 0, 0 |
| `unclaimed_run_max` | the longest stretch of one document, in code points, that no claim covers | 239 `ja`, **3,875** `en` | 1,071, 956 |

`spans_checked` counts every located claim plus every rejection, so
`spans_checked = claims.total + spans_rejected + claims_duplicated`.

**`quotes_outside_window` is the fan-out's own guard** ([#29](https://github.com/yutaasakura96/suburi/issues/29)).
Each call returns the claims of one window, and a claim whose quote is in the text but not wholly
inside that window — another document, another window, across the window's edge — is dropped, never
kept and never moved, and counted here. The verbatim check runs first, so a quote that is not in the
text at all is a `spans_rejected` whichever window returned it. An out-of-window quote is not checked,
so every claim the calls returned is `spans_checked + quotes_outside_window`. It measured 0 across
every windowed call, so it alerts at any non-zero value, like `spans_rejected` (`12` §6).

**None of the five refuses a save.** `spans_rejected` does not, and neither do the three reading
counters: a bad reading is the model's judgement rather than an invariant, and there is no edit the
user could make that would clear it. They are logged, returned here, stored on the new `cv_versions`
row (`04`), and alerted on (`12` §6). The one case that still fails is every claim being rejected,
which leaves nothing to store — `502 cv_extraction_failed` with `no_claims_survived`.

`unclaimed_run_max` is the loosest of the three and is read with that in mind: a document that
deliberately repeats another's qualifications now leaves that whole block unclaimed, which is the
extractor obeying the one-claim-per-assertion rule rather than a section being skipped. Its threshold
is set from the measurement, not at zero.

**One synchronous extraction (N parallel windowed calls), one transaction.** The user is at the
machine waiting; the version, its documents and its claims are written together or not at all. The set
is cut into windows — passages of one document, cut at blank lines, never crossing a document
(`lib/cv/windows.ts`) — and each window gets one call that is sent the **whole set** and returns
that window's claims (`03` §4, `06`, 2026-09-27). The calls run in parallel and **all of them finish
before the transaction opens**, so nothing is held open while the model works (`06`, 2026-09-21) and
no window's claims are ever written without the others'. A window that fails with a transient error
is retried once if enough of the route's 300 s is left for another call; a window that fails for good
fails the save, and the other windows are aborted.

Failures:

- **`422 cv_unchanged`** — every document in the request matches the current version of that language
  exactly on `kind`, `title` and `text`, in the same order. **Nothing is written.** A double-click or a
  no-op save would otherwise create a permanent duplicate version, a wasted extraction call, and a
  Progress boundary line marking a change that did not happen (`04` §6, refusal #5). The client also
  disables the save control while a save is in flight; this is the server-side half of the same rule.
  **Checked twice:** before any model call, against the current version — the cheap refusal, no
  extraction spent — and again inside the write transaction, under the lock, against whatever is
  current *then*. Two tabs saving the same edit both pass the first check; the second to take the lock
  is refused by the second check rather than writing a duplicate `v{n+1}` (`06`, #16).
- **`502 cv_extraction_failed`** — any window's call failed, after the one retry it may get, **or
  zero claims survived the span validator**. Nothing is written, the version is not created, and the user simply saves again. A CV
  version with half its claims is worse than none, and one with no claims would make coverage and
  every generated question silently empty for as long as it stayed current.
- **`429 rate_limited`** with `Retry-After`, from the shared per-session limiter on every ⚡ route
  (§1, rule 5). This endpoint is the first to need it, so it is where the limiter gets built.
  **6 per 10 minutes per session**, counted before anything else in the body is looked at: a seventh
  request inside the window is `429` even if it would have been a `400` or a `cv_unchanged`.
**There is no CV read endpoint, and none is needed.** The CV screen's reads — current version, its
documents, the underlined spans, the version history — are Server Components reading Postgres directly
(§1). Rule 2 scopes them by the session's `user_id` and rule 4 makes another user's version a `404`
there exactly as it would be here.

**Nothing in this endpoint's logs or error bodies carries CV text.** Not the documents, not the
extracted claims, not a rejected span's slice. Ids, counts, durations and error classes only — `12`
§7 is the list, and a document's text is on it.

### 5.3 `POST /api/role-contexts`

```http
POST /api/role-contexts
{ "kind": "posting", "company_name": "株式会社サンプル", "role_title": "経理マネージャー",
  "source_filename": "sample_keiri_2026.pdf",
  "body": "…上場準備中。管理会計の立ち上げが直近の課題…" }
```
```json
201
{ "id": "8b4c…", "kind": "posting", "company_name": "株式会社サンプル",
  "role_title": "経理マネージャー", "source_filename": "sample_keiri_2026.pdf",
  "created_at": "2026-09-12T03:02:00Z" }
```

**Round one accepts `posting` and `general`** (`06`, 2026-09-27; `posting` since #47). `researched`
is a `400` until US-16 ships, when a saved posting takes precedence (PRD US-2). A posting is pasted, or
imported with the CV screen's importer (`lib/cv/import/`): the browser extracts the text, the user
checks it, and only the text and the filename are sent — the file never reaches the server, as in §5.2.

**A posting carries `company_name`, `role_title` and `body`, all three required and non-blank**:
the picker names a posting by the first two, and a posting with no text is General practice under
another name. Each is trimmed; `company_name` and `role_title` are at most 200 code points.
`source_filename` is optional and at most 255 code points; Setup sends it when the text came from an
import. The schema is strict: an unknown field is a `400`, as everywhere (§1).

**Immutable and reusable.** There is no `PUT`, `PATCH` or `DELETE`; a changed posting is a new row, and
Setup picks from the saved ones. The picker is a Server Component read (§1), so there is no `GET`.

`kind: "general"` requires `company_name`, `role_title`, `body` and `source_filename` to be absent —
`400` otherwise. General practice is a real row, not a null foreign key (`04`), and there is **one per
user**: a second `general` request returns the existing row with `200`, never a second row.

**A posting's `body` is capped at 20,000 code points** — measured, not guessed, the way the CV's was
(§5.2, #20; `06`, #47; `03` §4 has the table). Over it is `422 role_context_too_large`, before
anything is saved, with `detail` carrying `body_chars` and `max_body_chars` and nothing else. The cap
is one number for both languages, a constant in `lib/round/limits.ts`. It bounds what a round's
question generation is sent at round start (§5.4), which is the only model call a posting reaches.

**Not rate-limited and not ⚡**: the route calls no model. **Never logged:** `body`, `company_name`,
`role_title`, `source_filename` — log lines carry the row id, the kind and the body's length.

### 5.4 `POST /api/rounds` ⚡

Starts a round. Preflights the model, resolves the rubric and the CV version, **chooses every bank
question the round will ask** and writes them to `round_questions`, and returns the round with its
first prompt.

**The client sends the five choices from screen 2 and nothing else.** `rubric_version_id` is resolved
server-side to the newest rubric for the round's language — two rubrics, not one with a flag (`04`).
`cv_version_id` is resolved to the **current CV version in the round's language** (`04`, §6) — it was a
request field here until 2026-09-27, which contradicted §6 (`06`, confirm 1). `per_answer_cap_seconds`
is derived from `mode`: 240 realistic, **900 practice** — the runaway guard, stored because the column
is `not null` (`03` §7, confirm 2). **None of the three is a request field**, because a client-chosen
cap or version is a client-chosen stamp.

```http
POST /api/rounds
{ "round_type": "behavioural", "language": "ja", "mode": "realistic", "length": 5,
  "role_context_id": "8b4c…" }
```
```json
201
{ "round": {
    "id": "77af0b13-…", "round_type": "behavioural", "language": "ja", "mode": "realistic",
    "length": 5, "per_answer_cap_seconds": 240,
    "started_at": "2026-09-12T03:04:51Z", "completed_at": null,
    "stamps": { "cv_version_label": "応募書類 v3", "rubric_version_label": "v1.2",
                "scoring_model_id": "gpt-5.6-sol", "scoring_prompt_version": "score-ja-1.0" } },
  "prompt": {
    "kind": "question", "position": 1, "question_id": "a17e…",
    "text": "これまでで最も困難だった課題と、その解決方法を教えてください。",
    "speak": true },
  "progress": { "position": 1, "of": 5 } }
```

`stamps` is echoed because screen 2 displays it before the round begins — the four version stamps are
shown, not implied.

`speak: true` in realistic mode only; practice mode is text (decision log, Phase 2).

**Question selection, all at once** (`06`, 2026-09-27). From the `(user_id, language, round_type)
where retired_at is null` slice, in this order:

1. **At most one unseen set piece** of the round's type, if one exists — 自己紹介, 自己PR and 転職理由
   are `hr`, 志望動機 is `ceo`, and the other types have none.
2. **Generated bank questions, unseen first.** *Seen* means answered in this language, in either mode
   (`04` `questions`).
3. **New questions generated** when the unseen pool cannot fill the round, with PRD §6's bank-exhausted
   warning on Setup before the round starts.

**Practice rounds prefer seen questions**: seen generated questions first, then unseen generated
ones, then new ones — and **no set piece**, since a practice round that took one would spend its only
first attempt off the record (`06`, 2026-09-27). No question repeats within a round (`04`).

**Generation, at round start** (#47). When the bank cannot fill the round by the order above, the
shortfall is generated — one call, for the round's type and language, with the prompt
`generate-<round type>-<language>-<version>` (`lib/prompts/`), given:

- the round's **CV version as its claims**, each quoted from the stored body by its span;
- the **role context**: the posting's company, role title and text, or the fact that this is General
  practice;
- **every question already in the slice**, set pieces included, so none is asked again in other words.

The call asks for **two more than the shortfall**, so a candidate the guard maps to an existing
question does not leave the round short. Each candidate is then embedded (`text-embedding-3-small`,
`03` §4), all in one call. **Generation and embedding run in parallel with the preflight, before the
transaction** — the round waits for the slower of the two, not their sum (`03` §4 has the measured
wait).

**The transaction** then takes an advisory lock on the `(user, language, round type)` slice — two
round starts must not both insert the same new question — and, for each candidate in the model's
order until the round is full, runs **the near-duplicate guard**: the candidate is compared by cosine
similarity with the nearest embedded, non-retired question in the slice, **and at or above the
threshold the existing row is reused instead of inserted** (`04`, `03` §11). **The threshold starts at
0.90, an unverified guess.** Below it the candidate becomes a `questions` row — `origin: generated`,
its embedding, the generator's model id and prompt version — and takes the next position. Every
comparison is stored in `near_duplicate_checks` with its similarity (`04`); the weekly digest reads
those records (`12` §6). Candidates left over once the round is full are discarded, unstored.

**A reused candidate does not get asked twice.** The question it maps to is either already in this
round, or one the user has answered before. If the candidates run out with the round still short, the
remaining positions are filled from **seen generated questions** — the ones the guard mapped to first,
then the rest, oldest first. They are repeats: scored, never first attempts (§5.6). Setup says so
before the round starts (`10` §2). Only if the round still cannot be filled is it refused.

The round row and all its `round_questions` rows are written in the same transaction as the new
questions, so a round that fails to start leaves no question behind.

**Starting a round abandons any open round** (`04` `rounds`). Nothing is written to the old round:
abandonment is derived, and §6 still refuses an abandon endpoint.

Failures: `503 model_unavailable` (preflight — the round is not created, and it wins over a
generation failure in the same request); `502 question_generation_failed` (nothing created), whose
`detail.error_class` is the generation or embedding call's error class, or `bank_too_small` when the
candidates and the seen questions together could not fill the round.

**Both languages since #43**: `language` is `ja` or `en`, and each takes its own rubric, CV version,
bank and generator prompt — a Japanese round is filled from Japanese questions only, its set piece
first, and what it generates is written by `generate-{round_type}-ja-1.0` (`06`, 2026-10-03).

### 5.5 `GET /api/rounds/{roundId}`

Resume. `03` §7: a round survives a refresh, because every answer is written server-side at submit
and every prompt was fixed when it was chosen, so the round's position **and what it is asking** are
database facts.

```json
200
{ "round": { "id": "77af0b13-…", "mode": "realistic", "length": 5, "completed_at": null,
             "status": "in_progress", "…": "…" },
  "answers": [
    { "id": "c001…", "position": 1, "kind": "question", "state": "submitted",
      "scoring": { "attempt_id": "s900…", "status": "ok" } },
    { "id": "c002…", "position": 1, "kind": "follow_up", "state": "submitted",
      "scoring": { "attempt_id": "s901…", "status": "pending" } },
    { "id": "c003…", "position": 2, "kind": "question", "state": "uploaded" } ],
  "prompt": { "kind": "question", "position": 2, "question_id": "a22b…", "text": "…", "speak": true },
  "resume": { "at": "transcribe", "answer_id": "c003…" } }
```

`prompt` is read from `round_questions` at the current position, or from the parent's `follow_ups` row
when a follow-up is next — never selected or generated again. A follow-up shares its parent's
`position` (`06`, 2026-09-27, confirm 3).

**A submitted answer whose follow-up is not stored yet resumes at `submit`** (`06`, 2026-10-03): a
`submit` that died between its commit and the follow-up's row leaves a bank-question answer with no
`follow_ups` row. The read returns `prompt: null` and `resume: { "at": "submit", "answer_id": … }`,
and the same body sent again writes the row (§5.9). Resume never generates one itself, and never
moves past it.

`state` is derived, not stored: `open` (row exists, no audio) → `uploaded` (`audio_s3_key` set) →
`transcribed` (`transcript_raw` set) → `submitted` (`transcript_corrected` set). `resume.at` tells the
client which of the four calls to make next.

**`round.status` is derived** — `in_progress`, `abandoned` or `complete` (`04` `rounds`). **Only the
newest open round started today — the user's local day, Asia/Tokyo — resumes**; an abandoned round returns `resume: null`, and the client
shows it read-only. An open round is abandoned the moment a newer one starts, so a stale tab cannot
resume into it.

**Scores in the read, practice only** (`06`, 2026-09-27). For a `practice` round, each submitted
answer's `scoring` also carries its `scores` (in the rubric's order, §4) and its `flags` once `ok` —
what practice's per-answer frame shows. **A `realistic` round's read carries status only until the
round is complete**: US-8 forbids any score, flag or hint mid-round, and leaving the fields out of the
response is what makes that structural rather than a client courtesy.

**As built (#49).** The JSON above is the shape; these are the fields.

- `round`: `id`, `round_type`, `language`, `mode`, `length`, `per_answer_cap_seconds`, `started_at`,
  `completed_at`, `status`.
- Each of `answers`: `id`, `position`, `kind`, `state`, `retry_of_answer_id` — null for an answer the
  round asked for, the original's id for one given again (§5.6), which stands beside it at the same
  position — and `scoring` once the answer is submitted.
- `scoring` is the answer's latest attempt: `attempt_id` and `status` (`pending`, `ok`, `failed`).
  Where the read may show them — a practice round, or a completed one — an `ok` attempt also carries
  `scores` (`[{ dimension, value }]`, in the rubric's order), `flags` (`[{ kind, span_start, span_end }]`,
  in the order they stand in the answer) and `answered_language`. **A flag is a span into the
  corrected text, never a quote**: the page that shows it slices its own copy of the answer. A
  `pending` or `failed` attempt carries its status alone, and no justification, citation or answer
  text is in the read at all.
- `resume.at` is one of `answers` (open the slot, with `answer_id` null, or record over the open one),
  `transcribe`, `submit` and `complete`. **The key is written when the slot opens (§5.6), so an open
  slot already reads `uploaded`** and `open` is a state no row is in today; `transcribe` on a slot whose
  take never reached the bucket answers `audio_missing`, and the client records again.
- **An answer-again that is open is what the round resumes on**: `prompt` is the same prompt asked
  again, carrying `retry_of_answer_id` and `speak: false`, and `resume` names that row. With none
  open, `prompt` and `resume` follow the round's step.
- `cache-control: no-store`: practice's per-answer frame polls this read while a score is pending
  (`03` §7), and a stored copy would be the one thing it must not get.
- `401 unauthenticated`; `404 not_found` for no such round, or another user's.

**Screen 7 reads it while `complete` is in flight** (#73, `10` §7), every two seconds, for one thing:
how many submitted answers' `scoring.status` is no longer `pending`. It reads no score from it, and a
read that fails is ignored.

**An in-flight recording is the one thing that does not survive** (`03` §7), and the UI says so before
recording. The slot is opened only after a take exists, so a round reloaded mid-recording has no row
for it: the question is simply asked again.

### 5.6 `POST /api/rounds/{roundId}/answers`

Opens an answer slot and presigns the upload. Creates the `answers` row. **Called once the take
exists** — after recording, before the upload (`06`, 2026-09-27).

The client sends only what it cannot know about itself: the content type and the take's byte size.
Everything that matters is server-derived — `question_id` or `parent_answer_id`, `prompt_text`,
`position`, `language`, `is_first_attempt`, and the S3 key.

```http
POST /api/rounds/77af0b13-…/answers
{ "content_type": "audio/webm", "expected_bytes": 1840219 }
```
```json
201
{ "answer_id": "c003e8a2-…",
  "position": 2, "kind": "question", "question_id": "a22b…", "is_first_attempt": true,
  "upload": { "method": "PUT", "url": "https://suburi-audio.s3.ap-northeast-1.amazonaws.com/prod/…",
              "headers": { "Content-Type": "audio/webm" },
              "max_bytes": 20971520, "expires_at": "2026-09-12T03:22:00Z" } }
```

**Idempotency.** If the current position already has an answer row that is not yet submitted, that
row is returned — same `answer_id`, no new row — and while its `transcript_raw` is null, with a
**fresh** presigned URL for the **same key**. So an expired URL, a failed upload retried, or a double-clicked control all land on the same row.
**This is also practice's re-take** (`06`, 2026-09-27): a new take before transcription PUTs over the
same object, and bucket versioning keeps the old version (`12` §3), which is accepted. Once
`transcript_raw` is set, the take is final, as the transcript is (§5.7).

**Practice's "answer again" is the one case that deliberately creates a second row:** `{
"retry_of_answer_id": "c003…" }` in the body, allowed only in a practice round and only on a submitted
answer, writes a new answer with `retry_of_answer_id` set. **It takes the same `position` as the answer
it retries** — so the round still renders in order with the retry grouped beside its original, ties
broken by `created_at`. This is why `answers (round_id, position)` is not unique in `04` §3, and it
must not be made unique. `is_first_attempt` stays on the original, always (PRD §9, refusal #3), and
**the retry gets no follow-up** (§5.9).

**Answer again, as built (#49).** The body is the take's two fields and `retry_of_answer_id`; the
response is the slot's, with `retry_of_answer_id` beside `parent_answer_id` — null on every other
slot. The new row copies what the original was asked: `question_id` or `parent_answer_id`,
`prompt_text` and `position`. So a follow-up's answer can be given again too.

- **A retry always points at the original.** Naming an answer that is itself a retry opens one more
  retry of the same original, never a retry of a retry.
- **One open retry per original.** While one is open and not transcribed, a repeat returns that row
  with a fresh URL for the same key — its re-take — and `422 transcript_already_final` once it is
  transcribed.
- **The round's step is not consulted and does not move.** The round stays wherever it was, and
  `submit` on the retry returns the `next` the round already had (§5.9), generating nothing.
- **Refused** with `400 invalid_request` and `detail.fields: ["retry_of_answer_id"]` in a realistic
  round, whatever it names, and for an answer that is not submitted yet; with `404 not_found` for an
  id that is no answer of this round. A complete or abandoned round refuses it as it refuses any slot.
  No new error code: these are requests the client never makes (`06`, 2026-10-04).

**`position` is assigned under `select … for update` on the `rounds` row.** Two concurrent opens must
not both claim position 2.

**`is_first_attempt` is computed here, not asserted by the client**: true iff `mode = 'realistic'`,
the prompt is a bank question, and **no answer row exists for this `(question_id, language)` in either
mode** (`06`, 2026-09-27 — it used to ask only whether a *first attempt* existed, which let a practised
question count as cold). The partial unique index is the backstop — if it fires, that is a `422`, and
it means this computation was wrong.

**The prompt comes from stored rows** — `round_questions` at the current position, or the parent's
`follow_ups` row — and `prompt_text` is copied from there. Nothing is selected or generated here.

Failures: `422 upload_too_large` (the take's size against `max_bytes`, **after recording and before any
upload** — the take is still in the browser); `422 unsupported_content_type`;
`409 round_already_complete`; `409 round_abandoned` (§5.5); `502 presign_failed` — the slot is kept, and the retry lands on it;
`422 answer_already_submitted` when every position is already submitted — there is no slot left to
open — **or when the current position's answer is submitted and its follow-up is not stored yet**
(§5.5): `detail` carries that `answer_id`, and no second answer to the question is opened;
`422 transcript_already_final` when the open slot's take is already transcribed.

**A follow-up's slot** returns `"kind": "follow_up", "question_id": null, "parent_answer_id": "c003…"`,
its parent's `position`, and `is_first_attempt: false` in both modes.

`audio_s3_key` is written when the slot opens, before the upload: the key is server-derived and fixed
for the row, so a retried open presigns the same one.

Presign constraints (`03` §9): content type, maximum size, **and a server-generated key — the client
never chooses the object key.** Key shape: `{prefix}/{user_id}/{round_id}/{answer_id}.webm`.

### 5.7 `POST /api/answers/{answerId}/transcribe` ⚡

Transcribes the object the browser PUT. Reads from S3; audio never crosses a function on the way in.

```json
200
{ "answer_id": "c003e8a2-…",
  "transcript_raw": "はい、ええと、前職では経理システムの刷新を、担当していました…",
  "audio_duration_ms": 94120, "words_per_minute": 243.4,
  "transcriber_model_id": "gpt-transcribe" }
```

**Idempotent, and asymmetric on purpose.** If `transcript_raw` is already set, the stored value is
returned and **no model call is made**. There is no `force` and no re-transcribe: a raw transcript,
once obtained, is final (PRD §9 — raw transcripts are never discarded, and an overwrite is a discard).
Retry is only possible while `transcript_raw` is null, which is exactly the state a failure leaves.

Failures: `404 audio_missing` (no object at the key — the take was never uploaded);
`502 transcription_failed` — **the take is kept**, and the UI offers retry or typing the answer
(`03` §8); `422 transcript_already_final` if a client sends the typed-answer route afterwards.

### 5.8 `POST /api/answers/{answerId}/transcript`

The typing fallback from `03` §8, when transcription cannot succeed. Sets `transcript_raw` from typed
text with `transcriber_model_id: null` — so the record says honestly that no transcriber produced it.

```http
POST /api/answers/c003e8a2-…/transcript
{ "source": "typed", "text": "前職では経理システムの刷新を担当していました。…" }
```
```json
201
{ "answer_id": "c003e8a2-…", "transcript_raw": "前職では…", "transcriber_model_id": null,
  "words_per_minute": null }
```

`words_per_minute` is null: there is no delivery to measure. **A typed answer is not silently treated
as a spoken one.** `422 transcript_already_final` if `transcript_raw` is set.

### 5.9 `POST /api/answers/{answerId}/submit` ⚡

The commit point. Writes the corrected transcript, computes the diff, dispatches scoring, and returns
the next prompt.

```http
POST /api/answers/c003e8a2-…/submit
{ "transcript_corrected": "前職では、経理システムの刷新を担当していました。…" }
```
```json
200
{ "answer_id": "c003e8a2-…",
  "rewrite_magnitude": 0.12,
  "scoring": { "attempt_id": "s903…", "status": "pending" },
  "next": { "kind": "follow_up", "position": 2, "parent_answer_id": "c003e8a2-…",
            "follow_up_id": "f210…", "prompt_version": "follow-up-ja-1.0",
            "text": "その40%という数字は、どう測ったものですか。", "speak": true },
  "progress": { "position": 2, "of": 5 } }
```

**Both transcripts persist and the diff is data** (`04`, decision log Phase 2). `rewrite_magnitude` is
computed server-side and returned so screen 6's meter and the stored value cannot disagree.

**Scoring is dispatched here, not at round end.** `03` §3: scoring up to fourteen answers in one burst
at round end would put a reasoning model on the critical path of a screen PRD §9 requires to render
while the user is still at the machine. So `submit` creates the `scoring_attempts` row — `status:
'pending'`, all four stamps written, **stamp 3 from the question row or, for a follow-up, from its
`follow_ups` row** — and dispatches scoring immediately, while `submit` waits for follow-up generation
after the answer's commit. By round end, all but the last score are already rows and
the feedback screen is a read. *(Seven questions and seven follow-ups make at most 14 answers a round —
not the "sixteen" this used to say, confirm 7. Practice retries add rows without adding follow-ups.)*

**`next` is one of four shapes**, and the client does not compute it:

| `next.kind` | When |
| --- | --- |
| `follow_up` | The answer was to a bank question and its one follow-up has been generated |
| `question` | The follow-up is answered; there are positions left |
| `pressure` | Last answer submitted, `mode = 'realistic'` — screen 7 |
| `feedback` | Last answer submitted, `mode = 'practice'` |

One generated follow-up per answer, both modes, asked once (decision log Phase 2). **It is written to
`follow_ups` before `submit` returns** — `status: 'generated'` with its text and stamps, or, when
generation finally fails, `status: 'missing'` with its `error_class` (`04`, `06`, 2026-09-27). `next`
carries the follow-up's `position`, which is **its parent's** (confirm 3). A follow-up is **never scored
into progress data** — structurally impossible: it has no `question_id`, and `is_first_attempt`
requires one (`04` §6).

**No follow-up is generated for** a follow-up's own answer, or for practice's "answer again" (§5.6).
A retry's `next` is whatever the round was already on.

**What the generator reads** (`06`, 2026-10-03): the round type, the question exactly as it was
asked, and the **corrected** transcript — never the raw one, and nothing else. No CV, no rubric, no
earlier answer. What comes back is checked before it is stored: one question, not blank, at most 400
code points. English ends in `?`; Japanese ends in a question mark or `か。`. A second sentence or
question is refused: a full stop followed by a space ends a sentence, whatever the case of the next
word. A full stop inside a figure, or closing a known abbreviation or a single-letter initial, is
not one. The abbreviation list is finite, so an unlisted one loses its follow-up as `missing`, and a
single-letter initial before a second sentence still passes. Anything else is
`malformed_output`, and counts as a failed call. **One sentence that asks two things is not
detected** — a rule on "and" would refuse valid single questions — and is left to the prompt.

**The order of the writes.** The answer's commit — corrected text and scoring attempt — is one
transaction, and scoring is scheduled from it. The follow-up is then generated **outside any
transaction** and stored in a second one, which locks the round and refuses an abandoned one.
`follow_ups.parent_answer_id` is unique, so a concurrent `submit` that stored first keeps its row and
this call returns that one. `next` is computed from the stored rows, never from the request.

**Its latency, measured with `follow-up-en-1.0`** (`03` §4, 2026-10-03): 3.2 s median, 4.7 s slowest
of 15. The user waits for it inside a timed round, so the call is bounded on its own: **15 s, and one
retry after 1 s** when the failure is one a second call could get past (not a `4xx` other than `408`,
`409` or `429`). After that the follow-up is `missing`.

Failures: `400 invalid_request` naming `transcript_raw` when the answer has no transcript yet — there
is nothing to correct; `422 answer_already_submitted` (idempotent alternative: the same body returns `200` with the
existing attempt — a different body is the `422`); `409 round_already_complete`; `409 round_abandoned` (§5.5); `502 followup_generation_failed`, which is **not
fatal** — the answer is saved with scoring scheduled, and the `missing` row is written. A missing follow-up costs
one prompt; a lost answer costs a measurement.

**The `502` is returned once, by the call that wrote the `missing` row** (`06`, 2026-10-03), with
`detail: { answer_id, attempt_id, error_class }` — an envelope carries no `next` (§2). **The same body
sent again is the `200`**, with `next` degraded: that is the idempotent repeat above, reading the
stored row, and it generates nothing. The same repeat is what completes a `submit` that died before
its follow-up was stored (§5.5): the row is written then, by `submit`, and by nothing else. A
`500 write_failed` on the follow-up's own write leaves the answer committed and no `follow_ups` row,
which is that same state.

### 5.10 `POST /api/scoring-attempts/{attemptId}/run` ⚡

Performs a pending attempt. **Normally not called over HTTP at all** — `submit` schedules the same
work in `after()` (see the trigger note below), while the user is already recording the next answer.
This endpoint is the **History retry path**: it drives a `pending` attempt to completion by hand.
For a `failed` attempt, History first creates a new `pending` row (§5.11), then runs that row.

**What the scorer reads** (`03` §4, `06`, 2026-09-27): the round's rubric version, the prompt as
asked, the **corrected** transcript — never the raw one — the answer's duration and its pace, and the
CV version's claims. **What it returns**, beside the scores: the citations, the unsupported spans of
the answer (US-11), and `answered_language`. **The scoring prompt version bumped for this** (#46):
`score-en-1.1` is `1.0`'s scoring unchanged plus the CV check, a new file and so a new stamp (`03` §4),
and Progress draws the boundary where an answer's `scoring_prompt_version` changes. **A Japanese
round's `score-ja-1.0` carries the same check from its first version** (#43; `06`, 2026-10-03), so it
has no such boundary.

```json
200
{ "attempt_id": "s903…", "answer_id": "a312…", "status": "ok",
  "scores": [ { "dimension": "structure", "value": 4 }, { "dimension": "evidence", "value": 3 },
              { "dimension": "relevance", "value": 4 }, { "dimension": "fluency", "value": 3 },
              { "dimension": "accuracy", "value": 4 }, { "dimension": "length_pacing", "value": 3 },
              { "dimension": "keigo", "value": 4 } ],
  "citations": [ { "cv_claim_id": "9c41…", "relation": "supported_by" } ],
  "flags": [ { "kind": "unsupported", "span_start": 212, "span_end": 231 } ],
  "answered_language": "ja",
  "tokens_in": 3120, "tokens_out": 604 }
```

**No `total`, no `average`, no `overall` — here or anywhere.** There is no column for one (`04`), no
view that computes one, and no response field that carries one. PRD §9, refusal #1. An endpoint that
returned a mean would make the schema's guarantee cosmetic.

**Idempotent and abandon-safe.** Only `status = 'pending'` transitions. A second call while the first
is in flight is a `409 scoring_in_progress`; a call on a finished attempt returns it unchanged. `submit`
does not await its scheduled scoring work. A function terminated at the 300s ceiling — or one that dies
mid-flight — leaves a row pending with no error raised anywhere. That is why a stuck `pending` is
alerted on daily (`12-deployment.md` §6) and retryable from History. **A pending score is a
first-class state, not an error** (`03` §5): History and Progress both render it, and
**Progress excludes pending and failed attempts from trend lines rather than treating them as zero.**

Retries three times with exponential backoff inside the handler before the row is marked `failed`
(`03` §8). `error_class` is stored; the model's output never is.

Citations are written to `claim_citations` **only after span validation**: the quote is
`substring(cv_versions.body, span_start, span_end - span_start)`, never text returned by the model.
A span outside the body, or a quote that does not match its span, drops the citation (`03` §11,
`04`). **How, as built (#46):** before the call, every claim of the attempt's CV version is
re-validated — its span against the body, its slice against `text_normalised` — and only those that
pass are sent, as a **numbered list** of their sliced text. The scorer returns
`{ claim: <number>, relation }` and never an id. A number is resolved to the claim it was shown as; a
number that names none is dropped and counted. **`contradicted_by` is for a real contradiction with a
cited claim** — the prompt says so, and structurally it cannot be anything else, since a relation with
no shown claim behind it has no number to carry. An answer asserting what the CV does not mention is
an unsupported span.

**Unsupported spans get the same rule on the answer side** (`04` `answer_flags`). The scorer returns a
verbatim quote from the corrected text and a start hint; the server locates it in
`transcript_corrected` and writes the span, or drops and counts it. The hint only chooses between
occurrences of a quote that is there; it never moves a span onto text the quote does not match, and a
located span still passes the span validator — in range, non-empty, on grapheme boundaries — before it
is written. **`answered_language` is stored on the attempt**, on every attempt that ends `ok`; a value
that is not the round's language flags the answer in feedback and keeps it out of that language's
Progress (PRD §7).

**"Counted" means the `scoring_ok` log line**, which carries `claims`, `claims_rejected`, `citations`,
`citations_dropped`, `flags`, `flags_dropped` and `answered_language` beside the ids and durations —
counts only, never a quote or a claim (`03` §8). There is no counter column: a rising drop rate is a
question about the prompt or the model, read from the logs, and not a fact about the answer.

**All of it is one transaction with the scores**: the attempt turns `ok`, and its scores, citations and
flags are written together or not at all. A failed attempt stores no citation, no flag and no language.

**The trigger is `after()` in `submit`, not a client `fetch`** — resolved 2026-09-12, on the condition
this TBD set for itself. Next.js documents that `after` runs for the route's configured max duration,
implemented on serverless through Vercel's `waitUntil`, which extends the invocation until the
scheduled promises settle; Hobby Node.js functions are 300s by default and 300s at maximum. Sixty
seconds of post-response scoring fits. **This endpoint stays**, as that TBD said it would, for the
History retry path.

Two consequences a ticket would otherwise get wrong:

- **The 300s is the whole invocation** — request handling, the response, and the `after` work share one
  budget; the `after` work does not get 300s of its own. The three exponential-backoff retries above
  live *inside* that budget, not beside it. Size the backoff against 300s minus the submit path, and
  fail the attempt to `failed` rather than run the ceiling down.
- **Hobby cannot raise `maxDuration` past 300s.** There is no `maxDuration` escape hatch to reach for
  when scoring gets slower; the next move would be a plan change, and it should be a deliberate one.

`after` also runs when the response did not complete successfully — including a thrown error, a
`redirect` or a `notFound`. A scoring attempt is therefore dispatched even on a submit that failed
after the row was written, which is the behaviour this design wants: the attempt row already exists,
and `run` is idempotent.

**As built (#50).**

- **"In flight" is a claim on the row, not a status.** A run starts by setting
  `scoring_attempts.run_started_at = now()` in one conditional update — the attempt is `pending`, and
  the column is null or older than **300 s** (`04`). Losing that update while the row is still `pending`
  is the `409`. 300 s is the invocation ceiling above: no run outlives it, so an older claim belongs to
  a function that is dead, and the next call takes the attempt over. `submit`'s `after()` claims the
  same way, so a History retry cannot double-score an answer whose first run is still going. There is
  still no `running` status: the attempt stays `pending` until it is `ok` or `failed`.
- **Stamp 4 is written again when the attempt turns `ok`**: `model_id` and `scoring_prompt_version`
  become the scorer's that produced the scores, in the transaction that writes them. An attempt is
  stamped when its row is written, and a `pending` one can now be run days later, after the pin has
  moved; scored then, it must not carry the old model's name (refusal #5). The other three stamps are
  the round's and the question's and never move, and a `failed` attempt keeps what it was given.
- **A run that spends its retries answers `502 scoring_failed`**, with `detail` carrying the attempt,
  the answer and the `error_class`. The row is `failed`, and §5.11 can retry it again.
- **A finished attempt is returned as it stands** with `200` and no model call — `ok` with its scores,
  `failed` with its status alone. The response carries `answer_id` beside `attempt_id`.
- **While a realistic round is still in progress the response is `attempt_id`, `answer_id` and
  `status` only.** The scores are written; they are not returned, because that round shows no score,
  flag or hint until it ends (US-8, §5.5), and this route is no way around that.
- **Another user's attempt is `404`**, and so is an id that is not a uuid.
- **It never touches `round_feedback`** (§5.12): no code path from here reaches the generator.

### 5.11 `POST /api/scoring-attempts` ⚡

Retry a failed score from History. **A new attempt row, never an overwrite** (PRD §9, `04`).

```http
POST /api/scoring-attempts
{ "answer_id": "c001e8a2-…" }
```
```json
201
{ "attempt_id": "s907…", "answer_id": "c001e8a2-…", "status": "pending",
  "is_superseding": true,
  "stamps": { "cv_version_id": "3f2a91c4-…", "rubric_version_id": "b110…",
              "generator_prompt_version": "set-piece-ja-1.0",
              "model_id": "gpt-5.6-sol", "scoring_prompt_version": "score-ja-1.0" } }
```

`is_superseding: true` — this attempt is meant to become the displayed score, unlike a held-out
re-score. Then `POST /api/scoring-attempts/{id}/run`.

`422 scoring_not_retryable` when the answer's latest attempt is `ok` or `pending`. **A successful
score is not re-rollable from the UI** — that is the per-session model picker rejected in the
decision log arriving by a different door. Re-scoring an `ok` answer happens only through the
held-out harness, which writes `is_superseding: false` and never changes a displayed score (`04`).

**As built (#50).** The body is `answer_id` and nothing else — any other key is a `400` naming it, a
stamp most of all (§1 rule 6). The stamps are the server's: the CV and rubric versions are **the
round's**, stamp 3 is the question's — or, for a follow-up's answer, the follow-up's `prompt_version`
— exactly as on the first attempt, and the model and scoring prompt are **the ones pinned today**. A
retry made after either changed is therefore scored by the new one and lands on the new side of
Progress's boundary; it is not a way to re-score under the old model. The latest attempt is read and
the new row written under a lock on the answer's row, so two retries of one answer cannot both see
`failed` and both insert. A `pending` attempt is not replaced: `run` (§5.10) drives it as it is.
`detail` on the `422` carries the latest attempt's id and status.

### 5.12 `POST /api/rounds/{roundId}/complete` ⚡

Records the felt-pressure rating, closes the round, and generates the round feedback. One endpoint,
deliberately. **⚡ since 2026-09-27**: it calls a model, so it gets its own bucket (§1 rule 5).

```http
POST /api/rounds/77af0b13-…/complete
{ "felt_pressure": 4 }
```
```json
201
{ "round": { "id": "77af0b13-…", "completed_at": "2026-09-12T03:41:08Z", "felt_pressure": 4 },
  "feedback": {
    "to_fix": [ { "title": "数字の出どころを先に言う", "body": "…" },
                { "title": "結論を最初の一文に置く", "body": "…" } ],
    "what_worked": "困難だった点を具体的な場面で説明できていました。",
    "untouched_claim_ids": [ "9c57…", "9c63…" ],
    "body_translated": {
      "language": "en",
      "to_fix": [ { "title": "Say where the number comes from first", "body": "…" },
                  { "title": "Put the conclusion in the first sentence", "body": "…" } ],
      "what_worked": "You explained the difficulty with a concrete situation." },
    "language": "ja", "model_id": "gpt-5.6-sol", "prompt_version": "feedback-ja-1.1" },
  "scoring": { "ok": 10, "pending": 0, "failed": 0 },
  "model_answers": { "written": 10, "failed": 0, "pending": 0 } }
```

**`body_translated` is the English toggle of a Japanese round's feedback** (PRD §4): the same
findings, item for item and in the same order, in English. It is `null` on an English round, whose
feedback is already English.

**A practice round sends an empty body, `{}`**, and gets the same `201` with `felt_pressure: null`.

**Why the rating and the completion are the same call:** `04` requires `felt_pressure` to be captured
**before any feedback**, and one endpoint makes that ordering structural rather than a rule someone
has to remember.

**In this order, and never inside one transaction with the model** (`06`, 2026-09-27):

1. **One transaction writes `felt_pressure` and `completed_at`, and commits.** The rating is on record
   before anything else happens, whatever happens next.
2. **Wait for the round's pending scores**, bounded, inside the route's 300 s. **The bound is 60 s**
   (`COMPLETE_WAIT_BOUND_MS`), set from the round loop's latency measurement (`03` §4, 2026-10-01):
   scoring's slowest call was 38.1 s against a 7.1 s median, so 60 s covers that call, a 2 s backoff
   and a median retry, and with the feedback call's own 120 s timeout it stays inside the route's 285 s
   deadline. A unit test holds the sum under the deadline. Screen 7 is where most of the wait has
   already been spent.
3. **Generate the round feedback, outside any transaction** — from every answer's scores and flags,
   and the never-cited claims of the round's CV version, from which the model picks two or three
   relevant ones as untouched material. Their ids are validated against that set. **A Japanese
   round's call returns the English translation with the feedback**, and a result whose translation is
   missing or does not match the feedback item for item is refused as malformed, like one with four
   things to fix (`06`, 2026-10-03).
4. **Write `round_feedback`**, whole, once — the translation in `body_translated`, in the same row.

**Step 3's CV material, as built (#46).** Each answer is sent with its unsupported spans — the quotes
sliced from `transcript_corrected` by the stored spans of its latest `ok` attempt, not the scorer's
wording. **The never-cited set is the round's** (`04` `round_feedback`): the CV version's citable
claims minus any claim an answer in this round cited, with either relation. It is sent as a numbered
list, and the model returns numbers in `untouched`; a number that names no claim it was shown is
dropped, a repeat is ignored, and anything past the third is dropped. **What survives is stored — none,
one, two or three ids** — and the feedback is written either way: a bad pick is not a reason to refuse
findings that are otherwise whole. The `round_feedback_written` log line carries `never_cited`,
`untouched` and `untouched_dropped`. The feedback prompt version bumped with this, to
`feedback-en-1.1`; a Japanese round's `feedback-ja-1.0` picks untouched material from its first
version (#43). Both bumped again with follow-ups (#44), whose answers they read, to `feedback-en-1.2`
and `feedback-ja-1.1`.

**Model answers are written beside steps 2 to 4, and never fail the call** (#74, `06`, 2026-10-04).
The moment step 1 commits, one model call starts for **every submitted answer of the round that is not
a practice retry** — each bank question and each follow-up — all at once, each on its own. A call
reads the round type and role context, the rubric's dimensions with their best anchors, the citable
claims of the round's CV version, the question as it was asked, and the **corrected** transcript; a
follow-up's call also reads the question it followed and that answer. **It reads no score**, so it
waits for none, and an answer whose scoring failed has a model answer too.

- **What comes back is the answer and the parts of it the CV does not back**, each quoted verbatim
  with a start hint. The server finds each quote in the answer and stores its span; one it cannot find
  is dropped and counted, never clamped (`03` §11). The server then adds a span for each digit figure
  neither the CV text nor the user's own answer holds (`04` `model_answers`). A Japanese round's call
  returns the same answer in English with its own quotes, stored in `body_translated`; a result
  without the translation is refused as malformed, as feedback's is.
- **Each call is bounded at 90 s** (`MODEL_ANSWER_TIMEOUT_MS`, from `03` §4's measurement, 2026-10-04:
  the slowest call seen was 31.6 s), with no retry here.
- **The feedback is never held for one.** `complete` waits for the model answers **no longer than
  45 s from step 1's commit** (`MODEL_ANSWER_WAIT_MS`; the slowest of ten measured rounds took 31.6 s),
  and that time runs beside steps 2 and 3, not after them: once step 4 is done and the 45 s are up,
  the response goes out. A call still running then is `pending`; it finishes in `after()` and its row
  is written there, inside the route's 300 s. A unit test holds the wait under the call's bound and
  under step 2's 60 s plus step 3's 120 s.
- If a call outlives that wait and the user presses §5.19's retry before its row lands, both calls
  can run; whichever commits first keeps the one stored model answer.
- **The rows are written after step 4**, in one transaction of their own with `on conflict do
  nothing` (`04` `model_answers`) — and written **whether or not the feedback was**: a round whose
  feedback failed still gets its model answers, and the `502` below does not carry the count.
- **`model_answers` reports what happened**: `written`; `failed` — the calls that failed, or every
  one if the write did; and `pending` — the calls not waited for. A failure is a log line
  (`model_answer_call_failed`, with ids and the error class) and a gap on screen 8, which §5.19
  fills. The log line `model_answers_generated` carries counts, tokens and the duration, and nothing
  a model wrote (`12` §7).

**If step 2's bound runs out or step 3 fails**, no `round_feedback` is written: it is one row, never
rewritten, and feedback from an incomplete set of scores would be permanent (`04`). The response is
`502 feedback_generation_failed`; **the round is still complete, with its rating.** The feedback screen
shows every score that landed and a pending round-level note, and generation is retried through
§5.16. Generating from whatever scores exist was rejected for the same reason (`06`, 2026-09-27).

- `mode = 'realistic'` and no `felt_pressure` → `422 pressure_required`.
- `mode = 'practice'` and a `felt_pressure` → `422 pressure_not_applicable`. The check constraint is
  the backstop. **A practice round is completed the same way, without a rating**, and gets the same
  round feedback (`06`, 2026-09-27).
- **The feedback is written from the answers the round asked for** — each question's first answer and
  its follow-up's (#49, `06`, 2026-10-04). An answer given again in practice (§5.6) is scored and
  shown on its own. When an original answer scored, retries are not waited for, counted or sent to
  the feedback call. When none scored, scored retries are used instead, with prompt versions
  `feedback-en-1.3` and `feedback-ja-1.2`.
- Already complete → `409 round_already_complete`, with `detail.has_feedback` saying whether the
  feedback exists. The envelope's `detail` is flat (§2), so it cannot carry the feedback itself;
  screen 8 reads it from the round (`06`, 2026-10-01).
- Not all answers submitted → `409 round_not_complete`. A position counts once its question is
  submitted and its follow-up is either answered or `missing`; a follow-up unanswered, or not stored
  yet, keeps the round open.
- Abandoned (§5.5) → `409 round_abandoned`. **An abandoned round is never completed**, and nothing is
  written.
- Feedback could not be generated → `502 feedback_generation_failed`, as above.
- **No answer scored and none is pending** — every answer's latest attempt ended `failed` → `502
  feedback_generation_failed` with `detail.error_class = "no_scores"`, and no model call. Feedback is
  never generated from transcripts alone, and this slice has no re-score (History's, §5.11), so the
  §5.16 retry refuses the same way. **Screen 8 derives the state from the latest attempts** and states
  that no answer in the round could be scored, so its findings are unavailable — it offers no retry
  that cannot succeed.

**`scoring` reports what is in.** The feedback screen states anything pending plainly rather than
spinning (`03` §5, §8). **A score that ended `failed`** (its three retries spent, `03` §8) is not
pending, so step 2 does not wait for it: **the feedback is generated without that answer**, the answer
is marked unscored on the feedback screen, and History offers a retry **for that answer alone**
(§5.11) — which never regenerates the round feedback (`06`, 2026-09-28). **That answer never reaches
the generator**: only answers whose latest attempt is `ok` are sent. Holding the feedback until
the retry was rejected: the user would leave the machine without it.

**An abandoned round is never completed and never cleaned up.** There is no endpoint to abandon one:
`completed_at is null` *is* the record, and an abandoned round is evidence about pressure, not
garbage (`04` §5).

### 5.13 `GET /api/rounds`

History's list. Cursor-paginated per §4.

```
GET /api/rounds?limit=20&language=ja&round_type=behavioural
```
```json
200
{ "items": [
    { "id": "77af0b13-…", "round_type": "behavioural", "language": "ja", "mode": "realistic",
      "length": 5, "started_at": "2026-09-12T03:04:51Z", "completed_at": "2026-09-12T03:41:08Z",
      "status": "complete",
      "answers": 10, "scoring": { "ok": 9, "pending": 1, "failed": 0 },
      "stamps": { "cv_version_label": "応募書類 v3", "rubric_version_label": "v1.2",
                  "scoring_model_ids": ["gpt-5.6-sol"] } } ],
  "next_cursor": "eyJzIjoiMjAyNi0wOS0xMlQwMzowNDo1MVoiLCJpIjoiNzdhZiJ9" }
```

Every row names the round's CV and rubric and the models behind its displayed scores; History detail
names the generator versions as well (`10` §10). Progress draws the boundary where any scored answer's
stamp changed (refusal #5). `status` is the derived `in_progress` / `abandoned` / `complete` of §5.5 —
what History's `Abandoned` line reads (`10` §10).

**As built (#50).**

- **`scoring_model_ids` is a list** — *amended from `scoring_model_id`.* Each answer displays a score
  only when its latest attempt succeeded. A retry made after the pinned model changed (§5.11) is scored
  by the new one, so a round can carry two. One string would put the round on one side of a boundary it
  straddles. The list is every model behind the round's **displayed** scores,
  sorted. Pending and failed attempts produced no displayed score, so their models are excluded; the
  list is empty when no answer has an `ok` score.
- **`answers` counts submitted answers**, follow-ups' and practice retries' included, and `scoring`
  counts them by their latest attempt. They are counts of answers, never anything computed from a
  score (refusal #1).
- **`status` is judged at request time on the Asia/Tokyo day** (§5.5; `06`, 2026-09-28), with the
  newer-round test made in SQL so Postgres's microseconds are compared, not a JavaScript `Date`'s
  milliseconds.
- **The cursor keeps `started_at` to the microsecond** for the same reason: two rounds inside one
  millisecond would otherwise be skipped or repeated. It is base64url, so it needs no escaping in a
  query string. Anything this server did not mint — wrong shape, wrong timestamp form, a timestamp
  that is not a real instant, an id that is not a uuid — is `400` naming `cursor`.
- **A parameter sent twice is a `400`** naming it, like an unknown one (§4): there is no single value
  to honour. `limit` outside 1–100, or not an integer, is a `400` too, never clamped.
- **History's first page is read by the page itself**, as a Server Component, through the same
  function this handler calls (§1); the client calls this route for the older pages only.

### 5.14 `GET /api/answers/{answerId}/audio`

Mints a short-lived presigned GET for playback (PRD §144, `03` §9 — audio is read through
short-lived presigned GETs only).

```json
200
{ "url": "https://suburi-audio.s3.ap-northeast-1.amazonaws.com/prod/…?X-Amz-Expires=300&…",
  "expires_at": "2026-09-12T04:20:00Z", "duration_ms": 94120 }
```

`404 audio_missing` when `audio_s3_key` is null or the object is gone. **The play control must
tolerate a missing object** (`04` §5) — a dangling key is a missing recording, not a broken page.

**As built (#50).** The URL lives **300 s** — a four-minute take and a minute over — and is minted when
the row is opened, never stored. **The object is checked with a `HEAD` before the URL is signed**, since
a presigned URL is only arithmetic and would be handed out for a key that points at nothing. The
environment's IAM user has `s3:GetObject` and no `s3:ListBucket` (`12` §3 step 5), and S3 answers a
`HEAD` for an absent key with `403` in that case, not `404`: **both are read as missing.** The key is
the server's own, under its own prefix, so a `403` there cannot mean another caller's object. Any other
failure is `502 upstream_s3`, logged by its error class and never with the key. Another user's answer is
`404 not_found`. The browser's own failure to play what it was given — an expired URL, a truncated
upload — is handled by the control, which says the recording could not be played.

### 5.15 `GET /api/rounds/{roundId}/speech` ⚡

Realistic mode's spoken question (`06`, 2026-09-27). Streams audio synthesised by the pinned TTS model
for **one prompt of this round**, named by position and kind — never by text.

```
GET /api/rounds/77af0b13-…/speech?position=2&kind=question
```
```
200
Content-Type: audio/mpeg
<streamed audio>
```

**The server reads question text** from `round_questions` at that position; the client sends none, so
the route cannot be used to synthesise anything else on the user's key (§1 rule 6). A `practice` round
or a position with no prompt is `404`. **Every `follow_up` request is still `404`:** #44's
`follow_ups` exists, and the route does not read it yet (`06`, 2026-10-04), so screen 3 asks for no
audio while a follow-up is on screen. When it does, it reads the text from the parent's `follow_ups`
row, with a `missing` one still `404`. Question audio is well under the 4.5 MB body cap, so it crosses the function; it is **not
retained** (`03` §4), and the response is `Cache-Control: no-store` so the browser keeps none either.

**The query is validated like a body** (§1 rule 3). `position` is 1–7 and `kind` is `question` or
`follow_up`; anything else, a `text` parameter included, is `400 invalid_request` naming the field.

**The model is `TTS_MODEL` in `lib/ai/models.ts`**, with its voice beside it (`03` §4, `06`, #45).
Synthesis has 10 s to reach its first byte.

**When synthesis fails, the round goes on** (`06`, 2026-09-28). The route returns `502
speech_failed`; screen 3 shows that code's copy as a short notice, and the question, already on screen
as text, is answered as usual. The failure is logged with the round id, position and error class. A
realistic round is never stopped for want of a voice. The route reads the first audio byte before it
answers, so a stream that fails or stalls before that byte is still the `502`; one that breaks after
it can no longer be, and is only logged, the same way.

### 5.16 `POST /api/rounds/{roundId}/feedback` ⚡

The retry path for §5.12's step 3, and nothing else — the way §5.10's `run` is for a score. Only a
**complete** round **with no `round_feedback`** is accepted; it waits, generates and writes exactly as
§5.12 steps 2–4 do.

```json
201
{ "feedback": { "to_fix": [ … ], "what_worked": "…", "untouched_claim_ids": [ … ],
                "body_translated": { "language": "en", "to_fix": [ … ], "what_worked": "…" },
                "language": "ja", "model_id": "gpt-5.6-sol", "prompt_version": "feedback-ja-1.1" } }
```

A round with feedback returns it with `200` and makes no model call. An incomplete round is
`409 round_not_complete`. Failure is `502 feedback_generation_failed` again, and the note stays
pending.

### 5.17 `GET /api/cron/self-check`

The daily monitoring job (`12` §6), called by Vercel Cron (`vercel.json`) at `0 19 * * *` UTC —
between 04:00 and 04:59 in Tokyo, given Hobby's hour of jitter. **No session: the caller proves itself
with `CRON_SECRET`**, which Vercel sends as `Authorization: Bearer <CRON_SECRET>` (verified
2026-09-30 against Vercel's *Managing Cron Jobs*, `06`). The comparison is constant-time.

```http
GET /api/cron/self-check
Authorization: Bearer <CRON_SECRET>
```
```json
200
{ "run_id": "5b0c…", "job": "self-check", "created_at": "2026-09-30T19:12:40Z", "red": 1, "readings": 10 }
```
```json
401
{ "error": { "code": "unauthenticated", "message": "Missing or wrong cron secret.", "detail": {} } }
```

**It first writes the daily dump** (`12` §8, #56) to `backups/` with the backup-writer's key, where
that key is set (production only, `12` §2). The dump never fails the run: its outcome is the
`backup_dump_failed` reading, and its own log line carries the key, size, duration and error class
only. Then it reads every `12` §6 row it covers, for every user, and **appends one `cron_runs` row
with its `cron_readings` in one transaction** (`04`). Nothing is updated; a run that fails writes nothing and
returns `500`, and the status page's staleness line is how that shows (`10` §14). The response carries
the run id, time and counts; the log also carries the duration — never a reading's subjects' text, which the run
does not hold in the first place (`12` §7).

**`401` when `CRON_SECRET` is unset**, whatever the header says: an unset secret must not mean
"anyone may run it". It is set in Production only (`12` §2), and Vercel invokes crons only for
production deployments (`06`, 2026-09-30), so on `develop` the route exists and refuses every call.
Locally, set it in `.env.local` to run the job by hand.

**Not rate-limited** (§1 rule 5 is for the ⚡ routes, keyed by session): it calls no model and holds no
session, and a caller without the secret is refused before the database is read.

### 5.18 `GET /api/cron/digest`

The weekly job (`12` §6), at `0 20 * * 0` UTC — Monday between 05:00 and 05:59 in Tokyo, so the week
it reports has ended. Authenticated exactly as §5.17. It appends a `digest` run whose readings are the
week's rounds started and completed, tokens in and out, and spend, over **the Asia/Tokyo week (Monday
00:00 to Monday 00:00) that ended before the run**. The same response shape, with `red: 0`: a digest
reports, it does not judge. **Its near-duplicate figures** (#47; `06`, 2026-09-29) read
`near_duplicate_checks` over the same week: how many questions went into the bank beside a neighbour,
the lowest, median and highest similarity among them, and how many candidates were reused (`04`
`cron_readings`).

---

### 5.19 `POST /api/rounds/{roundId}/model-answers` ⚡

Writes the model answers a **complete** round still lacks, and nothing else (#74) — the calls that
failed at `complete` (§5.12), or all of them for a round completed before model answers existed. It
generates and stores exactly as §5.12 does, for only the answers with no `model_answers` row. No body.

```json
201
{ "model_answers": { "written": 2, "failed": 0 } }
```

- **Nothing lacking → `200`** with `{ "written": 0, "failed": 0 }` and **no model call**. An answer that
  has a model answer never gets a second: the row is written once (`04`).
- Any call failed → `502 model_answer_generation_failed`, with `detail` `{ round_id, written, failed,
  error_class }`. **What succeeded is stored** — `written` says how many — and a further retry asks
  only for the rest.
- The write failed → `500 write_failed`; nothing was half-written.
- Not complete → `409 round_not_complete`. Another user's round, or an id that is not a uuid → `404`.

**It never touches a score, the feedback, or an existing model answer**, and takes no input: which
answers, which CV version and which prompt are all the round's own (§1 rule 6).

## 6. Endpoints that do not exist, and must not be added

Stated so a later session recognises these as refusals, not gaps. Each one, if added, would quietly
convert a guarantee in `04` §6 into a preference.

| Not built | Why |
| --- | --- |
| `DELETE` on anything | Nothing is hard-deleted (`04` §5). A scoring record you can quietly delete is one you will delete after a bad round, and the chart stops being honest (refusal #3, brief). |
| `PATCH /api/answers/{id}` | The route by which `transcript_raw` gets overwritten by its correction (`04` §6). |
| `PUT /api/cv-versions/{id}` | Every span in the database indexes into `body`. A change is a new version. |
| Anything that edits or deletes a **document** or a **claim** | Same reason, one level down. `cv_documents` ranges and `cv_claims` spans both index into the same immutable `body` (`04`). A document is changed by saving a new version of the whole set. |
| Anything that makes an older CV version current, or lets a round choose one | Current is `max(created_at)` per language and nothing else (`04`). A selectable CV version would make the CV stamp a user choice, which is the same failure as a model or rubric selector two rows down. |
| Any endpoint returning a composite score | Refusal #1. No column, no view, no field. |
| `POST /api/rounds/{id}/abandon` | `completed_at is null` is the record. Abandonment is data, and derived (`04` `rounds`). |
| Anything that changes a round's questions after it starts | `round_questions` is fixed with the round (`04` §6). A re-roll is how a question the user has already heard gets swapped for an easier one. |
| A speech route that takes text | §5.15 defines the server-side prompt source. One that took text would be a general TTS proxy on the user's key. |
| Anything that regenerates, edits or replaces a model answer | `model_answers` is written once per answer (`04` §6). A regenerate button turns a stored reference into something re-rolled until it flatters, and what is reviewed later would no longer be what the round ended with. §5.19 writes only what is missing. |
| A model or rubric selector on any request | The stamps would become user-chosen, making drift voluntary and biased (decision log). Both are config and resolved server-side. |
| Anything with a `share`, `visibility`, `export` or `public` in it | Refusal #6. Multi-tenancy is not permission to build a sharing surface (`03` §2, `08` §7). |
| `POST /api/questions` | The bank is written by generation with the near-duplicate guard, or by seed. A hand-inserted question skips the embedding check and fragments the measurement (`03` §11). |
| An admin route of any kind | There are no roles (`08` §4). |

---

## 7. What this document leaves open

- ~~The scoring dispatch trigger~~ and ~~the transcription model id~~ — **both closed 2026-09-12.**
  The trigger is `after()` inside `submit` (§5.10); the model is `gpt-transcribe` at $0.0045/minute
  (`03` §4), and §5.7's response carries the real string.
- **The near-duplicate threshold** used in §5.4. **Starts at cosine similarity 0.90** (`06`,
  2026-09-27) — an unverified guess until there is real data; see §5.4 and `04`. Since #47 the data is
  being collected: `near_duplicate_checks`, reported weekly.
- ~~**The TTS model and synthesis failure.**~~ **Resolved:** the pinned model and voice are in `03`
  §4; §5.15 specifies the text fallback and `speech_failed` response.
- ~~**`complete`'s wait bound**~~ — **set 2026-10-01** at 60 s, from the round loop's latency
  measurement (§5.12 step 2, `03` §4).
- ~~**Round feedback when a score ended `failed`**~~ — **decided 2026-09-28**: generated without that
  answer, which is marked unscored and retried alone (§5.12).
- ~~**A database failure mid-write**~~ — **decided 2026-09-28**: `write_failed`, `500`, on every round
  route, and the round stays resumable (§3).
- **Whether a model answer's marks need a second, checking call.** The call that writes a model
  answer names what the CV does not back in it, and the server checks its digit figures on its own
  (`04` `model_answers`); nothing independent verifies the rest (`06`, 2026-10-04 and 2026-10-05).
  Left as it is until real rounds show a miss.
- ~~**Each round route's rate limit**~~ — **set by #42** for the routes it built (§1 rule 5); a later
  slice's ⚡ route adds its own there. **#50 set History's two** (`scoring-attempts`, `scoring-run`).
- ~~**User-facing copy for every code in §3.**~~ **Closed in #13:** `lib/copy/errors.ts` owns the
  bilingual catalogue. `11-testing-plan.md` checks it against §3, and its Japanese strings passed a
  native read on 2026-09-21 (`05-design-system.md` §6).
- ~~**The per-session rate limiter's mechanism.**~~ **Decided in #18** (2026-09-22): a Postgres fixed
  window per `(session, route)`, checked against Vercel's current WAF documentation first. §1 rule 5.
- ~~**The text-size cap on `POST /api/cv-versions`.**~~ **Decided in #20** (2026-09-23), from the
  measured call on the real documents: `ja` 30,000 and `en` 45,000 code points, refused as
  `422 cv_too_large` before any model call. §5.2, and `03` §4 for the measurement.
