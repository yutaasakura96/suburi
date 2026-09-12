# API design — Suburi

**Date:** 2026-09-12
**Status:** Phase 4b. Tier 2, triggered: there is a real API surface — the round loop is client-driven
and audio never crosses a function, so the browser talks to endpoints.

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
| `GET /api/rounds/{roundId}` | Resume after a refresh mid-round; the client reconciles its own state against it. |
| `GET /api/rounds` | History's cursor-paginated list. |
| `GET /api/answers/{answerId}/audio` | Mints a short-lived credential on demand, at play time. |

Everything else — Home's intervals, Progress's trends, History detail, the feedback screen — is a
Server Component reading Postgres directly. **The feedback screen in particular is a read** (`03` §3):
by round end the scores are already rows.

### Rules that apply to every endpoint

1. **Session required.** No public endpoint exists except Better Auth's own. Enforced in middleware
   *and* re-asserted inside the handler (`08` §5) — middleware's matcher is not a security boundary.
2. **Every query is scoped by the session's `user_id`.** A row belonging to another `user_id` is
   `404`, never `403`: the API does not confirm that someone else's id exists.
3. **Zod at the boundary, server-side.** Client validation is for feedback speed and counts for
   nothing (`03` §9).
4. **No `403` anywhere.** There are no roles (`08` §4). Unauthenticated is `401`; not yours is `404`.
5. **Rate-limited per session on every route that calls a model** — marked ⚡ below (`03` §9, second
   worst thing an attacker could do).
6. **The client never chooses an S3 key, an object prefix, a `user_id`, a `position`, an
   `is_first_attempt`, or any version stamp.** All are server-derived. This is not defensive coding;
   it is what makes the four stamps and first-attempt uniqueness trustworthy.

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
be the Japanese one; and **the bilingual chrome rule is still open** (`CONTEXT.md`) — routing all user
text through the copy layer means this document does not accidentally decide it.

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
| `502` | Upstream failed — OpenAI or S3 | envelope, `code` names which |
| `503` | Preflight says the scorer is unavailable | envelope, `code: "model_unavailable"` |

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
| `question_generation_failed` | 502 | `POST /api/rounds`, `/answers` | screen 2 / screen 3 |
| `presign_failed` | 502 | `POST …/answers` | screen 3 |
| `upload_too_large` | 422 | `POST …/answers` | screen 3 — before recording |
| `unsupported_content_type` | 422 | `POST …/answers` | screen 3 |
| `audio_missing` | 404 | `transcribe`, `audio` | screen 4 / History playback |
| `transcription_failed` | 502 | `transcribe` | screen 5 — keep take, retry or type |
| `transcript_already_final` | 422 | `transcribe`, `transcript` | screen 5 |
| `answer_already_submitted` | 422 | `submit` | screen 6 |
| `followup_generation_failed` | 502 | `submit` | screen 6 — answer is saved |
| `scoring_failed` | 502 | `scoring-attempts/{id}/run` | screen 8 — stated as pending |
| `scoring_not_retryable` | 422 | `POST /api/scoring-attempts` | History |
| `pressure_not_applicable` | 422 | `complete` | — (a client bug in practice mode) |
| `pressure_required` | 422 | `complete` | screen 7 |
| `round_already_complete` | 409 | `complete`, `answers` | — |
| `round_not_complete` | 409 | `complete` | screen 7 |
| `cv_extraction_failed` | 502 | `POST /api/cv-versions` | CV screen |
| `upstream_s3` / `upstream_openai` | 502 | any | per the table in `03` §5 |

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

The four-call shape the loop settles into, per answer:

```
POST /api/rounds/{id}/answers            → answer_id + presigned PUT
PUT  <presigned url>                     → S3, direct from the browser
POST /api/answers/{answer_id}/transcribe → transcript_raw
POST /api/answers/{answer_id}/submit     → scoring dispatched + the next prompt
```

**The answer row is created at presign, not at submit.** That is what makes `transcribe` and `submit`
idempotent: they address a row that already exists, so a double-click, a retried fetch or a flaky
connection cannot produce a second `answers` row. Given `answers_first_attempt_uniq` and the
never-overwrite rule (`04`), a duplicate row is not an annoyance — it is a corrupted measurement.

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

Upload a CV version and extract its claims. JSON, not multipart — the client extracts text from the
file; a Vercel function caps bodies at 4.5 MB and a CV is text (`03` §3).

**Immutable on arrival.** There is no `PUT`, `PATCH` or `DELETE` for this resource, in this version or
any later one: every `cv_claims.span_start/end` in the database indexes into `body`, and every quote
ever rendered is a slice of it (`04`).

```http
POST /api/cv-versions
{ "version_label": "職務経歴書 v3", "language": "ja",
  "body": "…経理システムの刷新を主導し、請求処理を40%短縮。チーム5名を統括…",
  "source_filename": "keirekisho_v3.docx" }
```
```json
201
{ "id": "3f2a91c4-…", "version_label": "職務経歴書 v3", "language": "ja",
  "created_at": "2026-08-30T09:14:22Z",
  "extractor_model_id": "gpt-5.6-sol", "extractor_prompt_version": "cv-extract-ja-1.0",
  "claims": { "total": 34, "carried_forward": 27, "new": 7 },
  "validation": { "spans_checked": 34, "spans_rejected": 0 } }
```

**`carried_forward` is `04`'s exact-match rule and nothing more** — byte-identical
`text_normalised` against the immediately previous version. No fuzzy matching, no threshold, no
review step. A reworded claim is honestly a different thing to cite.

**`spans_rejected` is the anti-hallucination counter.** A claim whose span falls outside `body`, or
whose sliced text does not match what the extractor said it extracted, is dropped — not stored,
not shown. A non-zero count on a real CV is the first thing to look at, because CV extraction quality
is explicitly unmeasured (`CONTEXT.md`).

Failures: `502 cv_extraction_failed` — **nothing is written**, the version is not created, and the
user re-uploads. A CV version with half its claims is worse than none.

### 5.3 `POST /api/role-contexts`

```http
POST /api/role-contexts
{ "kind": "researched", "company_name": "株式会社サンプル", "role_title": "経理マネージャー",
  "body": "…上場準備中。管理会計の立ち上げが直近の課題…" }
```
```json
201
{ "id": "8b4c…", "kind": "researched", "company_name": "株式会社サンプル",
  "role_title": "経理マネージャー", "created_at": "2026-09-12T03:02:00Z" }
```

`kind: "general"` requires `company_name`, `role_title` and `body` to be absent — `400` otherwise.
General practice is a real row, not a null foreign key (`04`).

### 5.4 `POST /api/rounds` ⚡

Starts a round. Preflights the model, resolves the rubric, selects or generates question 1, returns
the round with its first prompt.

**The client sends the five choices from screen 2 and nothing else.** `rubric_version_id` is resolved
server-side to the newest rubric for the round's language — two rubrics, not one with a flag (`04`).
`per_answer_cap_seconds` is derived from `mode`: 240 realistic, `null` in the row for practice with a
15-minute runaway guard applied client-side (`03` §7). **Neither is a request field**, because a
client-chosen cap is a client-chosen stamp.

```http
POST /api/rounds
{ "round_type": "behavioural", "language": "ja", "mode": "realistic", "length": 5,
  "cv_version_id": "3f2a91c4-…", "role_context_id": "8b4c…" }
```
```json
201
{ "round": {
    "id": "77af0b13-…", "round_type": "behavioural", "language": "ja", "mode": "realistic",
    "length": 5, "per_answer_cap_seconds": 240,
    "started_at": "2026-09-12T03:04:51Z", "completed_at": null,
    "stamps": { "cv_version_label": "職務経歴書 v3", "rubric_version_label": "v1.2",
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

**Question selection, and the near-duplicate guard.** A bank question from the
`(user_id, language, round_type) where retired_at is null` slice, or a generated one. On generation,
the question is embedded and compared by cosine distance within the same slice; **above threshold the
existing row is reused instead of inserted** (`04`, `03` §11). Every near-miss is logged with its
score — the threshold is a guess until there is real data, and the log is what tunes it, not
intuition.

Failures: `503 model_unavailable` (preflight — the round is not created);
`502 question_generation_failed` (nothing created).

### 5.5 `GET /api/rounds/{roundId}`

Resume. `03` §7: a round survives a refresh, because every answer is written server-side at submit,
so the round's position is a database fact.

```json
200
{ "round": { "id": "77af0b13-…", "mode": "realistic", "length": 5, "completed_at": null, "…": "…" },
  "answers": [
    { "id": "c001…", "position": 1, "kind": "question", "state": "submitted",
      "scoring": { "attempt_id": "s900…", "status": "ok" } },
    { "id": "c002…", "position": 1, "kind": "follow_up", "state": "submitted",
      "scoring": { "attempt_id": "s901…", "status": "pending" } },
    { "id": "c003…", "position": 2, "kind": "question", "state": "uploaded" } ],
  "prompt": { "kind": "question", "position": 2, "question_id": "a22b…", "text": "…", "speak": true },
  "resume": { "at": "transcribe", "answer_id": "c003…" } }
```

`state` is derived, not stored: `open` (row exists, no audio) → `uploaded` (`audio_s3_key` set) →
`transcribed` (`transcript_raw` set) → `submitted` (`transcript_corrected` set). `resume.at` tells the
client which of the four calls to make next.

**An in-flight recording is the one thing that does not survive** (`03` §7), and the UI says so before
recording. A resumed round whose newest answer is `open` simply re-records it.

### 5.6 `POST /api/rounds/{roundId}/answers`

Opens an answer slot and presigns the upload. Creates the `answers` row.

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

**Idempotency.** If the current position already has an answer row with `transcript_corrected is
null`, that row is returned with a **fresh** presigned URL — same `answer_id`, no new row. So a
re-record, an expired URL, or a double-clicked 録音 button all land on the same row.

**A practice retry is the one case that deliberately creates a second row:** `{ "retry_of_answer_id":
"c003…" }` in the body bypasses the reopen rule and writes a new answer with `retry_of_answer_id`
set. **It takes the same `position` as the answer it retries** — so the round still renders in
order with the retry grouped beside its original, ties broken by `created_at`. This is why
`answers (round_id, position)` is not unique in `04` §3, and it must not be made unique.
`is_first_attempt` stays on the original, always (PRD §9, refusal #3).

**`position` is assigned under `select … for update` on the `rounds` row.** Two concurrent opens must
not both claim position 2.

**`is_first_attempt` is computed here, not asserted by the client**: true iff `mode = 'realistic'`,
the prompt is a bank question, and no row yet holds it for this `(question_id, language)`. The partial
unique index is the backstop — if it fires, that is a `422`, and it means this computation was wrong.

Failures: `422 upload_too_large` (checked *before* recording, against `max_bytes`);
`422 unsupported_content_type`; `409 round_already_complete`; `502 presign_failed`;
`502 question_generation_failed` when the next prompt had to be generated and could not be.

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
            "text": "その40%という数字は、どう測ったものですか。", "speak": true },
  "progress": { "position": 2, "of": 5 } }
```

**Both transcripts persist and the diff is data** (`04`, decision log Phase 2). `rewrite_magnitude` is
computed server-side and returned so screen 6's meter and the stored value cannot disagree.

**Scoring is dispatched here, not at round end.** `03` §3: scoring sixteen answers in one burst at
round end would put a reasoning model on the critical path of a screen PRD §9 requires to render while
the user is still at the machine. So `submit` creates the `scoring_attempts` row — `status:
'pending'`, all four stamps written — and returns immediately. By round end, all but the last score
are already rows and the feedback screen is a read.

**`next` is one of four shapes**, and the client does not compute it:

| `next.kind` | When |
| --- | --- |
| `follow_up` | The answer was to a bank question and its one follow-up has been generated |
| `question` | The follow-up is answered; there are positions left |
| `pressure` | Last answer submitted, `mode = 'realistic'` — screen 7 |
| `feedback` | Last answer submitted, `mode = 'practice'` |

One generated follow-up per answer, both modes, asked once (decision log Phase 2). A follow-up is
**never scored into progress data** — structurally impossible: it has no `question_id`, and
`is_first_attempt` requires one (`04` §6).

Failures: `422 answer_already_submitted` (idempotent alternative: the same body returns `200` with the
existing attempt — a different body is the `422`); `502 followup_generation_failed`, which is **not
fatal** — the answer is saved and scored, and `next` degrades to `question`, `pressure` or `feedback`.
A missing follow-up costs one prompt; a lost answer costs a measurement.

### 5.10 `POST /api/scoring-attempts/{attemptId}/run` ⚡

Performs a pending attempt. **Normally not called over HTTP at all** — `submit` schedules the same
work in `after()` (see the trigger note below), while the user is already recording the next answer.
This endpoint is the **History retry path**: the way a `pending` or `failed` attempt is driven to
completion by hand.

```json
200
{ "attempt_id": "s903…", "status": "ok",
  "scores": [ { "dimension": "structure", "value": 4 }, { "dimension": "evidence", "value": 3 },
              { "dimension": "relevance", "value": 4 }, { "dimension": "fluency", "value": 3 },
              { "dimension": "accuracy", "value": 4 }, { "dimension": "length_pacing", "value": 3 },
              { "dimension": "keigo", "value": 4 } ],
  "citations": [ { "cv_claim_id": "9c41…", "relation": "supported_by" } ],
  "tokens_in": 3120, "tokens_out": 604 }
```

**No `total`, no `average`, no `overall` — here or anywhere.** There is no column for one (`04`), no
view that computes one, and no response field that carries one. PRD §9, refusal #1. An endpoint that
returned a mean would make the schema's guarantee cosmetic.

**Idempotent and abandon-safe.** Only `status = 'pending'` transitions. A second call while the first
is in flight is a `409`; a call on a finished attempt returns it unchanged. Nothing awaits the scoring
work, so a function terminated at the 300s ceiling — or one that dies mid-flight — leaves a row
pending with no error raised anywhere. That is why a stuck `pending` is alerted on daily
(`12-deployment.md` §6) and retryable from History. **A pending score is a
first-class state, not an error** (`03` §5): History and Progress both render it, and
**Progress excludes pending and failed attempts from trend lines rather than treating them as zero.**

Retries three times with exponential backoff inside the handler before the row is marked `failed`
(`03` §8). `error_class` is stored; the model's output never is.

Citations are written to `claim_citations` **only after span validation**: the quote is
`substring(cv_versions.body, span_start, span_end - span_start)`, never text returned by the model.
A span outside the body, or a quote that does not match its span, drops the citation (`03` §11,
`04`).

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
              "model_id": "gpt-5.6-sol", "scoring_prompt_version": "score-ja-1.0" } }
```

`is_superseding: true` — this attempt is meant to become the displayed score, unlike a held-out
re-score. Then `POST /api/scoring-attempts/{id}/run`.

`422 scoring_not_retryable` when the answer's latest attempt is `ok` or `pending`. **A successful
score is not re-rollable from the UI** — that is the per-session model picker rejected in the
decision log arriving by a different door. Re-scoring an `ok` answer happens only through the
held-out harness, which writes `is_superseding: false` and never changes a displayed score (`04`).

### 5.12 `POST /api/rounds/{roundId}/complete`

Records the felt-pressure rating, closes the round, and generates the round feedback. One endpoint,
deliberately.

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
    "language": "ja", "model_id": "gpt-5.6-sol", "prompt_version": "feedback-ja-1.0" },
  "scoring": { "ok": 9, "pending": 1, "failed": 0 } }
```

**Why the rating and the completion are the same call:** `04` requires `felt_pressure` to be captured
**before any feedback**, and one endpoint makes that ordering structural rather than a rule someone
has to remember. Feedback cannot be generated without the rating having already been written in the
same transaction.

- `mode = 'realistic'` and no `felt_pressure` → `422 pressure_required`.
- `mode = 'practice'` and a `felt_pressure` → `422 pressure_not_applicable`. The check constraint is
  the backstop.
- Already complete → `409 round_already_complete`, returning the existing feedback.
- Not all answers submitted → `409 round_not_complete`.

**`scoring` reports what is not yet in.** The feedback screen states a pending score plainly rather
than spinning (`03` §5, §8). `pending` here is not an error and does not block the response.

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
      "answers": 10, "scoring": { "ok": 9, "pending": 1, "failed": 0 },
      "stamps": { "cv_version_label": "職務経歴書 v3", "rubric_version_label": "v1.2",
                  "scoring_model_id": "gpt-5.6-sol" } } ],
  "next_cursor": "eyJzIjoiMjAyNi0wOS0xMlQwMzowNDo1MVoiLCJpIjoiNzdhZiJ9" }
```

Every row carries its stamps, because History is where a change of stamp has to be legible per row —
Progress draws the boundary line, History says which side a round is on (refusal #5).

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

---

## 6. Endpoints that do not exist, and must not be added

Stated so a later session recognises these as refusals, not gaps. Each one, if added, would quietly
convert a guarantee in `04` §6 into a preference.

| Not built | Why |
| --- | --- |
| `DELETE` on anything | Nothing is hard-deleted (`04` §5). A scoring record you can quietly delete is one you will delete after a bad round, and the chart stops being honest (refusal #3, brief). |
| `PATCH /api/answers/{id}` | The route by which `transcript_raw` gets overwritten by its correction (`04` §6). |
| `PUT /api/cv-versions/{id}` | Every span in the database indexes into `body`. A change is a new version. |
| Any endpoint returning a composite score | Refusal #1. No column, no view, no field. |
| `POST /api/rounds/{id}/abandon` | `completed_at is null` is the record. Abandonment is data. |
| A model or rubric selector on any request | The stamps would become user-chosen, making drift voluntary and biased (decision log). Both are config and resolved server-side. |
| Anything with a `share`, `visibility`, `export` or `public` in it | Refusal #6. Multi-tenancy is not permission to build a sharing surface (`03` §2, `08` §7). |
| `POST /api/questions` | The bank is written by generation with the near-duplicate guard, or by seed. A hand-inserted question skips the embedding check and fragments the measurement (`03` §11). |
| An admin route of any kind | There are no roles (`08` §4). |

---

## 7. What this document leaves open

- ~~The scoring dispatch trigger~~ and ~~the transcription model id~~ — **both closed 2026-09-12.**
  The trigger is `after()` inside `submit` (§5.10); the model is `gpt-transcribe` at $0.0045/minute
  (`03` §4), and §5.7's response carries the real string.
- **The near-duplicate threshold** used in §5.4. A guess until there is real data; start strict, log
  every near-miss with its score.
- **User-facing copy for every code in §3.** The catalogue is closed and complete; the Japanese and
  English strings for it are not written, and **Japanese copy needs a native read**
  (`05-design-system.md` §6). `11-testing-plan.md` asserts the two lists match, which will fail
  loudly until they do.
