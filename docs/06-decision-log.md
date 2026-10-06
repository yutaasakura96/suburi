# Decision log

Newest first. Every entry records what was chosen, why, and what was rejected.

---
## Phase 6 — the rating holds while the round closes

### [2026-10-06] The rating cannot change while the round closes

Screen 7's options stop responding from the press until the feedback opens or the call fails (`10`
§7). Before, a different option could be picked while the first was being recorded, and the screen
then showed a rating that was not the round's. The value sent was already fixed at the press; this
only keeps the selection shown equal to it. Built with #73, taken out of it as outside that issue,
and restored once the owner answered "Yes, lock it" (2026-10-06).

---
## Phase 6 — #48, failure paths

What a round does when a recording, an upload, a transcription, a score or a database call fails, and
how it resumes. The behaviour was settled on 2026-09-12, 2026-09-27 and 2026-09-28 (below); these are
the choices the build needed.

### [2026-10-06] Merged after #73: the wait line is the take's way, and the stuck frames are where it ends

#73 merged first and replaced the record frame's two status sentences with the wait line (`10`, between
4 and 5). The take's screen carries #73's `step` — `upload` or `transcribe` — in place of #48's
`uploaded`: the tab-close warning stands while the step is `upload`, and a page loaded onto a confirmed
slot opens on the wait line at `transcribe`, its first segment already done.

- **A failed upload, a refused take and a failed transcription still leave for #48's frames** (`10`
  4–5, when it fails). #73's "the record button comes back disabled, with the sentence and
  `もう一度試す`" is what any other failure of the two calls shows.
- **No string was added or reworded.** #73 retired `録音をアップロードして、文字起こしをしています。` and
  #49's `文字起こしをしています。`; the screens show #73's two sentences for them, which are unread
  (`native-read-round.md` §14).
- The checklist's #48 section moved to `native-read-round.md` §15, behind #73's §14. No migration
  moved: #73 added none.

### [2026-10-06] Merged after #49: one round read, and practice's kept take beside the held one

#49 merged first and built `GET /api/rounds/{roundId}` too, as `lib/round/read-round.ts`. There is one
route and one module, #49's file, carrying both: #49's scores, `retry_of_answer_id`, open answer-again
and `no-store`; #48's guard, its refusal of query parameters, `progress`, and **#48's `state` and
`resume`** — `open` until `audio_uploaded_at` is set, and `resume.at` one of `answers`, `upload`,
`transcribe`, `transcript`, `submit`, `complete`, with `answer_id` only where a row is waited on. That
supersedes #49's "an open slot already reads `uploaded`" and its `answer_id: null`: a reserved key does
not confirm an upload (2026-10-04, above). An open answer-again resumes by the same rule as any slot.

- **A practice take is held in IndexedDB until its PUT lands**, then let go: from there #49's frame
  keeps it or records again, and a reload shows the question again as #49 decided (2026-10-04, below).
  A practice upload that fails is held and retried like a realistic one.
- **`{ "source": "typed" }` takes `retry_of_answer_id`**, so an answer given again whose take the route
  refuses is typed like any other; a typed retry slot refuses a take as a typed slot does.
- **A failed transcription in practice opens the retry-or-type frame**, as in realistic. #49 returned
  to the kept take with a retry; the take is final once the server has read it, and typing is the way out.
- **A repeated `complete` counts the same answers the first did** — #49's feedback answers.
- **One sentence for "Transcribing the take."**: #49's `文字起こしをしています。`. #48's
  `録音の文字起こしをしています。` had the same English and the same key; no string was added or reworded.
- The checklist's #48 section moved to `native-read-round.md` §14, behind #49's §13. No migration
  moved: #49 added none.

Rejected: keeping both read modules behind one route, and keeping #49's `uploaded`-on-open beside
`audio_uploaded_at` — two answers to "did the take land".

### [2026-10-06] On a reload, a held practice take wins over an older confirmed upload

The owner's ruling: a round cannot lose an answer, so the newest take is never dropped silently.
`answers.audio_uploaded_at` is set once and says nothing of a later re-take. In practice a take is let
go from the device as soon as its PUT lands, so a take still held beside a confirmed upload is a newer
one that never reached S3: take 1 uploaded and confirmed, its transcription unanswered, take 2 recorded
instead and its PUT failed. On a reload onto that prompt the held take is sent again, onto the same
slot and object, and that is what is transcribed. Rejected: resuming at `transcribe`, which reads take
1 and then releases take 2. A realistic round is unchanged: it has one take, the held copy is the
confirmed object, and it still resumes at `transcribe` with no second upload.

### [2026-10-06] Known limitation: an answer-again take held with no server row is not offered after a reload

Practice only. A held take is found on load by the prompt the page opens on. When an answer is given
again and `POST …/answers` never reaches the server, no answer-again row exists, so a reload opens on
the round's current prompt or the last per-answer frame and the take is not offered again. It stays on
the device until the round completes. Where the slot did open and only the PUT failed, the reload
resumes on the answer-again row and finds it. Not fixed here: it needs the page to remember which
answer was being given again, which is new client state for #49's answer-again and outside #48;
follow-up work is filed separately.

### [2026-10-06] Review correction: only the project's spend limit is mapped

This corrects the 2026-10-04 entry "A spent project is classed by its code, and the organization's
limit with it", whose second half no longer describes the code. `lib/ai/upstream.ts` classes only a
`429` whose code is `project_spend_limit_exceeded` as that code and marks it not retryable. A `429
organization_spend_limit_exceeded` is classed `upstream_429` and retried like any rate limit. The
issue's criterion names the project code alone, and the "Review correction: reserved keys do not
confirm upload" entry of 2026-10-04 narrowed the mapping to it; this entry states the consequence for
the organization code, which that one left unsaid. Rejected: mapping the organization code as well,
which is a path #48 does not ask for.

### [2026-10-06] Merged after #74: upload confirmation is migration `0014`

#74 merged first and took `0013` for model answers, so `answers.audio_uploaded_at` is
`0014_upload-confirmation`, regenerated by `drizzle-kit generate` against #74's snapshot; the SQL is
the same statement. The checklist's #48 section moved with it, to `native-read-round.md` §13, behind
#74's §12; no string changed. `complete` keeps both: #74's model answers start once step 1 commits
and are settled whether or not the feedback was written, and a repeated `complete` starts none — the
ones a round lacks are `POST …/model-answers`' (`07` §5.19). This supersedes the entry below on both
numbers.

### [2026-10-06] Merged after #50: upload confirmation is migration `0013`

#50 merged first and took `0012` for History, so `answers.audio_uploaded_at` is
`0013_upload-confirmation`, regenerated by `drizzle-kit generate` against #50's snapshot; the SQL is
the same statement. The checklist's #48 section moved with it, to `native-read-round.md` §12, behind
#50's §11; no string changed. This supersedes the entry below on both numbers.

### [2026-10-06] Merged after #45: upload confirmation is migration `0012`

#45 merged first and took `0011` for the speech route's bucket, so `answers.audio_uploaded_at` is
`0012_upload-confirmation`, regenerated by `drizzle-kit generate` against #45's snapshot; the SQL is
the same statement. The checklist's #48 section moved with it, to `native-read-round.md` §11, behind
#45's §10; no string changed.

### [2026-10-05] `complete` is idempotent, and never `write_failed` once the round is complete

The owner's ruling. `write_failed` promises that nothing was written and the same call resumes; after
step 1 commits `completed_at` neither is true. So a database failure in the feedback steps answers the
normal `201` with `feedback: null` — pending, for `POST …/feedback` to write — and **a repeated
`complete` on a complete round answers `200` with the same completed result**, not
`409 round_already_complete`. The stored rating stands whatever the repeat sends. A model failure or
the score wait running out is still `502 feedback_generation_failed`, as before.

### [2026-10-05] A spent project met by question generation is `503 model_unavailable`

The owner's ruling. The preflight and generation run together; when the probe passes and generation
gets `429 project_spend_limit_exceeded`, the round is refused as `503 model_unavailable` with that
error class, exactly as when the probe meets it — not `502 question_generation_failed`.

### [2026-10-05] A take the slot route refuses is kept and answered by typing

The owner's ruling, superseding the build's "not held, recorded again": **a captured take is never
deleted.** A take over the size cap, or of a type the route refuses, stays in IndexedDB marked with
the refusal; the frame says why and to type instead in one sentence of its own, in place of the
held rail — never "try again" or "do not close this tab", stored on the device or not — offers no
retry, since none could succeed, and offers typing. No answer
row exists at that point, so `POST …/answers` takes `{ "source": "typed" }` and opens the current
slot with no `audio_s3_key`; `07` §5.8 then stores the text. **Held takes are keyed by prompt, not by
round** — the 2026-10-04 entry below said one per round — so the refused take is not replaced by the
next question's and stays until the round completes. A slot opened as typed stays typed: a take sent
to it afterwards is refused (`422 unsupported_content_type`), never given a key. **Resume names
that slot's next call as `transcript`** (`07` §5.5), and a page loaded onto it opens the typing box
rather than the record frame — the owner's ruling, since the upload it used to name can never succeed.
That page says `録音は残ります。` / "The take is kept." only when a take is held on the device: the
caption is the read sentence with or without its last one, no new wording. The 20,000-character cap on typed text is
removed with it: the fallback was specified with no limit.

### [2026-10-05] Round creation and writes serialize per user

Starting a round and writing to an existing round take the same `users` row lock — `for no key
update`, so an insert carrying the user's foreign key is not made to wait behind it — before checking
whether the old round is still writable. A creation that waits for the lock stamps `started_at` at
insertion time, so the newest round follows commit order. This closes the two-tab gap where a new
round could commit after an old answer checked its status but before that answer wrote.

### [2026-10-04] Review correction: reserved keys do not confirm upload

The uploaded state and `transcribe` resume now require `answers.audio_uploaded_at`, recorded after
the server reads the object. Until then, the take remains on the device and resume names `upload`.
Typed transcript writes check the round status in their transaction. Spend-limit handling recognizes
only `project_spend_limit_exceeded`; held takes for other rounds are left alone. The earlier #48
entries below record the build's first behavior and are superseded on these points.

### [2026-10-04] Every round route is wrapped: whatever throws leaves as `write_failed`

2026-09-28 made `write_failed` the answer to a failed write. Failing each route at every database
call it makes, one at a time, found the calls that were not writes: the session read, the limiter's
upsert, the reads before and between transactions, and the whole read route. Each left as a bare
`500`. **One guard in `lib/round/http.ts` now wraps every round handler** and answers the same
envelope, with `pg_<SQLSTATE>` when the driver gave one and `unexpected` when it did not. Two things
the same test found and fixed: `POST /api/rounds` read its first question after committing, so a
failure there refused a round that existed — the read is inside the transaction now; and a failed
read while preparing question generation was reported as `502 question_generation_failed`, which
names the model for the database's failure — it reaches the guard now. **Rejected:** a second code
for a failed read. The user's recourse is the same sentence and the same retry, and the catalogue
would gain a distinction no screen draws.

### [2026-10-04] A typed answer is marked by its missing transcriber, and the same text twice is not a refusal

`07` §5.8 already stored a typed answer with `transcriber_model_id` null. **That null beside a set
`transcript_raw` is the mark** Progress excludes on, with `words_per_minute` and `audio_duration_ms`
null beside it: no column, no migration, and nothing that could disagree with the transcriber column.
The take's key is kept. The route writes only while `transcript_raw` is null, so it cannot replace a
transcript (invariant 4). **The same text sent again is a `200` with the stored row**, as `submit` and
`transcribe` already answer a repeat, so a response lost on the way back is not an error on the
retry; different text is `422 transcript_already_final`. Capped at 20,000 characters — a bound on the
body, not a measured one: a four-minute answer is a few thousand.

### [2026-10-04] A held take is one per round, in IndexedDB from the moment it exists

`03` §5 said the blob stays in the browser and retries. **It is stored before the upload is tried,
not after it fails**, so a tab closed mid-upload loses nothing, and removed once the PUT succeeds.
Keyed by round, one take each, since a round asks one prompt at a time; a take held for another
round is left for that round's own page, and dropped after two days, by when no round could take it
(a round resumes only on its Asia/Tokyo day). **The retry is the user's**, a button, not a timer: an
automatic retry is a spinner with a reason, and the sentence already says what to do. The browser's
leave-page warning is on while a take has not reached S3. `03` §8 listed "key, size, attempt count"
as logged for a failed upload: **nothing is logged from the browser** — it would have to post to a
logging route, and Sentry's console breadcrumbs are off — so the record is the server's
`answer_reopened` line each retry writes, with the answer id and the size.

### [2026-10-04] Resume calls `transcribe` itself, and `open` is a state no row is read in

A reload after the upload and before the transcript finds a slot with no transcript. **The page
calls `transcribe` rather than asking for a new take**: the route is idempotent, so it returns the
stored transcript, transcribes the uploaded take, or answers `404 audio_missing` — the one case in
which the question is asked again. `07` §5.5 lists `open` (row, no audio) as an answer's first state;
the slot is opened only after a take exists and its key is written with the row, so **every row
reads `uploaded` from the start**. The state stays in the type for what it means; nothing depends on
reading it.

### [2026-10-04] A spent project is classed by its code, and the organization's limit with it

`lib/ai/upstream.ts` classes a `429` whose code is `project_spend_limit_exceeded` as that code
instead of `upstream_429`, marks it not retryable, and the scoring loop stops on it after one call.
**`organization_spend_limit_exceeded` is mapped the same way**: OpenAI documents both as the same
hard limit at two levels, and waiting out either is the mistake confirm 5 named. **Not verified:**
whether the preflight's `GET /v1/models/{id}` is itself refused for a spent project — the guide does
not say, and finding out means spending a project to its limit. If it is not, the limit is first met
mid-round, where every call already fails once and says so (`12` §6).

### [2026-10-04] An abandoned round says which of the two reasons left it

Screen copy had one sentence, for a newer round. A round left by the day ending has **its own
sentence**: telling the user a newer round started when none did is a wrong statement on a
read-only screen. When both are true the newer round is named — it is the one that happened first
from the user's side.

---

## Phase 6 — #73, the round's two waits

Raised by the owner after the first real English round on `develop` (2026-10-03): after stopping a
recording nothing shows how long the transcription is taking, how far along it is, or what is
happening. The issue's suggestions — a clear state with a progress bar or a time estimate, the same
at round end while the answers are scored, specified in `10` first — were firstmate's; the owner
approved starting on 2026-10-05. **The choices below are the build's, still the owner's to confirm.**

### [2026-10-06] A wait is said as what is running, a segment per thing waited for, and the time so far

One component, the wait line (`05` §5.10), on both waits: a sentence naming the call in flight, a
track cut into one segment per thing being waited for, the elapsed time beside it, and a line saying
to wait and that the screen moves on by itself. The take on its way has two segments because it is
two calls, upload then transcription (`10` §3–5); the round closing has one per submitted answer and
one for the feedback (`10` §7). **A segment fills only when its own thing has finished.**

*Rejected:* a percentage or a bar that creeps — the app knows which call is running and never how far
through it is, so any position would be invented; a time estimate — scoring's slowest measured call
took five times its median (`03` §4), so an estimate is wrong on exactly the wait the user notices; a
spinner — it says only that something is happening, which was the complaint, and
`10` §11 already calls one that outlives the sitting a defect. The elapsed clock is the one figure
shown because it is the one figure measured.

### [2026-10-06] The round-end counts are read from the round, beside `complete`, not returned by it

`complete` is one call that waits for the last scores and then writes the feedback (`07` §5.12), so
it can report nothing until it is over. Screen 7 re-reads the round every two seconds while that call
is in flight (`07` §5.5) and counts the submitted answers and those whose latest attempt is no longer
`pending`. **A failed score counts as done**, as it does for `complete`. Status only: no score is
read or shown.

*Rejected:* streaming progress out of `complete` — it would change the one endpoint whose ordering
`06`, 2026-09-27 fixed, for a caption; a counts-only endpoint — §5.5 already is that read. *The limit:*
a read that fails leaves the line as it was, and until the first read lands the wait is on its first
sentence and one running segment. `GET /api/rounds/{roundId}` is #49's, merged before this: a real
round shows the counts, and `e2e/waits.spec.ts` proves them against that route, with two scoring
calls and the feedback's held open in the mock.

### [2026-10-06] Practice's round end stays on its caption

A practice round ends on the same `complete` call, from the per-answer frame, and still says
`Writing the findings.` in a caption alone (`10` §15): no wait line, no clock, no counts. Left out of
#73 on purpose. The read of a practice round also carries the answers given again, so "N of M
scored" has no settled meaning there; it stays a caption until the owner decides what the count
means (`10` §12).

### [2026-10-06] Practice's held take waits on the same line

#49 landed while this was open, with a sentence of its own for each of practice's two waits
(`Uploading the take.`, `Transcribing the take.`). They are the same two calls, so practice shows the
wait line too (`10` §15) and those two strings are retired (`native-read-round.md` §13). The clock
starts again for the transcription, because the held take stands between the two calls.

---
## Phase 6 — #49, practice mode

The round with the pressure taken out: a re-take, each answer's scores as they land, a second go at
the same question, and feedback with no rating asked first. The shape is 2026-09-27's (below); the
server already completed a practice round and preferred seen questions. These are the choices the
screens and the two remaining calls needed. The owner confirmed the feedback rule on 2026-10-05.

### [2026-10-04, owner-confirmed 2026-10-05] Round feedback uses scored retries when no original answer scored

**Owner-confirmed.** `complete` waits for,
counts and sends to the feedback call the answers the round asked for: each question's first answer
and its follow-up's. An answer given again is scored on its own, shown on its own per-answer frame
and on its own page of screen 8, and is left out of the findings and of `Checked against your CV`
when an original answer scored. When none scored, `complete` uses scored retries instead, including
their CV check, under `feedback-en-1.3` and `feedback-ja-1.2`.
**Why:** `feedback-en-1.2` and `feedback-ja-1.1` read one answer per prompt, labelled by position; a
second answer to the same question is something neither prompt has a word for, and findings written
over both would say which was better — the comparison `10` §15 refuses. It also keeps `complete`'s
60 s wait off a retry sent a moment before the round ended when an original scored. **Rejected:** sending retries as extra `answer N` blocks (the model would read two
answers to one question as two questions); replacing the first answer with the latest retry in the
input (findings about an answer the Progress chart will never plot, and the first answer's flags
disappear from the round). The fallback labels retries explicitly and uses new prompt versions.

### [2026-10-06] Known limitation: a later re-score moves the CV regions off the retries the findings describe

Screen 8 decides which answers its round-level regions read from the scores as they are now, not
from what the stored `round_feedback` row was written from. So when a practice round's feedback was
written from retries, because no original scored, and a failed original is later re-scored from
History and lands `ok`, the round-level CV regions follow the originals while the stored findings
beside them still describe the answers given again. Nothing is lost or mis-stored. **Why it stays:**
it needs every original to fail, a retry to score, and a History re-score afterward; the owner chose
to record it rather than change code for it. **The known fix:** pin the regions to the set the
stored row used, by its `prompt_version` (`feedback-en-1.3` and `feedback-ja-1.2` are the retry
versions). Tracked with the region's scope in
[#85](https://github.com/yutaasakura96/suburi/issues/85).

### [2026-10-04] Practice's screens are `10` §15: a per-answer frame after every commit

Specified from `05` components before any was built, as §13 was; there is no artboard. **The scores
get a frame of their own** — the answer's rows, its flags, what the round asks next ready beside
them, and `Answer again` — rather than a strip on the next question's record frame. **Why:** the
score lands about seven seconds after the commit (`03` §4), which on the next record frame is while
the user is reading or already answering the next question; and "answer again" needs somewhere to
stand that is about the answer just given. The frame states `Not scored yet` in words and nothing on
it waits, so going on is never held behind a score (invariant 2's spirit, in a mode it does not bind).
It also absorbs §6's "after the commit" frame: a missing or not-yet-stored follow-up is said there.
Setup now offers the mode, and shows no time estimate for practice — its cap is the runaway guard,
not a pace. **Rejected:** scores inline on the next record frame (above); a dialog over the round (a
second layer for something that is the round's main content in this mode).

### [2026-10-04] A practice take is uploaded when it stops, and transcribed when the user says so

Realistic's `Stop and transcribe` is one control because the take is final. In practice stopping
opens the slot and uploads the take, and the frame holds it: `Transcribe this take`, or `Record
again`. **Why:** `07` §5.6 makes the re-take a property of the server — the same row and the same
object key until `transcript_raw` is set — and a take held only in the tab would make that rule
something no request ever exercised. Transcribing is the commit, and the frame says so before it is
pressed. **A reload on a held take asks for the question again**: the upload is in the bucket, but the
page cannot play it back, and offering to transcribe a take the user cannot check is worse than a
re-take. **Rejected:** transcribing at stop as realistic does (nothing left to re-take: §5.7's
transcript is final); playback of the held take (a new surface the issue does not ask for).

### [2026-10-04] Answer again: a retry of the original, one open at a time, refused with the codes that exist

`retry_of_answer_id` on the slot call (`07` §5.6). **A retry always points at the original** — a
retry of a retry is one more retry of the same answer — so "the answers to this prompt" is one
`where`, not a chain to walk. **One retry is open per original**: a repeat is its re-take. **The
round's step is neither read nor moved**, so `submit` on a retry returns the `next` the round already
had and generates no follow-up (2026-10-03, #44). **Refusals use `invalid_request` and `not_found`**:
a realistic round, an unsubmitted answer and a foreign id are requests the client never makes, the
catalogue is closed (`07` §3), and a new code would be a Japanese and an English sentence written for
a reader who does not exist.

### [2026-10-04] A practice round reloads onto the answer sent last; this is what ends the rating it never owed

#44's review found a practice round's last `submit` returning `next.kind = feedback` and the page
then showing screen 7, whose rating the API refuses. The page had one "the round is past its last
answer" frame, and it was the rating. **Now a practice round opens, in order, on an open
answer-again, on the open answer to the current prompt, and otherwise on the per-answer frame of the
answer sent last** (`10` §15), whose `Next` is read from where the round stands — so the frame after
the last answer is the one that leads to the feedback, and `complete` is sent with no rating. A
realistic round is unchanged. **Rejected:** skipping straight to `complete` when the page loads on a
finished practice round (a reload would close the round without being asked, and the last answer's
scores would never be shown).

### [2026-10-04] The per-answer frame polls the round's read; nothing is cached

`GET /api/rounds/{id}` is built as `07` §5.5 specified it, and the frame asks it every 2 s while the
attempt on screen is pending, every 10 s after a minute, and stops after six (`03` §7). **Why a
poll:** the wait is seven seconds at the median, there is one user and one frame, and the read is
three small queries. **`state` follows the columns as §5.5 defines them, so an open slot reads
`uploaded`** — the key is written when the slot opens — and `open` is a state no row is in; §5.5 now
says so rather than the code inventing a fifth column to tell them apart. **Rejected:** a streamed
response or server-sent events (a function held open per frame for a seven-second wait);
`router.refresh()` on a timer (it re-renders the frame from the server and drops the error line and
the go-on state it holds); a client cache library (`03` §7 names them as not added).

### [2026-10-04, owner-accepted 2026-10-05] The new Japanese strings passed the native read

Every Japanese string practice adds is in `docs/checklists/native-read-round.md` §13, written to
`05` §6's rules. The owner read and accepted all 28 strings on 2026-10-05.
The owner also accepted the numbered follow-up retry label on 2026-10-05, and on 2026-10-06 the
numbered bank-retry heading added afterward and the two names `feedback-ja-1.2` gives an answer
given again (`第2問の再回答`, `第2問の深掘りの再回答`).

---

## Deploying — `develop` migrates itself

### [2026-10-06] A `develop` deploy applies its pending migrations in Vercel's build; `main` stays by hand

Merging into `develop` deployed the code and nothing migrated Neon `develop`: `12` §4 made that a
hand-run step, and on 2026-10-06 the database was found five migrations behind (`0008`–`0012`), with
merged features erroring on the test site. **Decided:** `vercel.json`'s `buildCommand` runs
`npm run db:migrate:deploy` before `npm run build`. The script migrates only when `VERCEL_ENV` is
`preview` and `VERCEL_GIT_COMMIT_REF` is `develop`, with drizzle's own migrator and journal, and a
failure fails the build, so the previous deployment keeps serving. `12` §4 has the detail. **`main` is
unchanged:** its build runs the script, which reads no database variable there and exits `0`, and Neon
`main` is still migrated by hand before the merge — the 2026-09-12 reason, unattended DDL on the
measurement record, is about `main`'s rows and does not reach a synthetic seed.
**Why the build step:** the migration and the code are then one deploy. A migration that fails stops
the code that needs it, in the place a failed deploy is already looked for, and it needs no new secret —
`DATABASE_URL_UNPOOLED` is already in `develop`'s Preview scope. **Rejected:** a GitHub Actions job on
push to `develop` (it races Vercel's build, a failed migration would not stop the deploy, and it puts a
second copy of the connection string in GitHub); spawning `drizzle-kit migrate` from the build
(`drizzle.config.ts` validates the whole environment, and the step should need the one variable it
reads); a Neon branch per deploy (`12` §10); migrating at boot in `instrumentation.ts` (every cold
start would hold the direct connection, and a failure would be a running deployment that errors, not a
deploy that never happened).
**Two guards the build needed.** The URL's role must be `suburi_develop`, which Neon `main` refuses
(`12` §3 step 8): a Preview variable pointed at `main` by mistake would otherwise be exactly the
unattended migration this entry leaves out. And a Postgres advisory lock serialises two builds at once
— drizzle reads its journal before it opens its transaction, so both would run the same migration and
the second would fail on the first's tables.
**And a third, for the migration drizzle skips.** Its migrator applies only the entries whose journal
`when` is later than the newest applied one. A migration generated on a branch that merges second,
renumbered at the merge, keeps its earlier timestamp, and the build would pass with it unapplied — the
drift this entry exists to end. So after migrating, the step compares the rows in
`drizzle.__drizzle_migrations` with the entries in the folder's `meta/_journal.json` and fails the
build when the database has fewer, naming the cause and the fix: regenerate the migration so its
timestamp is the newest. A plain `<`, so redeploying an older commit, where the database has more,
still passes.

---
## Phase 6 — #74, a model answer for each question

Raised by the owner after the first real English round on `develop` (2026-10-03): the feedback says
what to fix, and shows the question, but never how it could have been answered. Each question a round
asks now has a model answer, stored with the round. The issue's three suggestions — show it on each
question's tab beside the user's own answer, ground it in the user's real record, generate it once at
`complete` — were firstmate's, marked "to confirm"; **they are built as suggested, and the choices
below are the build's, still the owner's to confirm.**

### [2026-10-06] A pending call and its retry may race

If a round-end call outlives the 45 s wait and the user presses retry before its row lands, a second
call runs and whichever commits first is kept. Both use the same question, CV version and answer;
the row is written once, and the worst case is one extra call. The owner accepted this limit without
coordination of in-flight calls.

### [2026-10-05] Model-answer figures accept パーセント and a range's shared marker

The owner widened the figure rule below twice, and closed the list for #74. パーセント is a percent
marker beside %, ％ and percent, in the model answer and in what supports it. A range joined by 〜,
~, -, – or "to" lends its trailing magnitude or marker to its first end, read the same way on both
sides. In the CV or the candidate's own answer, 20〜30% also supports 20% and 3〜5万件 also supports
3万. In the model answer and its English translation, 20〜30% is the two figures 20% and 30%, so a CV
that says only 20名 backs neither end; the underline on the first end covers its digits only. The
owner added the model-answer side after the first reading left that 20 unmarked.

### [2026-10-05] Model-answer figures use digit values and three kinds

The owner narrowed the deterministic check to ASCII or full-width digit figures. A figure starts at
a word boundary and may carry a magnitude (k, K, thousand, million, billion, 千, 万, 億), percent
(%, ％, percent), or multiplier (x, ×, 倍). Its identity is the normalized value and one of three
kinds: plain number, percent, or multiplier. Surrounding words are ignored, and the underline covers
only the figure. Dot-separated components of a CV or own-answer figure also support that value; comma
groups have exactly three digits; adjacent magnitude groups form one value. Digits joined by a slash
(24/7, 2021/04) are never marked, but in the CV or own answer each side supports its value. English number words,
kanji numerals, and written fractions or multipliers are outside this check; spelled-out numbers are
tracked in [#84](https://github.com/yutaasakura96/suburi/issues/84). This supersedes the earlier
figure identity decision below.

### [2026-10-05] Figure identity includes magnitude and unit

The deterministic model-answer check distinguishes counts from percentages, multipliers, fractions,
money and other units, and expands written magnitudes such as million, k, 万 and 億. The owner also
required written forms including twice, double, triple, half, halved, 倍, 半減 and 半分 to be marked when
absent from the CV and the candidate's own answer. The same check runs on the Japanese answer and its
English translation. Unit tests cover each form and the case where three engineers do not support
three million.

### [2026-10-05] Model-answer figures are checked after writing; spend baseline is $0.70

The owner chose a deterministic second check for figures in the Japanese answer and its English
translation as well as English-round answers. The server compares numbers, percentages and multipliers
with the round's stored CV text and the candidate's own answer, including the earlier answer for a
follow-up. Missing figures become unsupported spans beside the writing call's marks. This supersedes
the 2026-10-04 decision that the writing call was the only marker; nonnumeric truthfulness still needs
the real-round read. The owner also raised the per-round spend baseline from $0.40 to $0.70 and read
and accepted all ten #74 Japanese strings on 2026-10-05.

### [2026-10-04] A model answer is the user's own answer at its best, from the record they really have

One per question asked, written from the round's CV version — the same citable claims a scorer is
shown — the role context, the rubric's best anchors, the question as asked and the corrected
transcript. **It may use nothing else**: every employer, number, result, team size and date in it comes
from a CV claim or from the user's own words, never sharpened (`速くなった` does not become `40%`), and
two pieces of work are never joined into one. **It keeps the example the user chose** whenever that
example answers the question, even when the CV holds a similar one with better numbers: the story
the user can tell in a real interview is the one they lived. **Rejected:** a generic "ideal answer"
to the question (useless in an interview — it is not the user's record, and it would teach them to
say things they cannot back up); an answer free to pick the CV's strongest example (the first draft
did this, and dropped what the user had actually said); and reading the scores, so that the model
answer "fixes" the low dimensions (it aims at the best anchor of every dimension anyway, and reading
no score means it waits for none and exists even when scoring failed).

### [2026-10-04] What the CV does not back is marked, by the call that wrote it, and the server only locates

The issue asks that anything beyond the CV be marked as such. A model answer built on the user's own
example will often carry details only the user said — a team of five, three months, a result with a
number. Those are returned as verbatim quotes of the answer with a start hint, and **stored as spans
of the stored body** (`model_answers.unsupported_spans`), found by the same locator as an answer's
flags (`lib/round/grounding.ts`): a quote that is not in the text is dropped and counted, never
clamped. The screen underlines the spans and its caption names the CV stamp. **The limit, stated:**
the marking is the writing call's own. The server guarantees a mark is real text; nothing checks
that every unbacked part is marked, or that nothing was invented. **Rejected for now:** a second
call that scores the model answer against the CV as an answer is scored — twice the calls and
latency for a check whose need no real round has shown; it is the named next step if one does (`07`
§7, `11` §9). **Rejected outright:** marking by string-matching the CV (a claim is paraphrased, not
quoted, so it would mark everything), and storing the model's quote instead of a span (`04` §6 #12's
rule: no quote from model output).

### [2026-10-04] Follow-ups get one too, and a practice retry does not

"For each question asked": a follow-up is a question the round asked, and it is where the first live
round went thinnest. Its call also reads the question it followed and that answer, and the screen
shows it as a second pair under the first. A practice "answer again" is the same question, which
already has its model answer, so it gets none. **Cost accepted:** twice the calls.

### [2026-10-04] Its own table, its own call and prompt — not a field of the round feedback

`model_answers`, one row per answer, unique on `answer_id`, never updated. `round_feedback` is one
row written whole, and a model answer per question inside it would have made six to fourteen long
generations part of the one call the user is waiting on, failing together. Separate calls run side by
side, fail one at a time, and can be written for a round that was completed before they existed. The
prompts are `model-answer-en-1.0` and `model-answer-ja-1.0`, and the model is the pinned one. **It is
not measurement**: no score, none of the four stamps, no Progress boundary when its prompt or model
changes (`04` §6 #14).

### [2026-10-04] Written at `complete`, beside the feedback, and never a reason to fail it or hold it

The calls start when the round closes and run under the wait for the last score and the feedback
call. The rows are stored after the feedback, and stored even when the feedback was not.
**`complete` waits for them at most 45 s from the round's close**: an English round's calls finish
about when its feedback does, a Japanese round's about 10 s after, and every round measured inside
32 s. Past 45 s the feedback goes out and a call still running is stored in `after()` — invariant 2
is about the feedback screen, and a model answer is not allowed to be what it waits on. The first
build waited for every call up to its 90 s limit; that made one slow call the whole screen's wait,
and was changed before it shipped. **A failed call is a count in the response and a
gap on the screen**, with a control that writes what is missing through `POST
/api/rounds/{id}/model-answers` (`07` §5.19) — which also writes them for the rounds completed before
this existed, the owner's first real round among them. **Rejected:** generating wholly in `after()`
(the feedback screen would always render without them and need to poll or spin; `after()` is only
where the slow tail lands); generating lazily when a
tab is opened (a wait on the screen that must never wait, and the stored text would depend on when
it was first looked at); and **any way to regenerate one** (`07` §6): the issue asks for something
stable to review later, and a re-roll is how a reference becomes whatever read best.

### [2026-10-04] A Japanese round's model answer is translated by the same call, like its feedback

The English pill reads the feedback from a stored translation (2026-10-03, below). The model answer
follows it: `body_translated` holds the English and its own spans, written by the same call and
refused whole if the translation is missing. The Japanese is written in です・ます体 at the register
the 敬語 dimension scores. What the user said is never translated.

### [2026-10-04] Measured: 16 s for an English round's calls, 25 s for a Japanese one, bounded at 90 s

`scripts/measure-model-answers.mts`, five rounds per language through the real port, synthetic
input (`03` §4 has the table). A round's calls take as long as the slowest: **15.9 s at the median
in English, 25.0 s in Japanese**, and the slowest single call of 50 was 31.6 s. The bound is 90 s
with no retry inside `complete`. Nothing the server located was dropped: 74 marks over 30 English
answers, 26 over 20 Japanese. **The first draft marked narration** — 22 marks over six answers,
whole sentences among them, the mistake `score-en-1.1`'s first draft made — and was tightened before
the measurement to results, standing, sizes, figures and work the CV does not name. **Cost: about $0.22 for an
English round of three questions and their follow-ups, about $0.35 for a Japanese one**, which is
most of what a round was estimated at ($0.40, 2026-09-29). **The spend baseline is left as the owner
set it, and that leaves a known false alarm**: the week's threshold is $1.20 a round started, a
three-question round stays well under it, but a seven-question Japanese round's model answers alone
are about $0.80, and with its fourteen scoring calls (about $0.03 each, `03` §4) it comes to about
$1.30. A week of only such rounds would read red with nothing wrong. Raising the constant is the
owner's call (it was theirs, 2026-09-29), and it is due to be replaced by the measured cost of the
first eight real rounds anyway. **Not measured:** a
real CV and a real answer — every reading here is synthetic, and the read of a real round is `11` §5's
checklist item.

### [2026-10-04] On the screen: under the pager, what was said beside the model answer

Screen 8 had no artboard for this. The per-answer region gains two columns under the pager: the
corrected transcript on the left — the screen never showed what the user said, only its scores — and
the model answer on the right, with a second pair for an answered follow-up. Unbacked spans carry a
`--attention-mark` underline and a caption that says so in words (`05`: never colour alone); a
question with none says that nothing is underlined — **what was marked, not that the answer was
checked**, since the marks are the writing call's own. **Nothing is drawn between the two columns** — no diff, no score
for the model answer, no "you missed" list: comparison is the round-level findings' job, and a second
judgement beside the score rows would be prose beside a dimension by another route. The nine new
Japanese strings and the catalogue's one (`docs/checklists/native-read-round.md` §12) were read and
accepted by the owner on 2026-10-05.

---
## Phase 6 — #50, History

The one screen that reads a past round: the rail, the matrix, the recording and the raw transcript
behind each row, and the retry of a score that never landed. The plan is 2026-09-27's and
2026-09-28's (below); these are the choices the build needed.

### [2026-10-04] A run in flight is a claim on the attempt, and its `409` is `scoring_in_progress`

`07` §5.10 said a second `run` while the first is in flight is a `409`, and nothing recorded "in
flight": an attempt is `pending` until it is `ok` or `failed`. **Decided:** a nullable
`scoring_attempts.run_started_at`. A run begins with one conditional update — the row is `pending`
and the column is null or more than 300 s old — and a run that loses it while the row is still
`pending` answers `409 scoring_in_progress`, a new catalogued code with its copy in both languages.
300 s is the invocation ceiling, so an older claim belongs to a dead function and the next run takes
the attempt over; a test pins the constant to the routes' `maxDuration`. `submit`'s `after()` claims
the same way, so a retry from History cannot score an answer twice while its first run is going.
**Why it matters:** two runs of one attempt would both call the model, and the second would then fail
its write, having spent the call. **Rejected:** a `running` status (a function that dies leaves the row
`running` for ever, which is the stuck state `pending` exists to make visible and alertable); a
Postgres advisory lock held across the call (the pooled connection is not the function's to hold for
a minute, and a transaction must never span a model call, `11` §3.14); reusing `round_not_complete`
or another existing `409` (each is about a round, and its copy would be wrong on this row).

### [2026-10-04] History creates an attempt only beside a failed score; a pending one is run as it is

`POST /api/scoring-attempts` writes a row only when the answer's latest attempt is `failed`. `ok` and
`pending` are both `422 scoring_not_retryable`, as `07` §5.11 said; what the build adds is the other
half — **a `pending` attempt is driven by `run` itself**, so an answer whose function died gets its one
attempt finished rather than a second row beside a row that never failed. History's control reads the
row's state and makes one call or two. The check and the insert are under a lock on the answer's row.
The stamps are the round's CV and rubric, the question's or follow-up's generator version, and
**today's** model and scoring prompt: a retry after a model change is scored by the new model and is a
boundary, which is the honest reading. **Rejected:** stamping the retry with the failed attempt's
model (the pinned string may no longer exist to call, and the stamp would then name a model that did
not score it).

### [2026-10-04] An attempt's model stamp is written when it is scored, not only when its row is

Found by hand on a seeded database: the synthetic `pending` attempt, run from History, was scored by
`gpt-5.6-sol` and still read `synthetic-fixture`. The same hole exists without a seed — an attempt is
stamped with the pin of the moment its row is written, and `run` can now score a `pending` one days
later, across a model change. **Decided:** the transaction that turns an attempt `ok` also sets
`model_id` and `scoring_prompt_version` to the scorer's that produced the scores (`04`, `07` §5.10).
For `submit`'s own `after()` the two are the same values, so nothing changes there. A `failed` attempt
keeps its creation stamp: no model scored it. **Rejected:** failing a stale `pending` attempt unscored
so that History's retry writes a new row (two calls and an error on the row, to reach the same score
and the same stamp); leaving it (a score under the wrong model's name is the drift the stamps exist to
make visible, hidden instead).

### [2026-10-04] `GET /api/rounds` names every scoring model behind a round: `scoring_model_ids`

`07` §5.13 drew `stamps.scoring_model_id`, one string. A round's answers are scored one attempt each,
and a retry under a new pin gives a round two models. **Decided:** a sorted list of the models behind
the round's displayed scores, empty when none is scored; `07` is amended. The detail's stamp reads the
same way, and lists every generator version too, since a follow-up's differs from its question's.
**Rejected:** the newest attempt's model (the row would claim one side of a boundary it straddles,
on the screen whose job is to say which side a round is on).

### [2026-10-04] A recording is checked before its URL is signed, and a `403` on `HEAD` is a missing one

A presigned URL is arithmetic: S3 is not asked, so a dangling key would get a URL that fails in the
player. `GET /api/answers/{id}/audio` therefore sends a `HEAD` first and answers `404 audio_missing`
when nothing is there. The environment's IAM user has `s3:GetObject` and not `s3:ListBucket` (`12` §3
step 5), and S3 documents that a `HEAD` for an absent key then returns `403`, not `404`; **both are
read as missing**, on a key the server derived under its own prefix. Anything else is `502
upstream_s3`. The player handles what the server cannot see — an expired URL, an upload cut short —
by saying the recording could not be played. **Rejected:** granting `s3:ListBucket` to tell the two
apart (a wider credential, for a distinction History does not show); signing without checking and
leaving the failure to the `<audio>` element (a missing recording and a network fault would read the
same). **Noted, not changed here:** `transcribe` reads the object with `GET` and treats only
`NoSuchKey` as missing, so on the real bucket a take that was never uploaded surfaces as `upstream_s3`
rather than `audio_missing`. That is #48's ground (failure paths).

### [2026-10-04] History shows no question a round never reached, and no score a realistic round is holding

The matrix lists a round's positions, and two of its rows would leak if it listed them plainly. **A
question fixed for a round and never answered is shown as `Q3` and nothing else**: only an answer makes
a question seen (`04` `round_questions`), and its text on History would make it seen without one —
after which the next round would ask something the user has already read. **A realistic round still
in progress shows `Scores are held until the round ends.`** on every answered row, and `run`'s
response for such a round carries the status alone: US-8's rule is enforced where the data is read,
not by the screen choosing not to draw it. A follow-up that was asked and not answered does show its
text; it was asked. **Rejected:** hiding an in-progress round from History (10 §10 says History offers
to resume it, and it is where a user looks for it).

### [2026-10-04] The synthetic rounds are four fixtures, stamped as fixtures, with no recording

`12` §1 is amended with the table. One round per state — scored, pending, failed, abandoned — over the
synthetic bank questions and CV, written directly: no model call, every model stamp
`synthetic-fixture` and every prompt version `synthetic-…`, so a seeded score cannot be mistaken for a
scored one on any chart. Ids are derived from the user and the round's name, which makes the seed
idempotent per round without a marker column, and dates are fixed in the past so the open round is
abandoned on any day. No object is put in S3, so History shows the missing-recording state on
`develop` by default. The Japanese round's answers are sentences of the synthetic CV, already in the
repository, so the seed adds no unread Japanese. **Rejected:** seeding through the handlers with fake
ports (it would need a session and would stamp rows with fake model strings the app could plausibly
have written); a recording fixture in S3 (a seed that needs bucket credentials is one that cannot run
in CI or locally).

### [2026-10-04] History's routes, its English, and the way to it

`/history` opens the newest round and `/history/{roundId}` is a round; the rail is the layout. The
chrome is English (`10` §0) and `10` §10 now carries the table of what replaced each artboard string,
with the rows the artboard does not draw: a practice retry, an unscored answer with its control, an
unanswered follow-up, an unreached question, and a held score. The pill renames the dimensions on
this screen; the feedback it toggles on screen 8 is reached by a link. **Home gains one link,
`History`**, because no navigation exists yet and a screen with no way to it is not verifiable on
`develop`; #51 rebuilds Home. **No delete, share or export control exists**, and `11` §4's Playwright
row now holds the whole list of controls the screen may have.

### [2026-10-04] Merged onto #47 and #45: migration `0012_history`

#47 landed `0010_generated-questions` and #45 `0011_speech-route` first. This slice's migration was
regenerated by `drizzle-kit` after each merge of `develop`, and is `0012_history`:
`scoring_attempts.run_started_at`, and `rate_limit_windows.route`'s check extended with
`scoring-attempts` and `scoring-run` (30 per 10 minutes each, `07` §1 rule 5) beside #45's `speech`.
Expand-only, and **not yet applied to either Neon branch** (`12` §4).

---
## Phase 6 — #45, the spoken question, the cap and one take

What makes a realistic round realistic. The route and the failure were decided on 2026-09-27 and
2026-09-28 (below); these are the choices the build needed.

### [2026-10-03] The speech model is `gpt-4o-mini-tts-2025-12-15`, voice `marin` — and OpenAI removes it on 2027-01-06

**Checked, against OpenAI's docs on 2026-10-03:** the text-to-speech guide, the `gpt-4o-mini-tts`
model page and the deprecations page. The speech endpoint takes `tts-1`, `tts-1-hd` and
`gpt-4o-mini-tts`, whose snapshots are `2025-03-20` and `2025-12-15`; the guide calls
`gpt-4o-mini-tts` the newest, and no newer speech-endpoint model exists. **Pinned:** the current
snapshot, `gpt-4o-mini-tts-2025-12-15`, as `TTS_MODEL` in `lib/ai/models.ts` — the string #42 measured
(`03` §4) — and the voice `marin` beside it, one of the two the guide recommends and the one that
measurement used. The model is steerable, so the port tells it to read the question exactly as
written, in the round's language, and not to answer it. **Then run:** ten synthetic questions, four
English and six Japanese with 役職 and company names, through the real port; each came back as MP3 in
1.0–2.5 s, and a transcription of each read back word for word. That is a machine check, not `11` §5's
ear check, which is the user's.

**The deprecation.** The same check found that on 2026-10-01 OpenAI deprecated every model the speech
endpoint takes, both `gpt-4o-mini-tts` snapshots included, with removal on **2027-01-06**. Its named
replacement is `gpt-realtime-2.1-mini`: a speech-to-speech model, reached only over the Realtime API
(WebRTC, WebSocket or SIP), with no dated snapshot. **Decided:** build the route the plan settled, on
the model that works and was measured, and treat the move as a slice of its own before that date.
`lib/ai/tts.ts` is a port with one implementation so the move stays behind it, and TTS is not a stamp,
so it needs no re-score and no boundary.
**Rejected:** building on the Realtime model now. It is a conversational model asked to recite, not a
synthesizer, so "reads the question as written" is unverified; it changes `07` §5.15 from one streamed
response to a session; and nothing about it was measured. **Rejected:** the alias `gpt-4o-mini-tts`,
which survives the removal only by being repointed (`03` §4, "never point at an alias").

### [2026-10-03] The speech route: 30 per 10 minutes, 10 s to the first byte, and what it logs

Its own bucket, `speech`, in `rate_limit_windows` (migration `0011`, widening the route check). One
request per prompt asked — 14 in a 7-question round with follow-ups — and a reload asks again, so 30
is two such rounds with reloads to spare, the same reasoning as `transcribe` and `submit`. Synthesis
has **10 s to its first byte**; the measured slowest was 1.5 s, and the user is reading the question
meanwhile. A failure logs `speech_failed` with the round id, the position and the error class, and
nothing else; a success logs the same ids and the time to the first byte. The query is validated like
a body: a `text` parameter is a `400`, not an ignored field. **Until follow-ups exist (#44), a
`follow_up` request is the `404` a `missing` one gets** — whichever of #44 and #45 merges second reads
`follow_ups` there.

### [2026-10-03] Screen 3's speaker line, and the practice frame without a timer

- **The browser may refuse to play sound unasked.** A round opened or reloaded with no gesture in the
  tab cannot start audio. The speaker line then becomes a control, `Hear the question`, and pressing
  it plays the question. **Rejected:** waiting for the first click anywhere, which would be the click
  on `Start recording` and would speak over the take; and reporting it as `speech_failed`, which it is
  not.
- **Starting the recording silences the question** if it is still being spoken, so the microphone
  never records it. The button is not held back until the audio ends: a stalled stream must not be able
  to stop a round.
- **A failed synthesis replaces the line in place**, in the attention ink (`05`, the colour of a
  missing-follow-up note), at the line's own height, so the question does not move (`10` §4).
- **Practice's guard is never drawn** (`03` §7). The practice record frames show no clock, no `Up to`
  line and no one-take line, and the waveform scrolls at one bar a second with no remainder — a
  waveform filling toward 15 minutes would be the guard drawn as the timer it is not. The rest of
  practice's frames are #49's.
- **`npm run ear-check`** makes `11` §5's check listenable before any Japanese round exists: synthetic
  questions in both languages through the real port, written to the gitignored `private/ear-check/`
  with a page to play them from.

### [2026-10-04] Merged after #46, #43, #44 and #47: migration `0011`, both languages, and a follow-up is asked as text

#45 merged last of the five slices. #46, #44 and #47 took `0008`, `0009` and `0010`, so the route
check's widening is `0011_speech-route`, regenerated by `drizzle-kit generate` against #47's snapshot;
the SQL is the same statement. #43 put the round's chrome in its language, so the speaker line and
its control are in both: `読み上げました。文字は残します。` is `10` §3's own, `質問を聞く` is new and in
`docs/checklists/native-read-round.md` §10, unread, and the header's mode word is `実戦` or `練習`
(`05` §6).

**A follow-up is asked as text, in realistic mode too.** #44's `follow_ups` exists now, and the route
still answers every `kind=follow_up` with a 404 (`07` §5.15): speaking it is its own change, and #45
stays open for it. A follow-up shares its question's position, so screen 3 asks the route for nothing
while one is on screen. **Rejected:** requesting `kind=question` for the position, which would read
the question aloud over its follow-up; and requesting `kind=follow_up`, whose 404 would put the
`speech_failed` notice on every follow-up though nothing failed.

---
## Phase 6 — #47, generated questions and role context

The bank stops being a fixed list: a round that the unseen pool cannot fill has its questions written
at round start from the CV's claims and the role context, and a posting becomes a role context beside
General practice. The plan is 2026-09-27's (below); these are the choices the build needed, and the
two measurements the issue asked for.

### [2026-10-03] Round-start generation is measured: 6–16 s at the median, 28 s at the slowest, and it stays at round start

`scripts/measure-question-generation.mts`, five runs of each through the real port and prompts with
synthetic input (`03` §4 has the table). #42's draft said seven questions take about 4 s; the real
prompt reads the CV's claims, the role context and the bank, and takes **6 to 16 s at the median and
28 s at the slowest** for the 3 to 9 questions one call writes. Embeddings add 0.2 s. The duration
follows the questions written, not the input read. **It stays at round start, beside the preflight:**
the wait is before the round, paid only when the bank cannot fill it, and Setup says so before the
user starts and again while it waits. Invariant 2 is about round-end feedback and is untouched. The
timeouts are 60 s and 20 s. **Rejected:** generating ahead of need in a background job (a second
writer to the bank, stamped with a CV version and role context the next round may not have, for a
wait the user is told about); generating per question inside the round (the wait moves into a timed
round, and `round_questions` could no longer be fixed at the start — 2026-09-27); and
`reasoning.effort: low`, which a side reading put at about half the wait with questions that read
comparably — **kept as the lever**, not set, because the questions are banked permanently and one
side reading is not a quality measurement. **This is slower than the plan assumed, and the owner
accepted it as shipped on 2026-10-03:** Setup says the wait takes a moment, and a progress indicator
for it is folded into #73. If half a minute before a long Japanese round proves too long, the lever is
one line and a generator prompt-version bump.

### [2026-10-03] A posting is capped at 20,000 code points, one number for both languages

Measured with the same script: the generation call with a posting of 10,000, 20,000 and 40,000 code
points, seven questions each, in both languages (`lib/round/limits.ts` has the table). **The call's
duration does not track the posting's size**, so the cap is not a latency bound and has no reason to
differ by language, unlike the CV's. It bounds cost and sense: 20,000 is a little under four times
the real-sized English posting and twelve times the Japanese one, and at the cap the call reads about
18,500 tokens in Japanese, some $0.07 a round start. Enforced by the route as `422
role_context_too_large`, and counted on the add form in the same unit. **Not measured:** whether the
questions stay good at the cap — the sweep repeated one posting to reach each size. **Rejected:** a
database check constraint (the cap is a tuned number, and tightening it would refuse rows already
stored), and per-language caps (nothing measured differs by language).

### [2026-10-03] A posting needs a company, a role title and its text; General practice is never the silent default

`07` §5.3 left a posting's fields optional. A posting with no company or title is a row the picker
cannot name and the generator cannot pitch at, so all three are required and blank is a `400`. On
Setup **neither card is chosen for the user** until a posting has been saved, after which the newest
is: a default of General practice would file rounds apart from the role they were practice for
without the user having decided that (PRD §6). `source_filename` is the imported file's name and
nothing more — the file is read in the browser by `lib/cv/import/` and never uploaded, as a CV's is
(#17).

### [2026-10-03] The guard's record is `near_duplicate_checks`: every comparison, no floor, reuses included

One append-only row per candidate that had a neighbour to be compared with: the nearest existing
question, the similarity, the threshold and embedding model in force, and the question the candidate
became — or null when it was a duplicate and the existing question was reused (`04`). **No floor:**
"near" is the thing being tuned, and a floor would be a second guessed threshold deciding which
evidence about the first one is kept. A **near-miss** is a row with a question of its own; the digest
reports their count and their lowest, median and highest similarity, and the reuses beside them,
because a threshold set too low shows up as reuses, not as near-misses. Ids and numbers only, never
question text (`12` §7). **Accepted cost:** a reused candidate's wording is not kept, so a wrong reuse
can be counted but not read back; keeping it would be a second place question text lives. **Rejected:**
logging near-misses to Vercel logs only (they expire, and the threshold is tuned over months) and a
column on `questions` (a reuse has no row to carry it).

### [2026-10-03] The guard reads the slice exactly, under a lock, and set pieces are outside it

The guard's query sorts the slice by cosine distance and takes the nearest; it does not go through
the `hnsw` index, which is approximate and can miss the one neighbour the guard exists to find. A
slice is one user's questions in one language and round type — hundreds of rows at most. Candidates
are admitted inside the round's transaction under `pg_advisory_xact_lock` on the slice, so two rounds
starting together cannot each insert the other's duplicate, and a candidate is compared with the
ones admitted before it in the same call. **Set pieces have no embedding and are never compared**
(`03` §11): they reach the generator as text in "questions already in the bank", which is the only
thing keeping a generated question off one. The threshold is `NEAR_DUPLICATE_THRESHOLD` in
`lib/questions/near-duplicate-threshold.ts`, **0.90 and still unverified**; the tests read the
constant. The one real reading so far, from a local round on synthetic data, was 0.36 between two
questions of one call — nowhere near it, and not enough to say anything.

### [2026-10-03] A round asks for two spare candidates, and falls back to seen questions before it fails

One call writes the shortfall plus `SPARE_CANDIDATES` (2), so a candidate the guard maps to an
existing question does not leave the round short; candidates past the round's length are dropped
unbanked. If the round is still short, the questions the duplicates matched and then the seen
generated ones fill it as **repeats** — which Setup's bank-exhausted warning has already said — and
only if that fails too is the round refused: `502 question_generation_failed` with `error_class:
bank_too_small`, nothing written. **The call's tokens go on the first question it inserted**, so a
sum over `questions` is the generation spend; a call whose every candidate was reused, or whose
preflight failed beside it, leaves no row and its tokens are not counted. **Rejected:** a retry loop
that generates again until the round is full (an unbounded wait at round start), and a
`question_generations` table for the tokens (one more table for a figure the digest can live without
at this volume; revisit if spend reconciliation ever needs it).

### [2026-10-03] Generator prompts are one per round type and language, and the posting is material, not instruction

Eight prompts, `generate-{round_type}-{language}-1.0`, each stamped on the questions it writes (stamp
3). A posting is text the user pasted from somewhere else, so every prompt says the posting and the
CV are material to read and never instructions to follow. The model's output is checked before it is
used: blanks and repeats dropped, cut to the count asked for, and nothing usable is
`malformed_output`. **The Japanese prompts are live as soon as this merges:** #43 opened `ja` on
`POST /api/rounds`, so a Japanese round whose bank runs short has its questions written by them. Their
output and the one new Japanese string want the native read (`docs/checklists/native-read-round.md`
§9).

---
## Phase 6 — #44, follow-ups

One follow-up per answer, in both modes: generated at `submit` from the corrected text, stored in
`follow_ups` or stored as missing, answered and scored like any answer, and never in Progress. The
shape was settled on 2026-09-12 and 2026-09-27 (below); these are the choices the build needed.

### [2026-10-04] Merged with #43: a Japanese round asks its 深掘り, and `feedback-ja-1.1` reads its answer

#43 merged first, so a Japanese round exists and asks one follow-up per answer through the same
port, with `follow-up-ja-1.0`. **`feedback-ja-1.1`** is `1.0` plus the paragraph `feedback-en-1.2`
gained: what an `answer 2, follow-up` block is, named `第2問の深掘り` in the findings and "the
follow-up to answer 2" in their translation. `1.0` is untouched; `round_feedback.prompt_version`
says which wrote a row. **The round's chrome gained its follow-up strings in Japanese** — the step
`第2問 / 3問・深掘り`, the send caption and row `10` §6 and §8 already quote, and the rest as the
Japanese of the English ones below — and each sits in `docs/checklists/native-read-round.md` §8,
**unread**. `docs/checklists/native-read-round-loop.md`, which #43 renamed, is gone; its #44 section
is that §8. Screen 8's stamps are #43's structured ones, with the follow-up prompt's version among the
generator versions. **Not run against the real model:** `follow-up-ja-1.0` and `feedback-ja-1.1`;
the fakes cover both, and their output is read on the first real Japanese round with follow-ups.

### [2026-10-03] A missing follow-up is a `502` once; the same body again is the `200`

`07` §5.9 said both that a failed generation is `502 followup_generation_failed` and that `next`
degrades — and an error envelope has a flat `detail` and no `next` (#13). So **the call that writes
the `missing` row returns the `502`**, with `detail: { answer_id, attempt_id, error_class }`, and **the
same body sent again returns the `200`** with `next` degraded to `question`, `pressure` or `feedback`,
read from the stored row. Screen 6 says the follow-up was not generated and offers one control, which
is that repeat — the hole is said, not skipped past (US-7). **Rejected:** a `200` with a `missing`
flag on the first call (the catalogue's `502` would then be unreachable, and the failure a field a
client can ignore), and a `next` inside the envelope (a second response shape for one code).

### [2026-10-03] `submit` alone writes a follow-up, and its repeat completes one left unwritten

The answer's commit and the follow-up are two transactions with a model call between them, so a
`submit` can die after the first. **The round then stands at "follow-up due"**: the question is
submitted and has no `follow_ups` row. Nothing else may produce it — resume reads it, the slot
copies it — so **the same `submit` sent again generates and stores it**, and until then the slot
refuses (`422 answer_already_submitted`, with the `answer_id`) and `complete` refuses
(`409 round_not_complete`). The round page reloads onto the saved answer with one control, which
sends that repeat. `follow_ups.parent_answer_id` is unique and the insert yields to a row already
there, so two repeats at once store one follow-up and both return it. **Rejected:** generating in
the answer's own transaction (a model call inside a transaction, `07` §1), and generating on resume
or in the slot (three writers of one row, and a reload that costs a model call).

### [2026-10-03] Where a round is, is one derivation: a position is its question, then its follow-up

`roundStep` reads the round's answers and `follow_ups` rows and returns the one thing to do next.
Per position: the bank question's answer; then its `follow_ups` row — absent is "due", `missing`
ends the position, `generated` is asked; then the next position. **Only an original answer to a bank
question is ever looked up for a follow-up**, so "no follow-up for a follow-up's own answer or for
practice's answer-again" is how the derivation is built, not a rule a caller remembers. Handlers and
the round page read the same function. A position's answers are ordered question first, then
follow-up, then by `created_at`: they share the position, and a round's rows written in one
transaction share a timestamp.

### [2026-10-03] A follow-up call is bounded at 15 s, with one retry

Measured through the real port and `follow-up-en-1.0`, 15 calls on synthetic answers (`03` §4):
3.2 s median, 4.7 s slowest, 685 tokens in and 124 out. The user waits for this call inside a round,
so it has its own bound, about three times the slowest seen, and **one retry after 1 s** when the
failure is one a second call could get past — not a `4xx` other than `408`, `409` or `429`. Then the
follow-up is missing. **Rejected:** scoring's three retries with 2, 4 and 8 s backoff (fourteen
seconds of waiting before a call that may also fail, for one prompt), and no retry (a single `503`
would cost the follow-up). **`follow-up-ja-1.0` is written and not measured**: no Japanese round
exists until #43, which is also where its output gets its native read.

### [2026-10-03] The follow-up prompt reads the question and the corrected answer, and nothing else

The round type, the question as asked, the corrected transcript. No CV, no role context, no rubric,
no earlier answer: a follow-up digs into what was just said, and grounding arrives with #46 as a new
prompt version if it arrives. The output is checked before it is stored — one question, not blank,
at most 400 code points, several times the 30 words or 60 characters the prompts ask for. English
ends in `?`; Japanese ends in a question mark or `か。`. A second sentence or question is refused, so
malformed output is a failed call, not a prompt put to the user; a full stop followed by a space
ends a sentence whatever the case of the next word ("I see. how did you measure it?" is refused),
while one inside a figure ("1.5 s", "v1.2"), or closing a known abbreviation ("vs.", "etc.",
"approx.", "Inc.", "Ltd.", "Co.", "Corp.", "Dr.", "Mr.", "Mrs.", "Ms.", "St.") or a single-letter
initial ("e.g.", "U.S."), is not a second sentence. The list is finite, so an unlisted abbreviation
loses its follow-up as missing, and a single-letter initial before a second sentence still passes. **Not detected, on purpose:** one sentence
that asks two things. A rule on a conjunction cannot tell it from a single question containing
"and", and would turn good follow-ups into missing ones, so that is the prompt's job. The model is
`FOLLOW_UP_MODEL`, the same pinned string as scoring, in `lib/ai/models.ts`.

### [2026-10-03] Round feedback reads follow-up answers too: `feedback-en-1.2`

A follow-up's answer is scored like any other, so it is sent to the feedback generator, under its
parent's number: `=== answer 2, follow-up ===`. `feedback-en-1.2` says what that block is and how to
point at it, and is otherwise `1.1`, the CV-grounding prompt (#46), which is untouched;
`round_feedback.prompt_version` says which wrote a row. **It was `1.1` on this branch until the rebase
onto #46, which had taken that number first.** A 7-question round now sends up to 14 answers. **Not
re-measured:** the feedback call's latency was measured on three answers (2026-10-01 and, with the CV
check, 2026-10-03) and its 120 s timeout is unchanged.

### [2026-10-03] Rebased onto #46: migration `0009`, and a follow-up's answer goes through the CV check

#46 merged first and took `0008`, so `follow_ups` is `0009_follow-ups`, regenerated by `drizzle-kit
generate` against #46's snapshot; the SQL is the same statement for statement. A follow-up's answer is
scored by the same port, so it is checked against the CV like any answer: its citations count as use
of a claim in the round's never-cited set, and its flags are stored and sent to the feedback call
under `answer 2, follow-up`. **Screen 8's `Checked against your CV` names the bank questions'
unsupported spans only**, as its score rows do; a follow-up's flag is stored and not drawn. **Open:**
whether it gets a rail of its own, which needs a label and its Japanese string (`10` §8).

### [2026-10-03] Follow-up tokens count toward the week's spend

`follow_ups.tokens_in`/`tokens_out` join the digest's token union (`12` §6), priced by `model_id`
like the rest. A `missing` row stores no tokens: a failed call returns no usage.

### [2026-10-03] Follow-up details the screens needed in English

The round header's step reads `Question 2 / 3 · follow-up`: the follow-up shares its question's
position, so it shares its number. Screen 6's caption names the follow-up only when one will be
written — not under a follow-up's own answer. A committed answer whose follow-up is missing or not
yet stored is a locked frame with one control, `Go on`. Screen 8's follow-up row reads `Scored on 6
dimensions. Not counted in progress.`, `Not scored yet.` or `Not scored.` with the same second
sentence; a missing one reads `The follow-up was not generated. It is recorded as a gap.` in the
attention ink (`10` §8). Setup's estimate is `3 questions + 3 follow-ups · up to about 24 min`
(`10` §2). An abandoned round is sent no follow-up call and gets no row.

---
## Phase 6 — #43, Japanese rounds

The round #42 built, in the other language: rubric `ja` v1.0 with 敬語, the Japanese set pieces, pace
in characters, the screens in Japanese, and the feedback's English toggle. No migration — every column
was already there. These are the choices the build needed.

### [2026-10-03] The translation is written by the feedback call, and stored beside it

A Japanese round's feedback call returns the feedback **and its English translation** in one
structured output; `round_feedback.body_translated` holds `{ language: "en", to_fix, what_worked }`.
A result with no translation, or one that does not match the feedback item for item, is refused as
`malformed_output`: no row is written, and `07` §5.16's retry writes it. **Why one call:** the row is written once and whole
(`04`), so a translation that arrived later would be an update to it, and a translation that failed
alone would leave a row the toggle cannot read. The dimension names need no translation — a rubric
carries `label_ja` and `label_en`. **Rejected:** a second model call at round end (a second failure
path and a second wait, for text the first call can write); translating on demand when the pill is
pressed (a spinner on a screen that renders from stored rows, and a model call from a `GET`);
translating the per-answer justifications too (they are not shown yet, and they are stored per score,
where a translation has no column).

### [2026-10-03] The pill changes the feedback and nothing else

On a Japanese round's feedback, `English` switches the seven dimension names and the round-level
findings with their two headings; the header, the question, the figures, the pager and the stamps stay
Japanese (`10` §8). It is page state, not a stored preference, and an English round has no pill.
**Why:** PRD §4 and US-10 ask to *read the feedback* in English — the user reads Japanese feedback
slowly, not Japanese chrome. A pill that turned the whole screen English would make the round's
language a display setting, which `10` §0 decided it is not. **Rejected:** translating the question
(it is the thing that was asked, in the language it was asked in); remembering the choice across
rounds (a setting with one user and no screen to change it on).

### [2026-10-03] The six Japanese section labels

`10` §0 has the artboards' Latin labels become Japanese in a Japanese round and names six. Chosen:
`文字起こし — 未修正`, `あなたの回答 — 自由に直せます`, `未修正の文字起こし — 置き換えずに残します`,
`書き直し`, `講評の前に`, `緊張度について`. Set in mono at `0.16em`, no `text-transform` (`05` §3.3).
The last is not a translation of `WHAT THIS IS NOT`: a literal one reads as a riddle, so the label
names its subject and the three lines under it do the denying. All six were accepted by the
checklist's read (`docs/checklists/native-read-round.md`, and the entry above). The tab titles follow the round too — `ラウンド — Suburi`,
`講評 — Suburi`.

### [2026-10-03] The Japanese prompts are written in English, and the model input names dimensions in the rubric's language

`score-ja-1.0` and `feedback-ja-1.0` give their instructions in English and ask for Japanese output,
as `cv-extract-ja-*` does: the instructions are the part a reviewer must be able to check, and the
anchors the model scores against are already Japanese. Both ask for plain form (常体) throughout —
`05` §6's one-register rule, for a list of things to fix — with quotes in 「」 and counters in 件, 問,
分, 秒 and 字. The rendered input names each dimension by the rubric's own label (`構成`, not
`Structure`) and states pace as characters per minute. **The English prompts are not touched here**:
`score-en-1.0` and `feedback-en-1.0` are still the versions that produced #42's rows, and their `1.1`
is #46's. **Rejected:** prompts written in Japanese (unreviewable by the person who owns them, and
no evidence they score better); one bilingual prompt with a language switch (two prompts in one file,
and a version bump for one language would restamp the other).

### [2026-10-03] Pace is counted in the transcript's own units, and the rubric says what is normal

`ja` pace is code points of `transcript_raw` without whitespace, per minute; `en` stays words
(`11` §3.9: `3:12・約250字/分・800字`). The count on the correction screen uses the same unit, so
`800字 → 812字` and the pace agree. Rubric `ja` v1.0's length and pacing dimension names 1–2 minutes
as a typical answer, about 3 as the upper end, and 250–350 字/分 as an unhurried pace — the figures
the anchors are read against, and so part of what the user reviews. **Rejected:** morae or
morphemes (neither is what `10` §5 draws, and both need a tokenizer to count what a person cannot
check by eye).

### [2026-10-03] Setup offers the language; the default stays English until #51

Setup's language row is now a choice, named in English (`Japanese`, `English`) because Setup is an
app-level screen (`10` §0), and the CV and rubric lines follow it — a stored `応募書類 v3` stays as
stored. The default is still `en`: defaults come from spacing, and that is #51. `POST /api/rounds`
takes either language; anything else is a `400`.

### [2026-10-03] Synthetic Japanese questions, and one checklist

`develop` gets 17 synthetic Japanese bank questions, parallel to the English ones and stamped
`synthetic-generated-ja-1.0`, so a Japanese round can be filled before generation exists (#47).
Production never gets them (`12` §1). `docs/checklists/native-read-round-loop.md` is renamed
`native-read-round.md` — the path #43's criteria name — keeping #42's three unread error strings as
its §1; every Japanese string #43 added is §2–§4, the rubric is pointed at from §5, and #46's strings
are its §7.

### [2026-10-03] A Japanese round goes through the CV check, as #46 left it to

#46 landed on `develop` first, English only, and wrote the Japanese round's side into `10` §8 for #43
to render. So `score-ja-1.0` carries `score-en-1.1`'s CV check and `feedback-ja-1.0` its untouched
material, both added before either was stamped on a row — `1.0` is still one prompt each. `untouched`
is returned once, outside `translated`: it is claim numbers, and has no language. `ROUND_COPY.ja`
gains the region's strings and the wrong-language line as `10` §8 gives them, and the region stays in
the round's language under the pill, like the rest of the chrome: every quote in it is stored
Japanese text. **Rejected:** a Japanese round with no CV check until a `score-ja-1.1` (the output
schema is one schema, so the model would return citations and spans its prompt never described).

### [2026-10-03] The rubric review and the native read were delegated to an AI, and say so

#43 marks two steps as the user's: reviewing rubric `ja` v1.0 with its native read before it is
seeded, and the native read of `docs/checklists/native-read-round.md` before the slice ships. **The
user does not read Japanese well and explicitly delegated both, on 2026-10-03, to firstmate — the
supervising AI agent, not a native speaker.** The same thing happened to the CV checklist (#38,
2026-09-27), and it is recorded the same way: as what it was, so a later human native read knows
there is something to revisit.

**The rubric.** All seven dimensions and thirty-five anchors reviewed: the Japanese reads naturally
and the levels are consistent and well separated. Approved for seeding with one change, in 敬語's
level 3: `二重敬語や「〜のほう」「〜になります」のような不適切な敬語` became
`二重敬語や、いわゆるバイト敬語（「〜のほう」「〜になります」）` — the category has a name, and
"inappropriate" judged what the anchor only needs to identify. Nothing had been seeded, so this is
still v1.0. A change from a later read is v1.1 (`04` §5).

**The checklist, §1–§4.** Every row accepted as written except these:

- **Numeral spacing** — the rule now in `05` §6: tight inside a sentence or phrase
  (`緊張度4をこのラウンドに記録します。`, `緊張度4を講評前に記録`), one space before a label's figure
  (`最長 4分`, `直すところ 3件`). `10` §7–§8's quotes follow.
- **A Japanese round's titles** are `人事面接` and `最終面接`, not the artboards' `HR` and
  `CEO・最終`: a Latin title over a Japanese screen was the last piece of Latin chrome in the round.
  The app-level screens are English and keep `HR` and `CEO / final` (`10` §0).
- **One develop fixture question**: `前のチームの人たちは、あなたが控えたほうがよいことは…` became
  `前のチームのメンバーは、あなたが控えたほうがいいことは…`.

Accepted as chosen: the six section labels, and `採点中` beside `未採点`. **Rejected:** holding #43
until a native speaker is found (there is one user, and the strings are replaceable copy — unlike a
seeded rubric, which is why that review came first); recording either as a native read (the next
reader would not know to look).

### [2026-10-03] Rubric `ja` v1.0 is drafted, not seeded

`lib/rubric/ja-1.0.ts` holds seven dimensions with five anchors each, written in Japanese. It is in
`RUBRICS`, so `db:seed:develop` would seed it — and **no seed is run until it has been reviewed,
with its read**: `rubric_versions` is immutable once a row exists (`04` §5), so a wording
changed after the seed is v1.1 with a re-score and a boundary on every chart. The review is #43's
first acceptance criterion and precedes its merge; the entry above records how it was done. **Rejected:** seeding a draft on `develop` and
bumping to v1.1 after the read (the first Japanese rounds would sit on the wrong side of a boundary
drawn for a typo).

---

## Phase 6 — #46, CV grounding

Round loop slice 5: citations, unsupported claims, untouched material, the wrong-language reading and
coverage on `/cv`. The plan was settled on 2026-09-27 (below); these are the choices the build needed.
English only, like the tracer it extends — the Japanese round is #43's, and takes these with it.

### [2026-10-03] The models are shown numbered claims and return numbers, never ids

The scorer and the feedback call are sent the CV's claims as a numbered list, `[1]` to `[n]`, each the
claim's text **sliced from `cv_versions.body` by its span**, and they answer with numbers. The server
maps a number back to the claim it was shown as. An id is never sent and never read back, so there is
no id for a model to invent, and a number outside the list names nothing and is dropped and counted.
**Rejected:** sending `cv_claims.id` and validating the uuid that comes back — it works, but it spends
tokens on 36 characters a claim and asks the model to copy opaque strings exactly; and asking for a
quote of the claim and locating it in the body, as extraction does — a second fuzzy step where a
number is exact.

### [2026-10-03] A claim is citable only if its stored span still reads as the claim

"`claim_citations` written only after span validation" (`07` §5.10) is done before the call, not
after: each claim's stored span goes through the validator that admitted it at save time, and its
slice must still normalise to `text_normalised`. A claim that fails is not shown to the scorer, so
nothing can cite it, and it is counted (`claims_rejected`). On a healthy database the count is zero
forever — `body` is immutable and spans are validated at save — so a non-zero count is a corrupted row
found at the moment it would otherwise have been quoted on screen. **Rejected:** trusting stored spans
because they were validated once; the rule is that a quote is checked where it is used.

### [2026-10-03] "Dropped and counted" is a log line, not a column

`scoring_ok` carries `claims`, `claims_rejected`, `citations`, `citations_dropped`, `flags`,
`flags_dropped`; `round_feedback_written` carries `never_cited`, `untouched`, `untouched_dropped`.
Counts only, beside ids and durations (`03` §8). **Rejected:** counter columns on `scoring_attempts`,
the way `cv_versions` carries extraction's counters — those are read by the user on `/cv` after every
save, where these are a question about the prompt asked once in a while, and a column per counter on
the measurement table is schema for a number nobody is shown. If the digest ever needs a drop rate it
reads the logs' successor, and that is a decision for then.

### [2026-10-03] Untouched material is the round's never-cited claims, and a contradicted claim was used

The set the feedback call picks from is the CV version's citable claims minus those cited by an answer
**in this round**, with either relation. Round-scoped because the finding is about this sitting — what
was left on the table today — so a claim used in last week's round can be untouched in this one;
all-history "never used" is coverage, and lives on `/cv`. A `contradicted_by` citation removes the
claim from the set: the answer did reach for it, and telling the user it went unused would be false.
**Rejected:** all-history never-cited (after a few months it would be the dregs of the CV, not what
this round missed).

### [2026-10-03] Untouched picks that fail validation are dropped; the feedback is still written

`untouched_claim_ids` holds whatever survives — none to three, in the order picked — a repeat ignored,
a fourth dropped. Feedback whose picks were all invented is stored with an empty list and the screen
says nothing was picked. **Rejected:** failing the call and retrying for better picks: `round_feedback`
is one row written once, the fix list and what-worked are the larger part of it, and a retry that
changes them to repair a secondary list trades a certain cost for a small gain. Padding to two from
the set by some rule of our own was rejected too — a claim the model did not pick is not "relevant".

### [2026-10-03] An `ok` attempt with no `answered_language` is not a mismatch

`scoring_attempts.answered_language` is nullable, `check (answered_language is null or status = 'ok')`,
and written on every `ok` attempt from `score-en-1.1` on. Attempts scored by `1.0` stay null, and null
means "not read", so those answers carry no wrong-language line and Progress (slice 10) does not
exclude them on that ground. **Rejected:** `not null` with a back-fill of the round's language — a
value the scorer never returned, on the measurement table; and treating null as a mismatch, which
would empty Progress of every answer scored before today.

### [2026-10-03] The grounding region is drawn only for a round that was checked, and says "none"

Screen 8 draws `応募書類との照合` when some answer's latest `ok` attempt carries `answered_language` —
the mark that the attempt went through the CV check. Inside it, **no unsupported span is stated**
("nothing flagged against CV v3") rather than left blank, and so is no pick. A round scored before the
check has no region at all. The two are different facts — checked and clean, never checked — and
drawing the first for the second would be a claim nobody verified. Each unsupported rail names its
question, since the region is round-level and the span is one answer's. **Rejected:** the flags inside
each answer's page of the pager (`10` §8 puts the region in the round-level column, where the fix list
that refers to it is); one rail joining every quote (it loses which answer said it).

### [2026-10-03] The fix list may quote the CV; the grounding region is the checked part

`feedback-en-1.1` may name an unused claim in a `to_fix` item, "exactly as the input gives it". That
prose is model text and is not span-checked, the same as the fix list's quotes of the user since 1.0.
What is checked is everything under `応募書類との照合`: those strings are slices of stored text by
validated span and never the model's words. **Rejected:** verifying quotes inside prose (a fuzzy
matcher over free text, which is the thing the span rule exists to avoid) and forbidding the prose
from mentioning the CV (the fix list is where "use this claim there" is said in a sentence).

### [2026-10-03] "Unsupported" is a claim a CV would carry, not the steps of a story

A first draft of `score-en-1.1` asked for "facts about the speaker's record that no claim supports",
and against the real model on synthetic answers it flagged the narration of every story — what was
measured, what was written, what went first — up to its limit of three an answer, as whole sentences;
the feedback call then told the speaker to remove or "verify" them. That is the accusation US-11 rules
out. The prompt now asks for **what a CV would carry and this one does not** — a result, a role, the
size of a responsibility, a qualification, a length of experience — says that a story's steps are
narration even when they carry a number, that most answers have none or one, and that the quote is a
clause. `feedback-en-1.1` says an unsupported part is a gap and may well be true, never tells the
speaker to drop it, offers an unused claim only where it is evidence for the same point, and counts a
claim as untouched material only when it backs a point an answer was making or answers a question
asked — not for sharing a topic. Re-run on the same answers: one or no flag an answer, each a clause,
and the three picks were the three claims written to fit the questions. Both files were tightened
before either was stamped on a row, so `1.1` is still one prompt. **Rejected:** capping flags at one
per answer in code (a cap hides an over-eager prompt instead of fixing it) and dropping flags from the
feedback call's input (the fix list is where "the CV has something for this" gets said).

### [2026-10-03] The CV check is measured; `complete` still waits 60 s

The scoring and round-feedback measurements of `scripts/measure-round-latency.mts`, five runs against
OpenAI, synthetic answers and a synthetic CV of 80 claims (`03` §4 has the table). Scoring with `score-en-1.1`: 9.7 s median,
19.5 s slowest of 15, against 7.1 s and 38.1 s for `1.0`. Round feedback with `feedback-en-1.1`: 15.4 s
median, 19.5 s slowest, against 10.0 s and 11.0 s. The rule that set the bound — slowest scoring call,
a 2 s backoff, a median retry — asks for 31 s here, so **60 s stands**, sized by #42's slower tail on
the same model. Nothing the validators check was dropped in 15 scored answers and 5 rounds, and the
untouched picks were the claims written to be found. **Rejected:** lowering the bound to this run's
tail (fifteen calls do not retire a 38 s call seen two days earlier) and raising it for the larger
prompt (the measurement does not ask for it).

### [2026-10-03] Coverage on `/cv` is the underline's weight, inherited down the chain only

A used claim is underlined `2px --accent`; an unused one keeps `1px --accent-mid`; the stamp row adds
the never-used count and one legend line (`10` §13). **Used** is "this claim or a claim it was carried
forward from has a citation", either relation, read from `claim_citations` at render by one recursive
query (`lib/cv/coverage.ts`). Down the chain only: a v1 claim does not become used because its v3
descendant was cited, so an old version's page keeps showing what was true of it. **Rejected:** a
second colour or a marginal tick (a new mark on a screen whose point is reading one's own text
undisturbed); dimming unused claims (it reads as "wrong", and they are only unsaid); a coverage
percentage (one step from a composite about the user — `10` §13 now refuses it); a stored
`is_covered` column (it goes stale the moment an answer is scored).

### [2026-10-03] The grounding slice's Japanese strings are specified, not built, and unread

The Japanese round is #43's, so `ROUND_COPY` gains no `ja` here. The region's Japanese copy and the
wrong-language line are written into `10` §8 for #43 to render; the two `/cv` strings (the count line
and the legend) are built, since that panel is already Japanese. All are in
`docs/checklists/native-read-round-loop.md` §2, unread.

---

## Phase 6 — the audit's one accepted advisory

### [2026-10-03] CI's audit accepts GHSA-vfj7-8cjw-p6xm until a patched `braces` ships

**Decided:** CI's audit step runs `npm run audit:ci` (`scripts/audit.mts`). It reads `npm audit --json`
and fails on every high or critical advisory except GHSA-vfj7-8cjw-p6xm on `braces` `<=3.0.3`
at high severity. The level stays at high.
**Found:** the advisory (stack exhaustion on deeply nested patterns, high) was published 2026-09-18
and has no patched release; `braces` 3.0.3 is the latest and is inside the range. `braces` arrives only
through `micromatch` → `fast-glob`, under `@next/eslint-plugin-next`, `ts-morph` and `shadcn`. Those
are the linter and the `shadcn` CLI; the app takes only `shadcn/tailwind.css` from them. They expand
globs written in this repository, never request input. `npm audit --audit-level=high` failed on it,
on `develop` and on every branch off it. npm audit has no flag that ignores one advisory, and its
offered fix is `shadcn` 1.0.0, a downgrade.
**Remove it when** a patched `braces` ships (update to it in the same change) or the advisory is
withdrawn. The entry is held to the package, high severity, and range `<=3.0.3`, and the audit fails
when npm reports a change in any of them. It does not fail when npm stops reporting the advisory; removing
the entry then is by hand.
**Alternatives considered:** lowering the level or dropping the step, which lets every other high
advisory through too; `npm audit --omit=dev`, which still reports it (`shadcn` is a dependency) and
stops auditing the tooling; an npm `overrides` entry, which has no patched version to point at; an
allowlist tool such as `audit-ci` or `better-npm-audit`, a new dependency tree for what is one small
tested module here.
**Reason:** the audit stays as strict as it was for everything but one advisory nothing can fix yet.

---
## Phase 6 — #42, the round-loop tracer

The thinnest round, end to end: realistic, English, `hr`, length 3, General practice, rubric `en` v1.0.
The plan was settled on 2026-09-27 and 2026-09-28 (below); these are the choices the build needed, and
the latency measurement those entries asked for.

### [2026-10-01] The round's model latencies are measured; `complete` waits 60 s

`scripts/measure-round-latency.mts`, five runs of each against OpenAI with synthetic answers (`03` §4
has the table). Scoring: 7.1 s median, 38.1 s slowest of 15. Round feedback: 10.0 s median, 11.0 s
slowest. Transcription of a near-cap take: about 6 s. TTS's first byte: about 1 s. Follow-up and
question generation ran **draft** prompts, since their ports do not exist yet (#44, #47): about 3 s
and 4 s. **`complete`'s wait bound is 60 s**: the slowest scoring call, a 2 s backoff and a median retry,
and with the feedback call's 120 s timeout it stays inside the route's 285 s deadline — a unit test
holds that sum. **Generating every question at round start is tolerable**: seven and their embeddings
take about 4 s beside the preflight. **Rejected:** a bound of the full remaining budget (the user would
wait minutes for a tail the retry path already covers), and a bound from the median alone (one call in
fifteen was five times it).

### [2026-10-01] The round routes' rate limits

`rounds`, `complete` and `feedback` 6 per 10 minutes; `transcribe` and `submit` 30 per 10 minutes —
a 7-question round with follow-ups makes 14 of each, so 30 is two such rounds with retries to spare.
Each its own bucket (`07` §1 rule 5), and `rate_limit_windows.route` names all five (`04`).

### [2026-10-01] The tracer is English and General practice only, and says so

`POST /api/rounds` takes `language: "en"` only — `ja` is a `400` until #43 brings its rubric and set
pieces, rather than a round with nothing to score it against. `POST /api/role-contexts` takes
`general` only until #47 builds postings with their measured cap. **Setup states both** instead of
drawing controls that do nothing: round type and length are chosen; English, realistic and General
practice are shown as the only options that exist. Home carries a plain `Start a round` until #51
builds it.

### [2026-10-01] Until generation exists, a short bank falls back to seen questions

The tracer has no question generation (#47), so `07` §5.4's step 3 cannot run. A realistic round short
of unseen bank questions takes seen generated ones — never first attempts (§5.6) — and a bank that
cannot fill the round at all is `502 question_generation_failed` with `error_class: "bank_too_small"`,
nothing written. **Rejected:** refusing any round that would repeat a question, which would stop the
loop on `develop` after a few rounds; and silently asking a set piece twice, which `07` §5.4 rules out.

### [2026-10-01] Set pieces are asked in the order the content lists them

Seeded rows share one statement's `now()`, and selection broke that tie on a random id, so a first
round could open with the reason for leaving. The seed now dates each row a millisecond apart in the
listed order, so the self-introduction comes first. The order is content, checked in with it.

### [2026-10-01] The scoring and feedback prompts 1.0 read no CV

`score-en-1.0` and `feedback-en-1.0` read the rubric, the question, the corrected answer, its duration
and pace — and not the CV version's claims, citations or untouched material, which arrive with #46 as
new prompt versions. The stamps already say which prompt scored what, so the boundary is drawn where
the prompt changes.

### [2026-10-01] A take's duration is the transcriber's, not the browser's

`answers.audio_duration_ms` comes from `gpt-transcribe`'s `usage.seconds`, and the pace from it and the
raw transcript. The browser's clock is never sent: the client chooses nothing that is measured (`07`
§1 rule 6), and the transcriber has the audio the pace describes.

### [2026-10-01] Slot and submit edges `07` left implicit

`audio_s3_key` is written when the slot opens: the key is server-derived and fixed for the row, so a
retried open presigns the same one. Opening a slot when every position is submitted is
`422 answer_already_submitted`. Submitting before transcription is `400 invalid_request` naming
`transcript_raw` — there is nothing to correct. An already-complete round's `409` carries
`has_feedback`, not the feedback: the envelope's `detail` is flat (#13), and screen 8 reads the
feedback from the round.

### [2026-10-01] `S3_ENDPOINT`, local hosts only, for Playwright's bucket

Playwright's round spec needs the browser's presigned `PUT` and the server's read to reach a bucket
that is not S3. `S3_ENDPOINT` points the SDK at `e2e/mock-s3.ts`, path-style, and `lib/config.ts`
refuses any host but a local one, so no value can send the AWS key elsewhere — the same rule as
`OPENAI_BASE_URL`. **This does not reopen MinIO**: local development still uses the real bucket under
`dev/` (2026-09-28); the variable is unset everywhere but Playwright. Playwright now runs **one
worker**: every spec is the one user against one database, and the mocks listen on fixed ports.

### [2026-10-01] Rubric `en` v1.0 is drafted and seeded on `develop` only

Six dimensions, each a definition `{summary, anchors}` with exactly five anchors, level 1 first, and
both labels (`04` `rubric_versions`). It is on `develop` for the tracer's proof; **production's
`db:seed` gains it only after the user's review** (`12` §3 step 9). A changed rubric after review is
`v1.1`, never an edit to `v1.0`.

### [2026-10-01] Round-screen details the artboards could not settle in English

A score at the **low end is 2 or below** — the artboard's `長さ・配分 2` takes the attention colour and
its 3s do not. The score row's label column is **120px, not 100**: `Length and pacing` wraps at 100px,
and the artboard measured Japanese labels. Until speech exists (#45) the record frame keeps an empty
line where the speaker line goes, so the question does not move when recording starts (`10` §4).

---
## Phase 6 — #56, the daily dump

The daily dump `12` §8 requires, written by `self-check` with its own write-only IAM user, built from
the 2026-09-28 and 2026-09-29 decisions below. The one open question was how a dump runs inside a
Vercel Function at all; the rest are the choices the build needed.

### [2026-09-30] `suburi-backup-writer` exists, and can only write under `backups/`

**Done** with the AWS CLI, as #41 did for the app users: the IAM user `suburi-backup-writer`, with one
inline policy, `suburi-backups-put`, allowing `s3:PutObject` on `arn:aws:s3:::<bucket>/backups/*` and
nothing else; no groups, no managed policies. One access key, created by the CLI and piped straight
into Vercel's **Production** scope as `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY`
(Secret), never printed or written to a file. The bucket name was read from `suburi-s3-prod`'s own
policy, not typed.
**Verified with the IAM policy simulator:** the backup writer is allowed `PutObject` on a `backups/`
key and implicitly denied `GetObject`, `DeleteObject`, `AbortMultipartUpload` and
`ListMultipartUploadParts` there, `PutObject` and `GetObject` on `prod/` and `dev/`, `PutObject` on a
`backupsX/` key, and `ListBucket` and `ListBucketMultipartUploads` on the bucket. `suburi-s3-prod`
and `suburi-s3-dev` are implicitly denied `PutObject`, `GetObject` and `DeleteObject` on `backups/`,
and each is still allowed `PutObject` and `GetObject` on its own prefix. Neither app user was changed.

### [2026-09-30] The dump is written in-process, not by a bundled `pg_dump` binary

**Checked** against Vercel's *Vercel Functions Limits* and *Configuring Maximum Duration* (both last
updated 2026-08-24) and *Build image overview*: with Fluid compute, Hobby functions run at most
**300 s** (default and maximum), with **2 GB / 1 vCPU**, and a function bundle may be **250 MB
uncompressed**; in Next.js, extra files join a function only through `outputFileTracingIncludes`.
The build image is Amazon Linux 2023, and no Postgres client is in its package list.
**So a binary would fit:** a Postgres 18 `pg_dump` with `libpq` is a few megabytes, and this
database dumps in seconds. **It was still rejected.** Nothing on the runtime provides it, so it would
be a Linux build copied from PGDG's packages with its shared libraries (`libpq`, OpenSSL, `zstd`,
`lz4`), matched by hand to an image Vercel can change underneath it. It could not run in CI or on a
Mac, so the test that proves the file restores would test something other than what production
runs, and whether it runs on Vercel at all can only be seen on a deploy; feature branches are not
deployed (`12` §1). Its TLS would also be libpq's, which needs `sslrootcert=system` beside
`verify-full`, a second rule `lib/config.ts` does not enforce.
**Decided:** `lib/backup/dump.ts` writes a logical dump from Node over the same `pg` driver and URL
rule as the app. One `repeatable read, read only` transaction; for each table in `public`, parents
first, a `COPY … FROM stdin` block holding exactly what Postgres writes for `COPY (SELECT …) TO
STDOUT` (`pg-copy-streams`), with `datestyle`, `intervalstyle` and `extra_float_digits` set as
`pg_dump` sets them. `psql -f` loads it. The body streams through `@aws-sdk/lib-storage`: one
PutObject under 5 MB, otherwise parts of 5 MB, at most two in memory.
**Alternatives considered:** the binary, above; `INSERT` statements built in JavaScript, which would
reimplement every type's literal syntax that `COPY` gets from Postgres itself; a Vercel Workflow or
another host, which the dump's size does not call for.

### [2026-09-30] The dump carries data, not schema, and checks its own restore

**Decided:** the file has no DDL. The schema is the migrations in git (`12` §8 already backs Git up),
and the header names the newest migration the database had applied, from `drizzle.__drizzle_migrations`,
by its `db/migrations` tag. A restore loads onto a Neon branch made Schema only from `main` while `main` has
applied no migration since the dump, or an empty database migrated to that tag. The file sets `ON_ERROR_STOP`, runs as one transaction, refuses a
target that already holds rows, and checks every table's row count against the dump before its
`COMMIT`, so a file cut short or loaded twice writes nothing. drizzle's journal travels with the
data: the rows of `drizzle.__drizzle_migrations` load into a temporary table and go into the target's
journal only if it is empty, then its `id` sequence is set past them. A Schema only branch has the
table and none of its rows, so without them a promoted branch would have `drizzle-kit migrate` re-run
`0000` and fail on tables that exist. A target `drizzle-kit migrate` built already holds the same rows
and keeps them. The file also carries an md5 of `public`'s tables with their columns, constraints and
indexes, taken in the dump's snapshot, and the restore runs the same query on the target and refuses
before any row if it differs. A Schema only branch from a `main` that migrated since the dump would
otherwise take a journal older than its schema, and the next `drizzle-kit migrate` would re-run the
newer migration against objects that exist.
**Alternatives considered:** rebuilding `CREATE TABLE` statements from the catalogs, which is
`pg_dump`'s hardest job, done a second time and worse; a data-only file without the guards, which
would merge silently into a database that was not empty.
**Reason:** `12` §8's restore path is already "into a Neon branch", and a Schema only branch is exactly
the empty, migrated target this file needs. The guards make a mistaken restore fail rather than
half-succeed.

### [2026-09-30] A failed dump is a red row, not a failed run

**Decided:** `self-check` writes the dump first, then reads its other rows. A tenth signal,
`backup_dump_failed`, is 1 when the dump failed and 0 when it was written, recorded for every user
because the dump is the whole database. The run's other readings still land when the dump fails.
With no backup key, which is everywhere but production, the row is no reading, not a pass. A missing
dump is `self-check` not running, and the staleness line already says that first. Migration
`0006_backup-signal` widens `cron_readings_signal_check`.
**Alternatives considered:** a `backups` table with its own "last dump" line; failing the whole run,
which would hide nine good readings behind one bad one.
**Reason:** `12` §6's rows already carry exactly this shape, and the status page and Home show a red
row without new UI.

### [2026-09-30] Production refuses to boot without the backup key

**Decided:** `BACKUP_AWS_ACCESS_KEY_ID` and `BACKUP_AWS_SECRET_ACCESS_KEY` are required when
`VERCEL_ENV` is `production`, as `CRON_SECRET` is; either one without the other is refused anywhere;
and the backup key may not equal `AWS_ACCESS_KEY_ID`.
**Reason:** a production that booted without it would write no backup and show only a "no reading"
row. The equality check catches the one mistake the separate user exists to prevent.

### [2026-09-30] Dated keys, SSE-S3, plain SQL, and multipart parts left on failure

**Decided:** the key is `backups/<the run's instant>.sql`, colons as hyphens
(`backups/2026-09-30T19-12-40.123Z.sql`), so a duplicate Vercel delivery writes a second object rather
than overwriting the first. Each PUT sends `x-amz-server-side-encryption: AES256`, the bucket's own
default made explicit. The file is not compressed: at this size the saving is cents, and `psql -f`
reads it as it is. The upload sets `leavePartsOnError`.
**Reason for the last:** AWS's multipart permissions table (*Uploading and copying objects using
multipart upload*, checked 2026-09-30) needs `s3:PutObject` to create, upload a part and complete, and
`s3:AbortMultipartUpload` to stop one, which the backup-writer's policy does not grant. An abort that
is refused would replace the real error with `AccessDenied`. A failed dump over 5 MB therefore leaves unlisted parts under
`backups/`, which cost almost nothing at this size, and `backups/` gets no lifecycle rule (2026-09-29).

---
## Phase 6 — Sentry (#54)

### [2026-10-01] `next.config.ts` names the Sentry organization

**Decided:** `withSentryConfig` gets `org: "personal-projects-ge"` beside `project: "suburi"`. This
replaces the 2026-09-30 reading that an organization token names its organization, so no org slug is
needed.
**Found:** `develop`'s first build with the Sentry variables (2026-09-30) logged `Failed to create
release: 403 Forbidden` and `API request failed: 403 Forbidden` from the upload step. The upload is
done by the `sentry` JS CLI (0.44.1, through `@sentry/bundler-plugins` 11.1.0). That CLI does not
read the organization out of an org token. Without an `org` it finds the organization from
`SENTRY_DSN` by calling `GET /api/0/organizations/`, and an `org:ci` token is refused there (403),
as it is on the organization and project detail endpoints. The same token is allowed on
`chunk-upload`, on the project's releases and on creating a release. So the scopes were enough; the
lookup was not.
**Alternatives considered:** `SENTRY_ORG` in Vercel, which leaves the fix outside the repository; a
personal token with wider scopes, which Sentry advises against for CI and which would still need the
org named.
**Reason:** one line in the file that already names the project, with no new credential.

### [2026-09-30] Sentry is optional at boot, and on only where Vercel says production or `develop`

**Decided:** `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` are the one optional pair in `lib/config.ts`. With
no DSN, Sentry is off and the app boots; a malformed DSN, or a DSN without its token, still fails the
boot. Even with a DSN, Sentry is on only when Vercel's `VERCEL_ENV` is `production` (tagged
`production`) or `preview` with `VERCEL_GIT_COMMIT_REF` = `develop` (tagged `develop`).
**Alternatives considered:** both variables required at boot, which would put a Sentry value in every
`.env.local`, in CI and in Playwright's environment; required in production only.
**Reason:** `12` §1 has Sentry off locally, and CI and Playwright must set nothing real. Deriving the
tag from Vercel's system variables means no one can hand-set it, and a DSN copied into `.env.local`
cannot switch a laptop on.
**Cost, accepted:** a production deploy with the DSN missing boots without Sentry instead of failing.
`12` §3 step 11 and §9's smoke check are where that is caught.

### [2026-09-30] SDK v11's `dataCollection` stands in for `sendDefaultPii: false`

**Decided:** `@sentry/nextjs` 11.1.0, the current major. v11 removed `sendDefaultPii` and now collects
cookies, headers, user info and every request and response body by default. `lib/sentry.ts` sets
`dataCollection` with every category off, stack-frame variables included, and keeps the `beforeSend`
that drops bodies wholesale as the second lock.
**Alternatives considered:** pinning v10 to keep the literal option #54 names.
**Reason:** the intent of `sendDefaultPii: false` is "collect nothing about the request", and
`dataCollection` says it more strictly than v10 did. Pinning an old major for an option's name
trades that for Dependabot noise and a forced migration later.
**Consequence:** `lib/sentry.defaults.test.ts` shows v11's defaults sending the sentinel body; if a
later SDK changes a default, that test notices before production does.

### [2026-09-30] The DSN reaches the browser; nothing else does

**Decided:** `next.config.ts` inlines the DSN and the environment tag into the browser bundle at
build, from `lib/config.ts`, as `SENTRY_BROWSER_DSN` and `SENTRY_BROWSER_ENVIRONMENT`. Both are empty
where Sentry is off, and the browser SDK does not start.
**Alternatives considered:** server-only Sentry, which would leave exceptions on the recording
screens unreported; a `NEXT_PUBLIC_SENTRY_DSN` variable, against `12` §2's rule.
**Reason:** the browser SDK cannot report without a DSN, and a DSN only sends events in (2026-09-28).
`12` §2 says so where it says nothing else is shipped to the browser.

### [2026-09-30] Fetch breadcrumbs lose their query string; release-health sessions are off

**Decided:** fetch, XHR and Node HTTP breadcrumbs keep the method, the URL without its query and
fragment, and the status, built from those three keys. The event's request URL and Next.js's
`request_path` lose their query too. Browser, process and Node HTTP request sessions are off.
**Reason:** a presigned S3 URL carries its signature in the query, and the OAuth callback its code.
Sentry reports exceptions only; session counts are outside #54's exception-reporting scope.

---
## Phase 6 — #55, the monitoring jobs and the status page

The daily `self-check`, the weekly `digest` and the private status page they write to, built from the
2026-09-28 and 2026-09-29 decisions below. Two Vercel facts were checked first; the rest are the
choices the build needed that no earlier entry made.

### [2026-09-30] Only the two cron routes pass the proxy without a cookie

**Supersedes** the `/api/cron/*` exception below: only `/api/cron/self-check` and
`/api/cron/digest` pass `proxy.ts` without a session cookie. Each still requires `CRON_SECRET` in its
handler; every other `/api/cron/` path receives the normal session check.
**Reason:** a prefix exception would also exempt future routes that have no cron secret check.

### [2026-09-30] Verified: Vercel invokes cron jobs only for production, and sends the secret as a bearer token

**Checked** against Vercel's *Getting started with cron jobs* ("Vercel invokes cron jobs only for
production deployments and not for preview deployments"), *Cron Jobs* (a GET to the production
deployment URL, user agent `vercel-cron/1.0`) and *Managing Cron Jobs* (`CRON_SECRET` "automatically
sent as an `Authorization` header", compared as `Bearer <CRON_SECRET>`; a recommended 16 characters or
more; delivery is best effort and occasionally duplicated; no retry on failure; timezone always UTC).
**Consequence:** `develop` needs no refusal of its own. Its deployment is Preview, which Vercel never
calls on a schedule, and `CRON_SECRET` is Production-only (`12` §2), so a hand call there is `401`
like any call without the secret. The routes refuse outright when the secret is unset rather than
checking the environment, so the one rule covers `develop`, local and a misconfigured production.

### [2026-09-30] `CRON_SECRET` is required in production and optional elsewhere, keyed on `VERCEL_ENV`

**Decided:** `lib/config.ts` accepts an absent `CRON_SECRET` unless `VERCEL_ENV` is `production`, and
refuses one shorter than 16 characters anywhere. `VERCEL_ENV` is Vercel's own system variable,
available at build and runtime (verified 2026-09-30), read through `lib/config.ts` like everything else.
**Alternatives considered:** required everywhere, which would break `develop`'s boot for a variable
`12` §2 keeps out of Preview; optional everywhere, which would let production boot with its cron
routes refusing every scheduled call, discovered only when the status page went stale two days later.
**Reason:** the boot-time failure is the loud one `12` §2 asks for, and it belongs only where the
variable is required.

### [2026-09-30] Cron runs are two append-only tables with typed readings, not a JSON blob

**Decided:** `cron_runs` (one row per invocation: job, time) and `cron_readings` (one row per signal
per user per run: value, threshold, red, subject ids, window), designed in `04`. Readings carry
`user_id`; runs do not. Nothing is updated or deleted.
**Alternatives considered:** one table with a `jsonb` readings column; one run row per user.
**Reason:** typed columns make `12` §7 structural: a number, a threshold and a uuid array cannot hold a
transcript, and `signal` is value-checked. Per-user readings keep the tenancy rule (every query scoped
by `user_id`) true on a page that reads them; "when each job last ran" is a fact about the job, so it
stays one row whether there is one user or none.

### [2026-09-30] A CV counter reads the current version in each language

**Decided:** each of the five CV rows reads the newest version per language, takes the highest
non-null counter among them, and names the versions that trip it. Null on every current version is
no reading.
**Alternatives considered:** every version ever saved, which keeps one old bad reading red forever;
versions saved since the last run, which shows a bad reading for one day and then forgets it even
though rounds are still scored against that version.
**Reason:** the current version is the one every new round is scored against, so a bad reading
matters exactly as long as it is current. Saving a new version is what clears it.

### [2026-09-30] "This week" is the Asia/Tokyo week from Monday; the schedules follow it

**Decided:** spend is week-to-date from Monday 00:00 in Tokyo, and rounds are counted the same way.
The digest reports the Tokyo week that ended before it ran. `self-check` runs at `0 19 * * *` UTC
(04:00–04:59 in Tokyo) and `digest` at `0 20 * * 0` UTC (Monday 05:00–05:59 in Tokyo), both inside
Hobby's once-a-day floor.
**Reason:** "today" is already the user's local day in Asia/Tokyo (2026-09-28). A UTC week would put
Monday morning's practice in the previous week. Tokyo keeps no daylight saving, so the week is a fixed
+9 hours from UTC.

### [2026-09-30] `gpt-5.6-sol` is priced at $4.00 in and $20.00 out per million tokens

**Verified:** against OpenAI's API pricing page on 2026-09-30: Standard, short context (up to 272K
input tokens), $4.00 input, $0.40 cached input, $20.00 output per 1M tokens. The page also notes
GPT-5.6 Sol's promotional pricing runs at least through 2026-11-21. The rates are `MODEL_PRICES` in
`lib/ai/models.ts`, beside the pinned string.
**Decided:** every stored input token is priced as uncached. A token row whose model has no rate is
excluded from the dollar sum and named in the spend reading; `self-check` is red even below the dollar
threshold. A missing model stamp is also named. The digest names excluded models beside its spend.
**Reason:** only `tokens_in`/`tokens_out` are stored, not the cached split. A guessed rate can read low
when a model string changes; an explicit red reading makes the missing price visible.

### [2026-09-30] The status page is `/status`, reached from Home, not from the nav

**Decided:** specified in `10` §14 and §1 before building. One card: the staleness line first, then
the two jobs with their last run, the nine checks with reading, threshold and state, then last week's
digest. Home's line is a `05` §5.8 attention rail above the cards. The app header's nav stays
`Home · Progress · History · CV`.
**Reason:** the page is read when something is wrong, and Home's line says when that is; a fifth nav
item would make an instrument page look like a practice screen. The ids behind a red check stay in the
database, not on the page.

### [2026-09-30] The cron routes pass the proxy without a cookie

**Decided:** `proxy.ts` lets `/api/cron/*` through without a session cookie, and each route refuses
without `CRON_SECRET` before it reads anything. `07` §1 rule 1 and `08` §5 name the exception.
**Reason:** Vercel Cron sends no cookie, so the proxy's optimistic cookie check would `401` every
scheduled call. The proxy is not the security boundary (`08` §5); the handler's secret check is.

---
## Phase 6 — triage of the audit's tickets

A read-only triage on 2026-09-29 found #55 could not be built unattended: three of its signals were
stored nowhere a cron can read, its cost baseline was undefined, and its near-miss row read a log
line. #55 and #56 each held a criterion only production could meet, while #21 (production) was
blocked by both. The user answered each point.

### [2026-09-29] The five CV-upload counters are columns on `cv_versions`

**Decided:** by the user. `spans_rejected`, `claims_split`, `claims_duplicated`, `unclaimed_run_max`
and `quotes_outside_window` become nullable integer columns on `cv_versions`, written by the save in
the same insert and never updated. #55 adds them (expand-only) and `self-check` reads them.
**Alternatives considered:** a separate readings table keyed to the version; the save writing an
alert row straight into #55's run table; dropping the five rows from `self-check` and leaving them to
the per-upload eyeball (`11` §5).
**Reason:** until now the counters were only logged and returned in the save's response, and a
daily cron cannot read Vercel logs. On the version row, the reading sits beside the version it
describes, as the `extractor_*` stamps already do. Null covers versions saved before the columns and
`develop`'s synthetic seed.

### [2026-09-29] The round-cost baseline is a constant from `03` §6, re-measured after eight real rounds

**Decided:** by the user. `12` §6's "eight-round baseline" is a fixed constant now, about **$0.40
per round** (`03` §6). Week-to-date spend is every stored `tokens_in`/`tokens_out` row (`questions`,
`scoring_attempts`, `round_feedback`, and `follow_ups` once built), each counted in the week of its own
`created_at`, with no round attribution. The threshold is 3× the baseline × max(1, rounds started that
week). After eight real rounds the constant is replaced by their measured cost, with an entry here.
**Alternatives considered:** computing the baseline from the first eight completed rounds in the
data, which leaves the signal dead until then; attributing each row's spend to the week its round
started.
**Reason:** no round exists yet (#42–#51 are unbuilt), and a check that cannot fire until month two
is no check. Transcription is billed per minute, and extraction, speech and embeddings store no
tokens, so only the model calls that stamp a token pair are counted. Counting each row by its own
`created_at` needs no join back to a round; the floor of one round keeps a week with late scoring or
a retry but no round started from having a threshold of 0.
**Cost, accepted:** $0.40 covers the whole round, the token columns only part of it, so the threshold
is loose until the re-measure.

### [2026-09-29] The near-miss row moves from #55 to #47

**Decided:** by the user. #47, which builds the near-duplicate guard, also stores the near-miss log
(designed in `04` first) and owns the digest's near-miss row. #55 builds `digest` without it;
whichever of the two merges second wires the row.
**Reason:** "log every near-miss" was a log line, and the digest reads the database. The guard and
its log belong to the ticket that builds them.

### [2026-09-29] A red or stale check puts one line on Home

**Decided:** by the user, answering the question the 2026-09-28 status-page entry left open on #55.
Home shows one line when any check is red or `self-check` is over 48 hours stale, and nothing
otherwise (`10` §1). #55 builds it.
**Alternatives considered:** the status page alone, with its staleness line as the minimum.
**Reason:** `12` §6 already warns that an alert nobody opens is not monitoring, and Home is where the
user already looks.

### [2026-09-29] Backups are kept forever, without the auth tables

**Decided:** by the user. `backups/` gets no lifecycle rule, like `prod/`. The dump leaves out
`sessions`, `accounts` and `verifications`.
**Alternatives considered:** expiring after N days; daily copies for N days plus a monthly copy kept
forever.
**Reason:** nothing in this project is deleted, and a daily dump at this size costs next to nothing.
The three tables hold session and Google OAuth tokens, which a file kept forever should not carry
and a restore does not need: signing in again rebuilds them.

### [2026-09-29] Sentry sends errors only: no performance tracing, no Session Replay

**Decided:** by the user, before #54 is built; a line in `12` §7 and in #54.
**Reason:** Replay records the DOM, and the DOM shows CV and transcript text, which `12` §7 never lets
reach Sentry. Tracing is not needed for the one thing Sentry is here for, and its events carry request
detail outside `beforeSend`. The SDK's setup wizard can turn both on by default, so the ticket says so.

### [2026-09-29] The production-only proofs move to #21

**Decided:** by the user. #55's "first scheduled `self-check` appears on the status page" and #56's
restore drill are criteria of #21, not of #55 and #56.
**Reason:** both can only be met after the first production deploy, which is #21, and #21 is blocked
by #55 and #56. As written, neither ticket could close before release. #54 has no such criterion: it
is proven on `develop`.
**Consequence:** the native `blocked_by` edges now match the bodies: #21 is blocked by #54, #55 and
#56, and #56 by #55.

---
## Phase 6 — the infrastructure audit's fixes

A read-only audit on 2026-09-28 found production's missing pieces unowned: no ticket for Sentry, the
cron routes or the daily backup, and one variable in a scope `12` forbids. The user approved the
small fixes and made the one choice the audit could not.

### [2026-09-28] Alerts go to a private status page, not email

**Decided:** by the user. `self-check` and `digest` append each run to the database, and a signed-in
page shows every `12` §6 signal's latest reading and when each job last ran. No email vendor, no
`ALERT_EMAIL`, no `RESEND_API_KEY`. The page leads with staleness: a `self-check` older than 48 hours
is the first thing it says. Built by #55.
**Alternatives considered:** a transactional email vendor, which `12` §6 had left as the placeholder.
**Reason:** `08` §2 rejected magic links to avoid exactly that vendor, and both things §6 watches for
(scores not landing, cost drifting) are slow failures that a day-late read loses nothing to. The
staleness line covers the one failure a page hides and a mail would not: the cron itself dying.
**Cost, accepted:** a page is read only when opened. Whether a red check should also appear where the
user already looks is left open on #55.
**Consequence:** `12` §2 drops the two mail variables; §6's table routes to the status page; §7 and
`AGENTS.md` name the page where they named the cron emails. The page is the user's own, behind the
same session: not an admin route (`07` §6) and not a sharing surface (invariant 6).

### [2026-09-28] Sentry runs on `develop` too, so its variables are in both scopes

**Decided:** `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` go in Production and the `develop` branch's Preview
scope, one Sentry project with events tagged by environment. #54 builds it.
**Reason:** `12` §1 already said Sentry is on for `develop`, tagged, so §7's scrubbing is exercised
before production has anything worth leaking. §2 said "production only". The two contradicted each
other, and §1 carries the reason, so §2 changed. A DSN only sends events in; neither variable reaches
Neon `main` or `prod/`, so §2's last rule holds.

### [2026-09-28] The daily dump writes with its own IAM user

**Decided:** a third IAM user, `suburi-backup-writer`, with exactly `s3:PutObject` on `backups/*`, its
key in Production only. `suburi-s3-prod` and `suburi-s3-dev` stay as they are. #56 builds it.
**Alternatives considered:** widening `suburi-s3-prod` to `backups/*`.
**Reason:** the app's credential would then reach every night's full copy of the database, CV and
transcripts included, from every request path that presigns audio. A write-only user that nothing
but the cron route holds cannot read a backup back, and the app's own users still cannot reach it.

### [2026-09-28] The stray general-Preview `OPENAI_API_KEY` is removed

**Done:** the Vercel project held two `OPENAI_API_KEY` rows in Preview, one scoped to `develop` and
one with no branch. The branchless one was deleted by id through Vercel's API, leaving the `develop`
row. `12` §3 step 7 says general Preview holds nothing: a preview deployed any other way would have
received a live key with the rest of its configuration missing. `develop` was then redeployed and
served `/api/auth/ok`, the session and `/cv` with its seeded CV.

### [2026-09-28] Locating a quote is linear in the document

**Fixed:** `locate` in `lib/cv/spans.ts` counted each occurrence's code-point offset from the start of
the document. A quote that occurs at nearly every index, as in the cap-sized integration fixtures of
one repeated letter, made that quadratic: the English cap test took 28 s of a 30 s timeout and failed
once in CI at 32 s. The offset is now carried from one occurrence to the next. The test takes about
25 ms, and the two raised timeouts are gone, so the default 5 s catches a regression.
**Alternatives considered:** raising the timeout to 60 s, which the audit suggested. It would have
hidden a real cost on the save path for any document with a highly repeated phrase.

---
## Phase 6 — #41, the S3 and OpenAI checks

The round loop's first slice. The user chose the local storage and then handed the console steps to
the agent ("AWS CLI is already setup. you can do this all for me"), so the bucket, its CORS rule, the
IAM users and the Vercel variables were done from the already-configured AWS and Vercel CLIs.
The `develop` OpenAI key check is recorded under 2026-09-30 below.

### [2026-09-28] Local development uses the real bucket under `dev/`, not MinIO

**Decided:** by the user. Local writes to the real bucket under `dev/`, with `develop`'s IAM user, and
`http://localhost:3000` is in the bucket's CORS rule. `docker-compose.yml` gains no MinIO service, and
`lib/config.ts` gains no endpoint variable.
**Alternatives considered:** MinIO in `docker-compose.yml`, which `03` §12 and `12` §1 had left open.
**Reason:** the direct browser→S3 upload is where the round loop can fail silently, and MinIO is
close to S3 but not identical, in CORS and presigning above all. Running local against the real
thing removes that gap. `dev/` expires after 30 days, and `develop`'s user cannot reach `prod/`, so
local work never touches real audio.
**Consequence:** a local `.env.local` holds a real AWS credential, scoped to `dev/`. `03` §12 and `12`
§1 now name the choice, and `12` §3 step 4 lists `localhost`.

### [2026-09-28] The bucket is in `ap-northeast-1`, and refuses anything but TLS

**Decided:** one bucket in `ap-northeast-1`. It has Block Public Access with all four settings on,
SSE-S3 with a bucket key, versioning, Object Ownership set to bucket-owner-enforced (no ACLs), and a
bucket policy that denies any request not made over TLS. One lifecycle rule applies to `dev/`: it
expires current objects after 30 days, noncurrent versions after one day, and incomplete multipart
uploads after one day. There is none on `prod/`. The IAM users are `suburi-s3-prod` and `suburi-s3-dev`,
each with a single inline policy allowing `s3:PutObject` and `s3:GetObject` on its own prefix, and
nothing else. The bucket name and the account id are not in the repository; the name is in the
`S3_BUCKET` variable of each scope.
**Alternatives considered:** `ap-southeast-1`, beside Neon; `us-east-1`, beside Vercel's default
function region (`iad1`, which the project uses).
**Reason:** `12` named no region. The upload happens while the user is waiting, from a browser in
Japan, and a four-minute take is the largest thing the app moves, so the bucket sits nearest the
user. The server's read of the object for transcription crosses the Pacific whichever way this goes,
since OpenAI is not in Tokyo either. The noncurrent-version expiry is there because a versioned
bucket would otherwise keep every expired `dev/` object as an invisible noncurrent version forever.
The TLS policy costs nothing, because presigned URLs are already HTTPS.
**Verified with the IAM policy simulator:** each user is allowed Put and Get on its own prefix only.
Delete on either prefix, the other prefix and `ListBucket` are all implicitly denied.

### [2026-09-28] Verified: a presigned PUT from the `develop` origin lands under `dev/`, and a presigned GET reads it back

**Checked:** with the dev user's credentials from `.env.local` (the same values piped into the
`develop` branch's Preview scope), presigned a PUT (`content-type: audio/webm`) and a GET for a key
under `dev/roundtrip-check/`. A headless Chromium page **on `https://suburi-develop.vercel.app`**
then ran both with `fetch`. That page was served by route interception, because Deployment Protection
redirects a logged-out browser to `vercel.com`, but the origin the browser sent and S3's CORS judged
was `develop`'s. The body was the Chrome `MediaRecorder` file from the check below.
**Result:** the PUT and the GET both returned `200` across origins, the GET came back as `audio/webm`,
and the 112,313 bytes it returned were identical to the upload. The stored object was SSE-S3 and
carried a version id. A preflight from an unlisted origin got `403`, and so did one asking for
any header other than `content-type`. With the same credential, a PUT and a GET on `prod/`, a
`ListBucket` and a delete of the object just written all failed with `AccessDenied`, and the object
was still there afterwards. It is left to the `dev/` lifecycle rule.
**Not checked:** a deployed `develop` build presigning the URL itself. No presign route exists yet;
that is the tracer slice's.

### [2026-09-28] The AWS variables are validated at boot, and `S3_PREFIX` is exactly `prod/` or `dev/`

**Decided:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET` and `S3_PREFIX`
join `lib/config.ts` as required, with no default, and `.env.example` names them. `AWS_REGION` must
look like a region (`ap-northeast-1`), `S3_BUCKET` must follow S3's bucket naming rules, and
`S3_PREFIX` is an enum of `prod/` and `dev/`. The two keys are only checked as present. CI and
`playwright.config.ts` set placeholders, never a real credential, as they do for `OPENAI_API_KEY`.
**Alternatives considered:** a free-form prefix; checking that the access key starts with `AKIA`; reading the
variables lazily at the first presign.
**Reason:** the prefix is the only thing separating `develop`'s audio from real audio (`12` §2), so a
typo (`dev`, `/dev/`, `staging/`) must fail the boot rather than write beside the real takes. The key
shapes are only checked as present: the shape is AWS's to change, and a wrong key fails loudly at
the first presigned request anyway. Lazy reading would let a deploy without the variables boot and fail at the first take,
mid-round, which `12` §2's "fails the boot, loudly" exists to prevent.
**Consequence:** the deploy that first carries this must not land on `develop` before the five
variables are in the `develop` branch's Preview scope (`12` §3 step 7), and a local `.env.local`
needs them before `next dev`, `dev:session` or the seed scripts run.

### [2026-09-28] Verified: `gpt-transcribe` accepts Chrome's `MediaRecorder` output

**Checked:** headless Chromium 153 (Playwright's), `MediaRecorder` with
`mimeType: "audio/webm;codecs=opus"` (`isTypeSupported` true, `recorder.mimeType` echoed it), fed a
seven-second macOS `say` sentence through the fake capture device, once in Japanese and once in
English. `ffprobe`: Matroska/WebM, one Opus stream, 48 kHz mono, **no duration in the header** — the
usual shape of a `MediaRecorder` file. Each file was posted to `/v1/audio/transcriptions` with
`model=gpt-transcribe`, `language` set, and content type `audio/webm`, using the **local**
`OPENAI_API_KEY`.
**Result:** `200` both times, each transcript word-for-word the spoken sentence (the Japanese one
without the source's comma), `usage` billed as 7 seconds. OpenAI's reference lists `webm` among the
accepted formats; this confirms it for the file Chrome actually writes, missing duration included.
**Also shows:** the local key's account is served `gpt-transcribe`, so it is at Tier 1 or above
(`03` §4). The separate `develop` key check is recorded under 2026-09-30 below.

### [2026-09-30] The `develop` API key's OpenAI account is Tier 1

**Checked:** the OpenAI account behind suburi's `develop` API key (test site) was verified as Usage tier 1.
**Result:** `gpt-transcribe` requires Tier 1 or above (`03` §4), so this satisfies the transcription requirement.

---
## Phase 6 — the round loop's open answers

Answered by the user on 2026-09-28, on the planning page, for the six items the 2026-09-27 plan left
open. Written into `03`, `04`, `07`, `10`, `11` and `CONTEXT.md` before any round code; the slice
issues #41–#51 were amended to match and move to `ready-for-agent` once this lands.

### [2026-09-28] A database failure mid-write is `write_failed`, on every round route

**Decided:** a new catalogued code, `write_failed`, status `500`, in the `07` §2 envelope with `ja`
and `en` copy, returned by every round route when a database write fails. The write is one
transaction, so nothing is half-written, and **the round stays resumable** from where it was.
`detail` carries only ids and `pg_<SQLSTATE>`.
**Alternatives considered:** Next's bare `500`, as #14 left the CV route; a code per route.
**Reason:** a bare `500` has no Japanese sentence, which `03` §8's generic-error rule forbids, and a
round is the one place a user is mid-performance when it happens. One code, decided once, is what
confirm 6 (2026-09-27) asked for. Closes `CONTEXT.md`'s item and `07` §7's.

### [2026-09-28] When text-to-speech fails, the round goes on as text

**Decided:** in realistic mode, a failed synthesis does not stop the round. The question, already on
screen as text, is answered as usual; screen 3 shows a short notice; the speech route returns a new
catalogued code, `speech_failed` (`502`), and the failure is logged with the round id, position and
error class.
**Alternatives considered:** stopping the round until the voice returns; silently showing the text.
**Reason:** the spoken question adds pressure, but losing the round to it would cost more than the
pressure is worth, and silence would make the user wonder whether it was meant. A code of its own
keeps the copy in the catalogue, with both languages. Closes `07` §5.15's open line.

### [2026-09-28] Round feedback is written without a score that ended `failed`

**Decided:** `complete` does not wait for, or hold back on, an answer whose scoring spent its three
retries. The round feedback is generated without that answer, which is marked **unscored** on the
feedback screen; History offers a retry **for that answer alone**, and it never regenerates the round
feedback.
**Alternatives considered:** holding the feedback until the answer is retried to `ok`; regenerating
the feedback when it is.
**Reason:** invariant 2 — the feedback must render while the user is at the machine, and a held
round breaks it. Feedback is permanent, so regenerating it would rewrite what the user already read.
Closes `07` §5.12's open paragraph.

### [2026-09-28] "Today" is the user's local day, Asia/Tokyo

**Decided:** the day a round's resumability and abandonment are judged by is the calendar day in
Asia/Tokyo, computed from `rounds.started_at`.
**Alternatives considered:** UTC; the browser's time zone.
**Reason:** the user lives in Japan, and a UTC day would end at 09:00 JST — mid-morning, mid-practice.
The browser's zone would let a clock setting move a round's status. Fills what the 2026-09-27 entry
left as "today".

### [2026-09-28] Confirmed: an open round from an earlier day with no newer round is abandoned

**Decided:** as written on 2026-09-27 — the derivation in `04` `rounds` stands unchanged, now with the
Asia/Tokyo day above.
**Alternatives considered:** leaving such a round resumable indefinitely.
**Reason:** a round's pressure is a sitting's; resuming yesterday's answers is practice, not a round.

### [2026-09-28] Confirmed: the CV screen keeps its per-panel language

**Decided:** the CV screen stays outside `10` §0's rule that app-level screens are English; each panel
follows the language of the CV it shows (`10` §13).
**Alternatives considered:** English chrome on the CV screen like the other app-level screens.
**Reason:** the CV's text is the content, in its own language, and #38's read of the panel strings
already fits it.

---
## Phase 6 — the round loop, decided before it was built

Settled 2026-09-27 in the round-loop grilling: fifteen questions and eight forced confirms, raised by
a read of `02`, `03`, `04`, `07`, `10`, `11` and `12` that found where they disagree or say nothing.
The user took the recommended option on every item, with one override (Q1's app language). Written
into the docs before any round code, the way #12 wrote #11's decisions; the build is drafted as eleven
slice issues, **not yet `ready-for-agent`**. Every entry below contradicts or fills something an
earlier phase wrote; each says what.

### [2026-09-27] Round screens follow the round's language; every other screen is in English

**Decided:** the screens inside a round — record in all its states, transcript correction, felt
pressure, round feedback and practice mode's per-answer frame — are written entirely in the round's
language, labels, buttons, captions and error copy alike. Home, Setup, Progress and History are in
**one fixed app language, English.** The CV screen keeps its own per-panel rule (`10` §13).
**Alternatives considered:** everything in one app language; the round rule plus Latin mono uppercase
section labels kept as a design device in both languages; both languages side by side, as on
`/sign-in`. For the app language, Japanese — the planning report's lean.
**Reason:** English chrome on a Japanese round breaks the immersion the round exists for, and the
feedback language already follows the round (`06`, 2026-09-12, "Feedback for a Japanese round is written
in Japanese"). Progress and History show both languages at once, and Setup is where the language is
chosen, so none of them has a round language to follow. **English is the user's call** (2026-09-27),
over the report's lean. Consequence: the artboards' Japanese chrome on Home, Setup, Progress and
History is layout, not copy — those strings are rewritten in English by the slice that builds each
screen — and the Latin labels on the round screens (`YOUR ANSWER — EDIT FREELY`, `BEFORE THE
FEEDBACK`) become Japanese in a Japanese round, with a native read. Closes `CONTEXT.md`'s "bilingual
chrome rule" and `05` §9's entry.

### [2026-09-27] A round's questions are fixed when it starts; a slot opens only once a take exists

**Decided:** `POST /api/rounds` chooses every bank question the round will ask — selecting, and
generating where the pool runs short — and writes them to a new `round_questions` table, one row per
position, in the transaction that creates the round. A follow-up is written to a new `follow_ups` row
when it is generated (next entry). **The answer slot is opened only after a take exists**: record,
then `POST …/answers` with the take's real size, then the presigned PUT. `is_first_attempt` is still
computed at slot-open.
**Alternatives considered:** an `answers` row in an `asked` state, created when the prompt is shown and
presigned later; keeping the docs as written and accepting that a refresh may re-select.
**Reason:** nothing stored a selected-but-unanswered question, so a reload could swap a question the
user had already heard, or regenerate a different follow-up — both bad for an instrument. Opening the
slot after the take answers two contradictions at once: `07` §5.6 sent `expected_bytes` (known only
after recording) yet checked `upload_too_large` "before recording", and PRD §7 says a failed recording
leaves the question unseen while a slot opened before recording had already claimed the first
attempt. Generating at round start, beside the preflight, also takes question generation off the
between-answers path. **A question answered in an abandoned round keeps its row and is seen for
good** — honest, since the user did see it. Supersedes `07` §5.6's "presign before recording" and the
2026-09-12 entry's framing of the four calls.

### [2026-09-27] A follow-up is a `follow_ups` row, generated or missing

**Decided:** a new `follow_ups` table: one row per parent answer (`parent_answer_id` unique), `status`
`generated` | `missing`, `prompt_text` (null when missing), `model_id`, `prompt_version`, tokens,
`error_class`. The follow-up's own answer row still points at its parent through
`answers.parent_answer_id`, and copies `prompt_text` from the follow-up row.
**Alternatives considered:** a `follow_up_status` column on the parent answer, plus stamp columns.
**Reason:** `03` §4 says every AI-touched row is stamped, and follow-up generation had no stamp columns
anywhere. A missing follow-up must render as a hole in History (`10` §10) and no column could hold one:
`answers.prompt_text` is not null, and `next` simply degraded. The row also gives resume its stored
follow-up text, which the previous entry needs.

### [2026-09-27] Any earlier answer in the language, in either mode, rules out a first attempt

**Decided:** an answer is a first attempt iff the round is realistic, the prompt is a bank question,
and **no earlier answer to that question id in that language exists in any mode**. Practice mode
prefers questions already answered, but may still be given unseen ones.
**Alternatives considered:** practice drawing only from questions already answered realistically, so the
unseen pool is never spent in practice; the rule as written, which looked only at earlier realistic
answers.
**Reason:** as written, a question practised and later met in a realistic round was a first attempt —
`11` §1's first silent failure exactly, a practised answer charted as a cold one — and US-13 asks for
first attempts at questions the user had **not seen**. The preference keeps practice from spending the
unseen pool without making practice rounds impossible when the seen pool is thin. Amends `CONTEXT.md`,
PRD §2, `04` `answers` and `11` §3.4, as the invariants rule requires.

### [2026-09-27] Stamp 3 is never null: set pieces carry a content version, follow-ups their prompt version

**Decided:** `scoring_attempts.generator_prompt_version` becomes `not null`. For a generated question it
is the generator prompt version; for a set piece, the set pieces' **content version** (for example
`set-piece-ja-1.0`), stored in `questions.generator_prompt_version`; for a follow-up, the follow-up
prompt version from `follow_ups.prompt_version`. `scoring_prompt_version` stays beside `model_id` as
part of stamp 4, "scoring model/prompt" (PRD §9).
**Alternatives considered:** leaving it nullable and fixing the docs to say "not null except set
pieces".
**Reason:** the four stamps disagreed across the docs — `04` made stamp 3 nullable while `04` §6.5
said all four are `not null`, `11` §3.1's stamp test named `scoring_prompt_version` instead, and `11`
§3.6's boundary list left the generator out. A null is a boundary Progress cannot draw, and a
hand-authored set piece can change too. The table is empty in every environment, so tightening the
column is a safe migration now and a backfill later.

### [2026-09-27] Unsupported claims are `answer_flags` spans into the corrected text; untouched material is 2–3 claims the model picks

**Decided:** a new `answer_flags` table — `answer_id`, `scoring_attempt_id`, `kind = 'unsupported'`,
and `span_start`/`span_end` into `answers.transcript_corrected` — validated exactly as CV spans are:
the quote is sliced from the stored text by span, and a span that fails is dropped and counted, never
clamped. `claim_citations.relation = 'contradicted_by'` now means only a real contradiction with a
cited CV claim. For **untouched material**, the round-feedback call picks two or three **relevant**
claims from the computed never-cited set; their ids are validated against that set and stored on
`round_feedback`.
**Alternatives considered:** flags as a jsonb column on `scoring_attempts`; showing every uncited claim.
**Reason:** an unsupported claim is a span of the *answer* with nothing behind it in the CV, and
`claim_citations` requires a `cv_claim_id`, so "no claim supports this" could not be stored. `04` had
also defined `contradicted_by` as that absence, which is a different thing from being contradicted by a
claim. The answer-side quote needs the same anti-hallucination rule as a CV quote (`03` §11). A CV
carries about 80 claims and a round cites a handful, so listing every uncited one would bury `10` §8's
two-item callout under seventy.

### [2026-09-27] `complete` writes the rating first, waits for the last scores, then generates feedback outside the transaction

**Decided:** `POST /api/rounds/{id}/complete` becomes ⚡ with its own bucket. It writes `felt_pressure`
and `completed_at` in one transaction and commits. It then waits, bounded inside the 300 s, for the
round's pending scores; generates round feedback **outside any transaction**; and writes
`round_feedback`. If feedback cannot be generated, the round stays complete with its rating, the
feedback screen shows every score that landed and a pending round-level note, and generation is
retryable. A new code, `feedback_generation_failed`, with copy in both languages.
**Alternatives considered:** returning at once and generating feedback in `after()`, the feedback
screen reading round-level items once they land; generating feedback from whatever scores exist.
**Reason:** invariant 2. `round_feedback` is one row per round and never rewritten, so feedback
generated without the last answer is permanent. `07` §5.12 generated feedback "in the same
transaction" as the rating, which contradicted the rule that model calls run before or after a
transaction, never inside it (`06`, 2026-09-21), and `complete` called a model without being ⚡. The
rating is still written structurally first. **The bound is not chosen here:** it comes from the round
loop's latency measurement (below).

### [2026-09-27] Questions: one round type per set piece, 逆質問 dropped, one unseen set piece then generated, no difficulty tier

**Decided:** every set piece belongs to exactly one round type — 自己紹介, 自己PR and 転職理由 to `hr`;
志望動機 to `ceo`; and their English counterparts the same. **逆質問 is dropped from the scored bank.**
A round asks **at most one unseen set piece** of its type, then generated bank questions, **unseen
first**; when the unseen pool cannot fill the round, new questions are generated and PRD §6's
bank-exhausted warning applies. **The declared difficulty tier is struck** from US-4 and from the
2026-09-12 entry; nothing replaces it. **The near-duplicate threshold starts at cosine similarity 0.90
= the same question — an unverified guess**, logged and tuned exactly as `03` §11 already says.
**Alternatives considered:** set pieces opening every round, one row per round type; generated questions
only; a `difficulty_tier` column.
**Reason:** first-attempt accounting is keyed by question id, so 自己紹介 as four rows in four round
types would be four ids and four first attempts for one question. 逆質問 is the candidate asking, which
does not fit answer-then-score. The tier had no column in `04` and no reader anywhere; drift in what
the generator produces is already covered by the generator stamp. 0.90 is where the report proposed to
start strict; no measurement stands behind it.

### [2026-09-27] Round one needs a posting and General practice; research lands with US-16

**Decided:** round one supports two kinds of role context: a **posting**, pasted or imported through
the existing `lib/cv/import/`, and **General practice**. **Research** ships later with US-16, still
under "the file wins". Role contexts are **immutable, reusable rows** picked across rounds; General
practice is **one row per user**. The posting's size cap is measured the way the CV's was.
**Alternatives considered:** all three kinds in round one.
**Reason:** US-2 is a round-one gate and listed research among its kinds, while US-16 is explicitly
not a gate, and US-2 cited a "US-17" that does not exist. Reusable rows let a posting be picked for
many rounds without re-pasting, and immutability keeps "what was this round pitched at?" answerable
after the fact, the way a CV version does.

### [2026-09-27] Realistic mode speaks through a new ⚡ route streaming an OpenAI TTS model

**Decided:** a new ⚡ route streams synthesised audio for a prompt of the round, identified by
position; the server reads the text from `round_questions` or `follow_ups`, never from the request.
The model string is a constant in `lib/ai/models.ts`, **pinned only after it is verified** at
implementation — the report found `tts-1` and `tts-1-hd` in OpenAI's docs and could not rule out a
newer model.
**Alternatives considered:** the browser's `speechSynthesis` — free and instant, but its voice depends
on the OS, it cannot be stamped, and its pronunciation of 役職 is unverified.
**Reason:** `03` §4 said synthesis happens at ask time and named a TTS model constant, but `07` had no
endpoint for it and no model was named. Question audio is well under the 4.5 MB body cap, so it can
cross a function. Taking the text from stored rows is what stops the route becoming a general TTS
proxy on the user's key.

### [2026-09-27] Practice mode: a per-answer frame once scored, two kinds of retry, round feedback at the end

**Decided:** practice keeps realistic's flow. After each submit, a per-answer frame shows that answer's
score rows and flags once it is scored, reading `GET /api/rounds/{id}` extended with scores **for
practice rounds only**; the follow-up is ready beside it. **Two retries:** a **re-take** before
transcription, which re-records into the same answer row and overwrites the S3 object (bucket
versioning keeps the old object version, and that is accepted); and **answer again** after the
feedback, which is a new answer row with `retry_of_answer_id` and **no new follow-up**. Round-level
feedback comes at the end, as in realistic mode, without the pressure rating. The screens are
specified in `10` from `05` components before they are built, the way the CV screen was.
**Alternatives considered:** practice deferring all feedback to round end, like realistic but untimed.
**Reason:** scoring is asynchronous, so "immediately after each submission" (US-8) means once scored,
tens of seconds later, and nothing read scores back to the client. "Retry" meant two things — US-5's
re-record where "only the kept take is stored", and `04`/`07`'s new row scored again — and both are
real practice moves. Realistic rounds get no scores from the read, which keeps US-8's silence
structural.

### [2026-09-27] Rubric v1.0: Claude drafts it with per-level anchors in both languages; the scorer reads corrected text, duration and pace

**Decided:** `lib/rubric/` starts at **v1.0** for `ja` and `en`, drafted by Claude with an anchor for
every level 1–5 of every dimension, in Japanese and English, then reviewed by the user and given a
native read. The scorer is given the **corrected** text, the answer's duration and its pace — not the
raw text, whose recogniser errors would unfairly cost accuracy. Fluency's definition reads fillers and
restarts, which screen 5's caption asks the user to keep when correcting.
**Alternatives considered:** definitions without level anchors.
**Reason:** the rubric is the instrument, and no rubric existed: `12` §3 step 9 seeded "rubric v1.2",
a label that came from the artboards' sample data. Anchors are what make a 3 in March mean a 3 in
September to the scorer. Fluency read from corrected text could be laundered by the correction step;
defining it on what the correction step keeps closes that. `12` §3 step 9 now seeds v1.0. The
artboards' `評価基準 v1.2` stays as sample data.

### [2026-09-27] An abandoned round is derived: a newer round abandons it, and only today's newest open round resumes

**Decided:** starting a new round makes any open round abandoned. **Resume is offered only for the
newest open round, and only within the same day.** Abandonment stays derived from `completed_at is
null` and those two facts; there is still no abandon endpoint and no column.
**Alternatives considered:** abandonment by elapsed time (for example, open for more than 24 hours);
refusing to start a new round while one is open.
**Reason:** an abandoned round and one in progress both had `completed_at is null`, while History shows
`中断`, and Home and Setup needed a rule. Deriving it keeps `07` §6's refusal of an abandon endpoint
intact, and never blocks a round, which US-14 already requires of the Due list.

### [2026-09-27] A wrong-language answer is detected by the scorer, which returns `answered_language`

**Decided:** the scorer returns the language the answer was given in; it is stored on the scoring
attempt as `answered_language`. An answer whose `answered_language` is not the round's language is
flagged in feedback and **excluded from that language's Progress**.
**Alternatives considered:** the transcriber's language detection; deferring past round one.
**Reason:** PRD §7 requires the exclusion and no column recorded it. The scorer already reads the whole
answer, and a code-switched Japanese answer full of English domain terms is exactly the case a
transcription language tag would misread.

### [2026-09-27] The round loop's model latencies are measured in the first slice, before the rest is built

**Decided:** the tracer slice measures every model call the round depends on — scoring, follow-up
generation, round feedback, question generation, transcription and TTS — against synthetic answers,
the way #20 measured CV extraction, and records the numbers in `03` §4.
**Alternatives considered:** build first, measure after.
**Reason:** none of these latencies is known. The follow-up wait sits inside a timed round; scoring has
to land by screen 7; and the numbers decide `complete`'s wait bound and whether generating every
question at round start is tolerable.

### [2026-09-27] Eight forced confirms, taken as the planning report wrote them

**Decided:**
1. **`POST /api/rounds` takes no `cv_version_id`.** The current CV version in the round's language is
   resolved server-side (`07` §6 forbade a round choosing one).
2. **A practice round stores `per_answer_cap_seconds = 900`**, the real runaway guard; the column is
   `not null` in `04` and the schema, and `07` §5.4's `null` was wrong. Setup shows no duration
   estimate for practice.
3. **A follow-up shares its parent's `position`**, as a retry does, matching `第1問` and "of 5". `07`
   §5.9 and `04` §4's example gave it the next one.
4. **Pace is characters per minute of `transcript_raw` for `ja`** and words per minute for `en`, in
   the existing `words_per_minute` column. `10` already shows `字/分`; `11` §3.9's expected values
   follow.
5. **`12` §6's spend cap fails as `429 project_spend_limit_exceeded` upstream**, not `503`. The round
   loop maps it: preflight reports `503 model_unavailable`, and it is never retried as a rate limit.
6. **A database failure mid-write is decided once, for every round route** — not route by route. Which
   way it goes (a new code with copy, or Next's bare `500`) is still open.
7. **The most answers a round holds is 14** (7 + 7), not "sixteen". Wording only.
8. **The embedding model is `text-embedding-3-small`**, pinned in `lib/ai/models.ts`; `vector(1536)` is
   its default dimension (OpenAI docs, per the planning report's check, 2026-09-27).
**Reason:** each was a contradiction between two docs with one defensible answer; the user confirmed
all eight without debate. Confirm 6 settled the scope of the decision, not its outcome.

### [2026-09-27] One IAM user per environment, each on its own prefix

**Decided:** `12` §3 step 5 creates two IAM users, not one: production's may put and get under `prod/`
only, `develop`'s under `dev/` only. Found while drafting the round loop's first slice, which moves
steps 3–5 ahead of #21.
**Alternatives considered:** one user on both prefixes, as step 5 was written.
**Reason:** `12` §2's last rule says nothing deployed from `develop` may hold a credential that reaches
`prod/`, and one user on both prefixes is exactly such a credential. The rule was already decided;
step 5 contradicted it.

---
## Phase 6 — #38, the CV feature's Japanese strings

### [2026-09-27] The CV batch's native read is done as an AI review, and recorded as one

**Decided:** `docs/checklists/native-read-cv.md` is discharged by an **AI review**, not a native read.
The user does not read Japanese and asked Claude to do the check itself ("i cant read japanese you
do the check"). This exception applies only to the CV batch in #38; future Japanese strings still
require the native read in `05` §6 and `11` §5 unless the user decides otherwise. Claude read every
row for whether a person would write it, against its English intent and the rules in force. All 22
panel strings and `cv_too_large` are accepted as written — the six
2026-09-24 draft amendments included, so none is overturned and their two rules and tests stay.
`cv_too_large` stays a flat string with no figure. §3's label and legend are accepted as `応募書類`
swaps; the round-level line becomes `数値の裏づけがない箇所が2つ。応募書類の「請求処理を40%短縮」を使う。`,
because the original switched from polite to plain inside one item of a plain-form list. That became
`05` §6's register rule. The artboards were edited and re-seeded to match.

**Why:** the rule in `11` §5 exists to catch copy no Japanese writer would produce, and the person it
assumed would do the reading cannot. Leaving the batch open would block nothing it guards and leave
the strings unread by anyone. A careful read against the intents is the best check available.

**Recorded honestly:** the checklist header, `05` §6, `10` §13, `11` §5, `00-status` and `CONTEXT.md`
all call it an AI review. Nothing says a native speaker read these strings, because none did. The
same agent family wrote most of them, which is the weakness of this check; a native read later
that overturns a row wins, and the row changes with its test.

**Rejected: calling it a native read** — the 2026-09-24 entry's argument stands unchanged. **Rejected:
leaving it owed indefinitely** — the user has said there is no reader to wait for.

---
## Phase 6 — #20, the real-CV re-measure, windowed

### [2026-09-27] The windowed caps hold; #20's real-CV check is done

**Decided:** the real 履歴書 + 職務経歴書 (9,077 code points) and the real English CV (14,607 code
points) were re-read through `/cv`, windowed, locally against Docker Postgres — `cv-extract-ja-1.2`
and `cv-extract-en-1.3`, 3 and 4 windows, 81 and 82 claims, 43.2 s and 45.5 s, `spans_rejected`
`quotes_outside_window` and `window_retries` all 0 on both (`03` §4, `lib/cv/limits.ts`). Both
are faster than the same CVs read in one call on 2026-09-23 (59.5 s and 48.0 s), because wall time
follows the largest window rather than the whole set. **`lib/cv/limits.ts`'s caps stay ja 30,000 / en 45,000** — nothing
measured, including the same day's edited-version runs, approaches the OpenAI client's 240 s timeout
or the route's 300 s ceiling. The user read both extractions on-screen and judged them good: a
five-quote sample per CV matched the source verbatim. Unclaimed text was by design — skills
inventories, the 職務経歴書's `■保有資格` list already claimed from the 履歴書's `免許・資格`, and
`本人希望記入欄` — with one minor miss, the 経歴要約's opening sentence carrying no claim of its own
though its facts are claimed elsewhere.

**Rejected:** raising or lowering a cap on this reading. Raising one is a measurement on a set that
size (`lib/cv/limits.ts`), and nothing here shows the current caps unsafe; lowering one has no
motivating defect either.

**Closes #20.** The native read of `docs/checklists/native-read-cv.md` is separate and stays owed —
it is the user's own read, not part of this measurement.

### [2026-09-27] #29 is answered: chunking is adopted, now measured on real data

**Decided:** #29 asked whether CV extraction should chunk the document instead of one call. It
shipped windowed (N parallel calls, each sent the whole set, each returning one window's claims) and
was measured on synthetic sets the same day (`06`, 2026-09-27, below) and now on the real CVs (this
entry). The real-set numbers confirm the synthetic finding: windowing fixes the late-block lumping a
single long call produced, with no wall-time cost on the real CVs — 43.2 s and 45.5 s against 59.5 s and 48.0 s
for one call — because it tracks the largest window, not the sum.

**Closes #29.**

---
## Phase 6 — #29, windowed CV extraction

### [2026-09-27] The 4,000-code-point window size is a target

**Clarification:** the window planner preserves a whole line even when it exceeds 4,000 code points,
and joins a final window shorter than a quarter of the target to its predecessor. Either can make a
window longer than 4,000. The earlier entry's "at most" describes the packing step, not the final
window size (`03` §4, `lib/cv/windows.ts`).

### [2026-09-27] CV extraction is N parallel windowed calls, and every call reads the whole set

**Decided:** a save's extraction is no longer one model call. The set is cut into **windows**
(`lib/cv/windows.ts`), each a passage of one document, and each window gets one call. **Every call is
sent the whole set, exactly as the one call was**, and returns the claims of its own window only. The
calls run in parallel (`lib/cv/windowed-extraction.ts`) and all of them finish before the save's
transaction opens, so the save is still all-or-nothing and a failure is still `502
cv_extraction_failed`. This supersedes #11's "One model call extracts atomic claims" and the
2026-09-21 entry's "one model call"; `03` §4 and `07` §5.2 now say "one synchronous extraction (N
parallel windowed calls), one transaction". Closes
[#29](https://github.com/yutaasakura96/suburi/issues/29).

**Why: #27's failure had a second, quieter form, and no counter can see it.** Measured on synthetic
sets shaped like the real CVs (2026-09-25, `gpt-5.6-sol`; an invented applicant, never the real CV).
The whole-set call under `cv-extract-en-1.2` did read `PROJECTS` — the block `en-1.1` skipped — but
returned it as **seven claims averaging 516 characters**, each a project's title and whole paragraph,
on both runs. The prompt forbids that shape: one of them carried three separate results. The same
characters **moved up** to follow `PROFILE` came back as 26 claims averaging 138, and read as a window
of their own, mostly sentence by sentence. So the cause is how late the material falls in one long
output, not its format. `unclaimed_run_max` read **996 on every English reading, lumped or not**
(the `TECHNICAL SKILLS` inventory, unclaimed by design), `claims_split` read 0, and coverage was
complete. Before #27 the symptom was a skip; after it, a lump. The cause did not move, and each new
symptom would need a new counter.

**Why not one call per document, or per heading-split chunk** (#29's options 2 and 3). It brings back
#27's duplicated qualifications. On the synthetic 応募書類 the 職務経歴書's `■保有資格` repeats the
履歴書's 14 `免許・資格` rows in another date format. The whole-set call returned none of them twice.
One call per document returned **all 14 again** (84 claims against 66), because neither call can see
the other document, so the "one claim for an assertion written twice" rule cannot apply.
`claims_duplicated` stayed 0 (the texts differ by date format), and `unclaimed_run_max` **fell** from
823 to 248, so the counter reported the worse reading as an improvement. Windowed, with the whole
set in every call: 66 claims, none repeated.

**Why not one call, then a re-ask for unclaimed runs.** It would not have fired: every reading,
lumped ones included, was under `12` §6's 2,000 threshold, because lumping leaves coverage complete.
Lowering the threshold would re-ask on by-design gaps (`TECHNICAL SKILLS`, a repeated `保有資格`) and
invite back the duplicates the first call rightly left out, all on a serial second call of 25–50 s.

**What it costs.** Wall time is the largest window's call, not the sum: **46.6 s** (`en`, 4 windows)
and **49.5 s** (`ja`, 2) against 43.9–47.2 s and 43.1 s for one call. Tokens are **2–3×**, about
$0.20–0.30 a save against $0.10, because every call carries the whole set as input. `CLAUDE.md` says
cost is not the constraint at this volume, and a save is made a handful of times ever.

**Why now, before #21.** Production's first `CV v1` is read by whatever extractor ships, and after
that `422 cv_unchanged` stops a better one from re-reading an unchanged set (`CONTEXT.md`, open
questions). No answer has been scored, so changing the extractor now costs nothing downstream.

**Where it lives.** The port (`lib/ai/extract-cv-claims.ts`) stays one interface with one
implementation (`03` §10) and gains a window argument: one call, one window. Planning, the fan-out,
the retry and the out-of-window check are deterministic and live in `lib/cv/`, where the fake drives
them in tests. Keeping the fan-out inside the port was rejected: the out-of-window count has to reach
the save's log line, and the port would have had to return more than claims.

**Not yet measured, and said so.** The harness put the window instruction in the input as a stand-in.
`cv-extract-ja-1.2` and `cv-extract-en-1.3` are that instruction as versioned prompts, and they have
not been run against a model. The real-CV local re-measure after merge is the check, the same one
#20 and #27 ran. `lib/cv/limits.ts`'s caps were derived for one call whose duration grows with the
set; windowed wall time tracks the largest window instead, so the caps are **kept and marked for
re-measurement**, not edited. The rate limits seen were the local key's (500 RPM, 500,000 TPM); the
production key's are #21's to check, since a set at the cap is at least 8 (`ja`) or 12 (`en`)
concurrent calls.

**Rejected:** a partial save that keeps the windows that succeeded (a version with half its claims
makes *"CV material never used"* a lie for its whole life, `03` §4); running the windows serially
(the sum, about 139 s for four windows, against a 300 s ceiling); a heading detector to cut at
(tuned to one CV's headings, and unnecessary, since the `.docx` importer ends every paragraph with a
blank line).

### [2026-09-27] A repeated assertion belongs to the earliest place it is stated

**Decided:** `cv-extract-ja-1.2` and `cv-extract-en-1.3` give an assertion written more than once
one owner: **the lowest-numbered document that states it, and its first occurrence there.** A call
returns it only if that place is inside its window.

**Why:** the old rule was "quote it once, from whichever document states it". With one call that is
one choice. With several calls it is several choices, and two windows could both return the
assertion, or both leave it to the other. The earliest place is a rule every call can apply alone,
because every call sees the whole set. It also matches the backstop: `readClaims` keeps the first of
two equal texts in body order, and the fan-out's results arrive in window order. For the measured
case, the 履歴書 owns the qualifications its 職務経歴書 repeats, which is the reading `ja-1.1`
already produced.

### [2026-09-27] A quote outside its window is dropped and counted, and alerts at any non-zero value

**Decided:** a claim whose quote is in the text but not wholly inside the window its call was given
(another document, another window, or across the window's edge) is dropped, never kept and never
moved, and counted in **`quotes_outside_window`**. It is logged, returned in the 201's `validation`
and alerted on at any non-zero value (`12` §6). The verbatim check runs first, so a quote that is not
in the text at all is still `spans_rejected`, whichever window returned it. An out-of-window quote is
not part of `spans_checked`, so every returned claim is `spans_checked + quotes_outside_window`. The
three reading counters keep their meaning.

**Why dropped rather than kept:** the window that holds that text reads it and returns its own
claims, so keeping a stray one could store the same assertion from two places, the duplication the
ownership rule exists to prevent. **Why strict:** it was 0 across all six windowed calls measured, so
any value is the model ignoring its window, the same shape as `spans_rejected`.

### [2026-09-27] Windows are cut at blank lines near 4,000 code points, and a failed window gets one retry that fits

**Decided:** `planWindows` cuts each document at blank lines and packs paragraphs into windows of at
most **4,000 code points**. A paragraph is never cut: its line breaks may be a PDF's visual wraps,
and a sentence straddling the cut could be quoted whole by neither call. A paragraph longer than the
target is a window of its own, past the target. A last window under a quarter of
the target joins the one before it, and a window never crosses a document. One number serves both
languages. The measured windows that read at sentence level were 1,010–5,907 code points, and the
densest, a whole 3,014-character 職務経歴書, read cleanly. On the synthetic English CV the planner
gives `PROJECTS` a window of its own, the shape that was measured.

A window that fails with a transient error (a timeout, a 5xx, a 408/409/429, an incomplete or
unparseable response) is **retried once**, if at least **60 s** of a **270 s** deadline is left (the
route's 300 s, less 30 s for the session, the reads and the write), with a timeout of whatever is
left. A 4xx the same request would get again is not retried. When a window fails for good, the others
are aborted.

**Why a retry is possible now:** the one call had `maxRetries: 0` because it alone had to fit
the 300 s, at a predicted ~145 s at the cap. A window's call took at most 53 s in the measurement, so
one retry of a window that failed fast fits, and one that timed out at 240 s is refused rather than
outliving the route.

---
## Phase 6 — signed-in screens for an agent, locally

### [2026-09-25] `npm run dev:session` signs a local browser in; the app gains nothing

**Decided:** `scripts/dev-session.mts`, run as `npm run dev:session`, creates or reuses the
`ALLOWED_EMAIL` user row in the **local** database (`seedUser`, as `db:seed` does), mints a session
through `lib/auth/test/session.ts`'s `mintSessionCookie` — the same code `e2e/cv.spec.ts` signs in
with — and hands it to the browser: it prints the cookie's name, value, domain and path and the URL to
open, writes a Playwright storageState to `.playwright/dev-session.json` (gitignored), and prints a
ready-to-paste step for Playwright MCP (`browser_run_code_unsafe` adding the cookie) and for
`chrome-devtools-axi` (setting it with `document.cookie`, which the server reads the same way). It
loads env files the way `next dev` does, and takes the secret and both database URLs from those
local files. If an exported value differs, it refuses before opening the database.

**The guard runs first, before any database is opened,** and refuses with one line per reason unless:
both database URLs point at `localhost` or `127.0.0.1`, the hosts `lib/config.ts` lets through without TLS;
`NODE_ENV` is not `production`; neither `VERCEL` nor a non-development `VERCEL_ENV` is set; and
`BETTER_AUTH_URL` points at `localhost` or `127.0.0.1`. A session is a row, so the database guard
determines where it would work. The storageState directory and file have owner-only permissions,
including on replacement.

**Amended 2026-09-26:** the guard refuses query parameters on either database URL, since connection
parsers can use them to override its hostname. The state path is fixed at `.playwright/dev-session.json`.

**Why:** the Google gate stops an agent checking a signed-in screen in a real browser, and each one
improvised around it. This keeps the line already drawn: there is no sign-in route, flag or code path
in the app — no admin route of any kind (`07` §6), the two locks of `08` §2 are the whole gate and the
session hook still refuses any user but `ALLOWED_EMAIL`, and a switch the deployed app could carry was
already refused once for being "a flag that could put a fake into production" (2026-09-21, the mock
OpenAI entry). Nothing under `app/` or `lib/` imports the script, and no deployed variable is added.
The app's modules import each other without extensions, which Node's type stripping cannot resolve,
so the script loads them through `scripts/resolve-ts.mts`, a resolve hook that retries a relative
specifier with `.ts` — the app's files are unchanged.

**Tested:** `scripts/dev-session-guard.test.ts` covers both database URLs, connection parameters,
the app host, Vercel and production environments, and exported values that differ from the local env
file. Its script-level tests verify refusal before any state file is written;
`e2e/dev-session.spec.ts` runs it twice against the e2e database and opens `/cv` signed in with each
storageState, with one user row after both and owner-only permissions restored on replacement.
**Verified by hand, 2026-09-25,** on `next dev` against a scratch local database: both the
Playwright MCP and the `chrome-devtools-axi` steps land on `/cv` signed in.

**Rejected:** a test-only sign-in route or an env-gated bypass in the app, because the app is publicly
reachable and a route that exists can be reached; turning the gate off locally; and signing in to
`develop` with the real Google account, which an agent cannot do.

---
## Phase 6 — #28, the claim key under `NFKC`

### [2026-09-24] `text_normalised` is `NFKC`, then whitespace-collapsed, and case is kept

**Decided:** `normaliseClaimText` applies `NFKC` before collapsing whitespace. It does **not** fold
case. `createSpanChecker.validate` is untouched and stays byte-exact.

**Why `NFKC`:** it is the match key for carry-forward and for `claims_duplicated`, and a Japanese CV
writes one assertion as `４０％` or `40%`, `ＡＷＳ` or `AWS`, `（AT限定）` or `(AT限定)`, and
`ｼｽﾃﾑ` or `システム` interchangeably. Before this, a claim whose only change between
versions was a full-width digit read as a new claim and **lost its coverage history**. The split is
Track Record's (`CONTEXT.md`): anchoring decides whether a quote is real and is exact; normalisation
decides whether two quotes are the same claim and is forgiving. `NFKC` before the collapse, because
it can itself produce spaces (`¨` becomes a space and a combining mark).

**Why case is kept:** width is how a character was typed; case is part of what was written. `AWS`,
`Go`, `SAP` and `iOS` are names, and folding them risks merging two English claims that are
different, which in carry-forward means **inheriting coverage that was never earned** — worse than
the miss, because nothing would show it. The miss is only a claim starting a fresh chain. The
extractor quotes verbatim, so two readings of one line never differ by case on their own, and
`NFKC` already maps full-width `ＡＷＳ` to `AWS` without touching case.

**Rejected:** copying Track Record's `toLowerCase()`. It hashes English prose for a permanent fact
store; this key compares one version to the next, and `04` rules out fuzzy matching here.

### [2026-09-24] The stored keys are rewritten by a migration, in the same commit

**Decided:** `0004_claim-text-nfkc` rewrites `text_normalised` on every `cv_claims` row to the new
key. `cv_versions.body`, `span_start` and `span_end` are not touched and no row is deleted. The SQL is
`normaliseClaimText` spelled in Postgres — `normalize(…, NFKC)`, JavaScript's `\s` as an explicit
bracket, `btrim` — and an integration test holds the two equal over the forms that differ.

**Why:** `text_normalised` is stored. Changing only the function would compare `NFKC` keys against
old ones and carry forward nothing across a full-width form for one version — worse than the bug. It
is derived data, so the rule against rewriting `cv_versions.body` does not reach it.

**Rejected:** normalising only on write, which makes the first version after the change the broken
one. **Rollback:** the previous build still reads the column; a version it saved would write
whitespace-only keys again, which costs carry-forward across a width change and nothing else.

**Measured, and it is not what #28 expected:** re-counted on the stored real readings (`03` §4),
`NFKC` rewrites 67 keys and merges **none** of the 29 doubled 免許・資格 lines #27 left. They differ
by the 履歴書's date cells, not by width. The fix earns its place on carry-forward, not on dedupe.

---
## Phase 6 — #27, the extractor prompt

### [2026-09-24] Defect 3 is the importer, not the prompt: `.docx` tables are read as tables

**Decided:** `lib/cv/import/extract.ts` goes through `mammoth.convertToHtml` and walks the HTML
(`docxHtmlToText`) instead of calling `extractRawText`. A table row becomes **one line with its cells
joined by a tab**; everything outside a table is byte-for-byte what raw text produced.

**Why:** #27 filed "table rows are captured with their cell breaks inside the span" against the
prompt. It is not a prompt defect. `extractRawText` ends every paragraph with a blank line and knows
nothing of tables, and a table cell **is** a paragraph — so the real 履歴書 reached the database as
**62 lines holding nothing but a year or a month**, out of 249. No prompt wording can produce a claim
that carries its own date out of three separate lines, and the ja prompt's existing rule — quote a
line such as 「2016年4月 株式会社〇〇 入社」 whole — described a line shape that document never had.
Fixing it at the importer makes that rule true again and makes a cell break inside a span impossible
rather than discouraged.

**Alternatives considered:** quoting only the assertion cell, which satisfies the acceptance box
literally but throws the date out of every 学歴・職歴 and 免許・資格 claim; a separate ticket, which
would have shipped a reading to `main` that was still known bad. A tab rather than a space because it
is an unambiguous cell separator that survives `tidyImported` and renders as a space in the DOM, so
the quote reads naturally wherever it is shown.

**Consequence:** a `.docx` with no tables imports byte-identically, which is why re-importing the
English CV was refused `422 cv_unchanged` — correct, and recorded in `CONTEXT.md` as a gap.

### [2026-09-24] Three reading counters, none of which refuses a save

**Decided:** `lib/cv/reading.ts` computes **`claims_split`**, **`claims_duplicated`** and
**`unclaimed_run_max`** from the surviving spans, on every save. All three are logged, returned in the
201's `validation` block and alerted on (`12` §6). None refuses a save.

**Why three and not one:** each names one of #27's defects, so the alert says *which* reading went
wrong instead of only that one did. A single summed counter would need re-deriving by hand every time
it fired.

**Why not `spans_rejected`:** it is the anti-hallucination guard and answers one question — is this
quote really in the stored text. It was **0** for every defect #27 measured, because all of them slice
back verbatim. `12` §6's alert was therefore blind, and `11` §1 gains a fifth silent failure.

**Why `claims_split` is defined the way it is.** Two claims count as one sentence cut in half when
nothing but punctuation separates them, **no line break does**, and **no sentence ends between them**.
Each condition rules out a reading that is fine, and the last one was learned from the real data: a
`.docx` paragraph is one line, so two finished sentences of a 職務要約 sit on the same line with 「。」
between them. Without that condition the counter read 25 on a 応募書類 whose claims were all whole —
29% — which would have made any threshold a coin toss. With it, the measured separation is clean:
**63 `ja` and 68 `en` on the bad reading, 0 and 0 after.** Overlapping spans count unconditionally;
one assertion read twice is a defect whatever the punctuation.

**Why a save is never refused.** A `422` is "an invariant refused this", and a bad reading is the
model's judgement. There is no edit the user could make that would clear it, so refusing twice on the
same paste is a dead end with no remedy. Rejected with it: storing the counters on `cv_versions`,
which #27 puts out of scope as a schema change.

**Rejected at the wrong layer**, as #27 says: a minimum claim length and a tighter near-duplicate
threshold. 「CI/CD構築」 is 7 characters and fine; 「プール設定とタイムアウトを見直し」 is 16 and wrong.

### [2026-09-24] A repeated assertion is one claim per version, dropped and counted

**Decided:** `readClaims` keeps one claim per distinct `text_normalised` per version, in body order,
and counts the rest as `claims_duplicated`. `spans_checked` therefore becomes
`claims.total + spans_rejected + claims_duplicated`.

**Why:** #27's acceptance — an enumerated list contributes each entry once per version, not once per
document that repeats it. Carry-forward and Coverage both key on the normalised text, so a second row
double-counts the same material and pads Coverage with lines no answer will cite.

**What actually fixed it was the prompt, and the numbers say so.** Exact-text dedupe caught only 5 of
the 34 doubled Japanese claims, because the 履歴書's table row carries year and month cells that the
職務経歴書's line does not. After `cv-extract-ja-1.1` the model stops returning them at all:
`claims_duplicated` is **0**, and the 職務経歴書's 保有資格 block — 1,071 code points — now sits
unclaimed because the 履歴書 already states it. The dedupe is the backstop, not the fix.

**Consequence for carry-forward:** many-to-one can no longer arise from a version saved after #27,
since no two claims in one version share a normalised text. The tie-break on the **previous** version
stays live and necessary — every version saved before #27 can hold the same assertion twice.

### [2026-09-24] `unclaimed_run_max` alerts on a measured threshold, not on zero

**Decided:** `12` §6 alerts when `unclaimed_run_max` exceeds **2,000 code points**, while
`claims_split` and `claims_duplicated` alert at any non-zero value.

**Why:** the counter cannot be strict, and the reason is the rule above. A 職務経歴書 that repeats the
履歴書's qualifications now leaves that whole block unclaimed **by design** — 1,071 code points — and
a `TECHNICAL SKILLS` section that names tools without saying where they were used is 956 and is
correctly left alone (`03` §4). The gap that started #27, the skipped English `PROJECTS` block, was
3,875. 2,000 separates them with room, and it is the only one of the three thresholds that is a
judgement rather than a measurement. Tune it when there is more than one CV's worth of readings, the
way `12` §6's near-duplicate row is tuned.

**Carried, not hidden:** the Japanese number went **up**, from 239 to 1,071. Read alone this counter
would call the old reading the better one. That is what it costs to have a counter that catches a
skipped section, and it is why there are three.

### [2026-09-24] A bare inventory of skills is not a claim, and its section stays unclaimed

**Decided:** both prompts say so explicitly. The English CV's `TECHNICAL SKILLS` block — a heading and
six `Label: comma-separated list` lines, 968 code points — yields no claims, by design.

**Why:** `CONTEXT.md` defines a Claim as an atomic **citable** assertion, and the prompts already said
"a skill used somewhere specific". A 149-character line of comma-separated tokens quoted back as
evidence proves nothing about where or how any of them was used; the skill becomes a claim where
`EXPERIENCE` and `PROJECTS` say what it was used on. #27 listed the gap among its defects but its
acceptance boxes demanded only that `PROJECTS` yield claims, which it now does — `unclaimed_run_max`
fell to 956 on a 3,875-character block.

**Rejected:** one claim per skills line, which closes the gap and lets the threshold be tight, but
puts an inventory into Coverage — the same complaint #27 makes about the doubled certifications.

---
## Phase 6 — #20, the reviewed copy draft

### [2026-09-24] The six-change copy draft is applied, and the native read is still owed

**Decided:** the six proposed changes in `docs/checklists/native-read-cv.md` §1 are **applied** — to
`app/(app)/cv/copy.ts`, and through to `10` §13 and `e2e/cv.spec.ts`, which quote the same sentences.
The two mechanical rules they earned (no space between a Latin numeral and the Japanese that follows
it; a document's body is `本文`, never a bare `文`) go into `05` §6 and are asserted over every `ja`
string in `app/(app)/cv/copy.test.ts`. **Every box in §1 stays ☐, and `11` §5's native read is still
owed on #20** — now on the amended strings, with the originals kept in the checklist so the read can
overturn them. §3's three prose `職務経歴書` strings were *not* applied; no code renders them and `05`
§6 already sends them through the read with the screens that carry them.

**Why:** the user was offered the rows one at a time and declined to rule on them, so the alternative
was to leave six strings that a review had already found wrong sitting in the panel indefinitely,
blocking `develop` on a reading that had not been scheduled. Applying them makes the panel better on
the evidence available; **what it does not do is discharge the rule.**

**Rejected: ticking the boxes.** A review by the same agent that wrote the strings is not a native
ear, and a checklist that recorded it as one would be precisely the dishonest instrument the brief
refuses to build — the same argument as the 2026-09-23 entry that refused to call the extraction good
because `spans_rejected` was 0. The cost of being wrong here is not symmetric: an unticked box costs
one more reading, a wrongly ticked one costs the rule.

**Rejected: holding everything for the read.** `05` §6's rules are mechanical and testable
independent of an ear, and a test that encodes a rule is cheap to delete if the read overturns it.
The rule and its test come out together.

---
## Phase 6 — #20, the real-CV extraction check

Decided while running the real CVs through `/cv` locally against Docker Postgres. The measurement came
first and the cap second, because a cap guessed in advance would have refused the save it was supposed
to be measured from.

### [2026-09-23] The extraction is judged, and it is not good enough

**Decided:** `CONTEXT.md`'s "CV claim extraction quality" closes with a verdict of **inadequate**.
The defect is the extractor prompt in `lib/ai/extract-cv-claims.ts`, not spans, not the schema and not
the screen; it gets its own ticket rather than a fix inside #20, and the CV feature does not reach
`main` with the prompt as it stands.
**Alternatives considered:** accepting the reading on `spans_rejected` 0 and 307/307 verbatim slices;
treating it as a Japanese-only density problem; raising it as a note against #21.
**Reason:** three things were measured against the real 応募書類 and CV, and each one fails a different
promise the docs make.

- **Clause-splitting.** 172 of 181 Japanese claims and 113 of 126 English ones sit in runs of
  consecutive spans separated by nothing but punctuation — a single sentence cut at its 連用形 hinges.
  「開発用成果物の混入を特定し」, `including rollback strategies` and `ensuring safety and quality
  compliance` are subordinate fragments. A Claim is defined in `CONTEXT.md` as an atomic, **citable**
  assertion; a fragment that cannot stand alone cannot be quoted back as evidence, which is the whole
  job.
- **A whole section missed.** **3,875 code points — 27% of the English CV, the entire `PROJECTS`
  block — produced zero claims**, while the 17 certification lines were extracted twice over, once
  from the 履歴書's table and once from the 職務経歴書's list. The most quantified, most citable
  material in the document is invisible to Coverage, and a keyword list is over-represented in it.
  Japanese has no unclaimed stretch of 400 code points anywhere.
- **Table rows are captured with their cell breaks inside the span**, e.g.
  `"2021\n\n5\n\n普通自動車第一種運転免許（AT限定）取得"`. Quotes are sliced from stored text by span
  and never from model output (`04`), so that is what would render verbatim in feedback.

**What this also settles, and is the more serious half:** **every one of these failures reports
`spans_rejected` 0.** `07` §5.2 returns that counter and `12` §6 alerts on it being non-zero, and both
are blind here — the instrument that was meant to catch bad extraction reads perfect health. That is
an `11` §1 silent failure in the class the testing plan exists to name, and it is why the check had to
be a human one.

**And the screen's own check is defeated at this granularity.** `10` §13 argues the underline is how
extraction gets read: "a wrong span is visible as a phrase underlined that is not an assertion, or an
assertion left bare." Measured in the DOM against the real documents, the 履歴書 is **83.1%**
underlined, the 職務経歴書 **85.0%** and the English CV **57.8%**, with unbroken underlined runs of
**993, 977 and 710 characters**. An underline covering six-sevenths of a page is a highlight, not a
marker. The screen is not wrong — it did its job, by making this visible the moment a real CV was in
it — but it cannot be the check while the extractor segments this finely.

**Rejected in passing:** tightening the near-duplicate threshold, or dropping short claims by a
character floor. Both treat the symptom at the wrong layer; the 7-character 「CI/CD構築」 and the
fragment 「プール設定とタイムアウトを見直し」 are both short, and only one of them is wrong.

### [2026-09-23] No claim is drawn from the 履歴書's personal particulars, verified against a real one

**Decided:** recorded as verified rather than asserted. The first claim in `応募書類 v1` starts at code
point **239**, immediately after the `学歴` header at 228; name, ふりがな, date of birth, address,
telephone and Email are entirely unclaimed, and no claim in the version matches a telephone, `〒`,
`@`, ふりがな or date-of-birth pattern.
**Reason:** `CONTEXT.md` defines a Claim as "never drawn from a 履歴書's personal particulars", and
until #20 that had only ever been checked against the synthetic seed, which has no real particulars in
it to draw from. The hint string tells the user those fields may be omitted; this user did not omit
them, which is what made the check meaningful.

### [2026-09-23] Every CV extraction log line carries the body's size in code points

**Decided:** `cv_version_created` and both `cv_extraction_failed` paths log `body_chars`, and the
failure paths gained `documents` too. `body` is assembled before the model call so the size is on the
failure lines as well.
**Alternatives considered:** counting the characters by hand beside each duration; logging the size
only on success; UTF-16 `length`.
**Reason:** a duration with nothing to divide it by is not a measurement, and #20's cap had to come
from a real pair. Code points, because that is the unit of every `cv_claims.span_start/end` and every
`cv_documents.start/end` — a cap counted in UTF-16 would refuse a Japanese CV about 6,000 characters
shorter than the number it names, and `𠮷` would count twice. A count is what `12` §7 allows in a log
line; the text is not.

### [2026-09-23] An over-cap CV is `422 cv_too_large`, not a `400`

**Decided:** a twenty-fifth code in the `07` §3 catalogue, `422`, with `body_chars` and
`max_body_chars` in `detail`. #20's acceptance criterion said `400`; the criterion was wrong and was
amended.
**Alternatives considered:** `400 invalid_request` naming `documents`; a new code that returns `400`.
**Reason:** `07` §2's status table says every `400` is `invalid_request`, and §5.2 reserves that for
composition and order — a request over the cap is well-formed and correctly composed. The catalogue
already holds the exact analogue: `upload_too_large`, a `422` checked before the expensive step. And
`invalid_request`'s sentence does not tell the user to shorten anything, so reusing it would have
pushed a copy decision into the screen and out of `lib/copy/errors.ts`. The cap is a stated limit
beside `max_body_chars`, not a new invariant — nothing in `CLAUDE.md`'s list grew.

### [2026-09-23] The text-size cap is per language: `ja` 30,000 and `en` 45,000 code points

**Decided:** `lib/cv/limits.ts` holds `MAX_BODY_CHARS`, checked in `postCvVersion` before the database
is read and long before the model call. Closes `07` §7's TBD.
**Alternatives considered:** one cap for both languages; tokens, via a tokenizer; `ja` 20,000 /
`en` 30,000; `ja` 60,000 / `en` 90,000.
**Reason:** the three measured calls — 1,500 characters in 51.0 s, 9,202 in 59.5 s, 14,607 in 48.0 s —
show duration does **not** track input size across a ten-fold range. It tracks **claims**, at roughly
`21.5 s + 0.21 s × claims`, and claim density is a property of the language: about 20 claims per 1,000
characters in Japanese against 8.6 in English. One number would therefore have meant two different
calls: sized for Japanese it would refuse English CVs three times shorter than they could safely be.
A tokenizer tracks latency most closely but adds a dependency whose encoding would have to be verified
against the pinned model, and a token limit is not a number the user can reason about. The two numbers
are a little over three times the real sets, so a 履歴書 plus a 職務経歴書 plus five supporting
documents fits; at the cap the predicted call is ~145 s (`ja`) and ~105 s (`en`), inside the OpenAI
client's 240 s timeout with margin. `gpt-5.6-sol`'s own limits were checked and are not binding here:
922,000 input tokens and 128,000 output against ~24,000 output at the cap.
**Rejected in passing:** enforcing it before the measurement. A cap guessed from the synthetic CV's
51.0 s would have been set near 7,000 characters and refused the real 応募書類 unread.

### [2026-09-23] Extraction quality is measured; the human judgment of it is not yet in

**Decided:** `CONTEXT.md`'s "CV claim extraction quality" stays open with the findings written beside
it, rather than closing on the numbers alone.
**Alternatives considered:** closing it on `spans_rejected` being 0.
**Reason:** `spans_rejected` 0 proves every claim is verbatim in the document — it says nothing about
whether 181 claims from a 9,202-character 応募書類 is a good reading or a shredding. `11` §5's eyeball
and five-quote sample are a human check by design, and they are not done.

---
## Phase 6 — #19, the synthetic CV seed

Decided while building #19. All four came from grilling; `12` §1 had already fixed the rest (an
invented person, fixture claims, no model call, every span validated, idempotent).

### [2026-09-22] The CV seed is its own script, `npm run db:seed:develop`

**Decided:** `scripts/seed-develop.mts` seeds the user row, then the synthetic CV in each language.
`db:seed` stays user-row-only and is still the only seed `12` §3 step 9 names for production.
**Alternatives considered:** folding the CV into `db:seed`; a `--cv` flag on it; a guard that refuses
when the URL's role or host looks like `main`.
**Reason:** production runs `db:seed`, and a synthetic CV in Neon `main` would become the current CV
version the first real rounds are scored against. A flag is one mistyped runbook line from that, and
the script cannot reliably tell which Neon branch it is connected to; a guard keyed on naming breaks
silently on the first new role name. Two commands make the production one incapable of the mistake.

### [2026-09-22] The seed writes a language only if that language has no CV version at all

**Decided:** under the same advisory lock the save takes (`lockCvLanguage`), the seed checks for any
current version in the language — seeded or saved — and skips the language if there is one. The write
itself is `saveCvVersion`, so the label, `clock_timestamp()` and document ranges come from the same
code as a real save. The seed is therefore always `応募書類 v1` / `CV v1`.
**Alternatives considered:** relying on `saveCvVersion`'s own `cv_unchanged` check.
**Reason:** #19's own verification makes a real save on `develop`. After it, `cv_unchanged` would let a
rerun append the seed again as `v3`, and "one version per language" would hold only until the first
save. Refreshing `develop` is a reset and a fresh seed, never a seed on top (`12` §1).

### [2026-09-22] Fixture claims carry null extractor stamps

**Decided:** the seeded versions' `extractor_model_id` and `extractor_prompt_version` are `null`.
`NewCvVersion`'s two fields widen to `string | null`; the real save path still always passes strings.
**Alternatives considered:** the production values (`gpt-5.6-sol`, `cv-extract-*`); a marker string
such as `fixture`.
**Reason:** no model produced these claims, and a null stamp says exactly that. The production values
would record an extraction that never happened, in the record the open extraction-quality check will
trust; a marker would be an invented value in a column of model ids, turning up in any "which model
extracted what" query as if it were one.

### [2026-09-22] Fixture claims are verbatim quotes, located and validated

**Decided:** each claim is written as a quote tagged with its document. The seed locates it with the
span checker's `locate` and runs the span through `validate`; a quote that is not in its document
exactly once fails the whole seed before anything is written. Errors name positions, never text.
**Alternatives considered:** hand-typed `[start, end)` numbers plus the expected text.
**Reason:** counting code points by hand in Japanese is the very error the validator exists to catch,
and every edit to a fixture document would mean recounting. "Exactly once" also refuses a repeated
quote that `locate` would otherwise resolve by position, underlining whichever occurrence came first.
The 履歴書 fixture puts 𠮷 — one code point, two UTF-16 units — before every claim, so a span counted
in UTF-16 fails the test.

---

## Phase 6 — #18, the per-session rate limiter

Decided while building #18. All four came from grilling, after the platform docs were checked.

### [2026-09-22] The limiter is a Postgres fixed window, not Vercel's WAF

**Decided:** `rate_limit_windows` (`04` §2), one row per `(session_id, route)`, advanced by a single
`insert … on conflict do update` that restarts the window when it has lapsed and otherwise increments
`count`, returning the window start so `Retry-After` is the exact remainder. An expand-only migration.
**Alternatives considered:** Vercel WAF Rate Limiting through the `@vercel/firewall` SDK's
`checkRateLimit(id, { request, rateLimitKey })`.
**Reason:** checked against Vercel's docs (last updated 2026-08-28) on 2026-09-22. WAF rate limiting
*is* on Hobby — one rule per project, fixed window 10s–10 min, 1,000,000 allowed requests included —
and the SDK does take a custom key, so per-session keying was possible. Against it: the documented
result is only `rateLimited: boolean`, so `Retry-After` would be a guess at the window rather than the
real remainder, and `07` §2 exists so the screen can say how long; the rule lives in the dashboard,
outside review, and is published to the production deployment, with previews (`develop`) needing
Protection Bypass; and it cannot run against the Docker database, so #18's integration test could not
exist. Postgres behaves identically locally, on `develop` and on `main`, and its limit is in the repo.
The cost is one write per ⚡ request, which is nothing beside the model call it guards.

### [2026-09-22] Each ⚡ route has its own bucket

**Decided:** the key is `(session, route)`, and each route's limit and window are a constant beside
the limiter. One module, many buckets.
**Alternatives considered:** one budget per session across every ⚡ route.
**Reason:** a round will make many model calls in minutes and a CV save makes one; one number cannot
fit both, and a round's legitimate burst must not lock the CV screen (or the reverse).

### [2026-09-22] `POST /api/cv-versions` is limited to 6 per 10 minutes

**Decided:** 6 requests per 10-minute fixed window, per session.
**Alternatives considered:** 3 per 10 minutes; 20 per hour.
**Reason:** a real editing burst — save, see a typo, save again — fits with room to spare, while a
runaway loop or a stolen cookie is held to about 36 extraction calls an hour. The longest wait the
screen can show is under ten minutes; an hour-long window could show one near sixty.

### [2026-09-22] The count is taken after the session check, before the body is parsed

**Decided:** every authenticated request to a ⚡ route counts, including those later refused as `400`
or `422 cv_unchanged`. Unauthenticated requests are `401` before the limiter and are not counted.
**Alternatives considered:** counting only requests about to make a model call.
**Reason:** the same position on every ⚡ route, so the shared limiter is one line at the same place
rather than placed per route; a flood of malformed bodies is turned away before Zod or the database's
real work. Client-side validation already stops most `400`s being sent, so honest use rarely pays for
a refusal. Keyed by session, not user, as `07` §1 rule 5 states it; with one allowlisted account a
second session means the account itself is in someone else's hands, which no limiter answers.

## Phase 6 — #17, importing a document

Decided while building #17. The first four came from grilling.

### [2026-09-22] `.docx` is read with mammoth, `.pdf` with pdfjs-dist, both in the browser

**Decided:** `mammoth` 1.12.3 (`extractRawText`) for `.docx` and `pdfjs-dist` 6.3.289
(`getTextContent`) for `.pdf`, pinned in `03` §1. Both are loaded by dynamic `import()` only when a
file is picked, so `/cv`'s bundle carries neither until then.
**Alternatives considered:** `unpdf` 1.8.1 over pdf.js; one library for both formats.
**Reason:** both are the maintained first-party choice, checked against current docs 2026-09-22.
`unpdf` wraps pdf.js for serverless runtimes, and extraction here runs in the browser, so it adds a
layer and no benefit. No mainstream library reads both formats in a browser.

### [2026-09-22] pdf.js's worker and CMaps are served from our own origin

**Decided:** the worker is bundled by Next from `new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs",
import.meta.url))` and handed to pdf.js as `workerPort`. `scripts/copy-pdfjs-assets.mjs` copies
`pdfjs-dist/cmaps/` to a git-ignored `public/pdfjs/cmaps/` before `next dev` and `next build`, and
`vercel.json` sets `buildCommand: "npm run build"` so a deploy cannot skip it.
**Alternatives considered:** a version-pinned jsDelivr URL; committing the CMaps.
**Reason:** a Japanese PDF with a non-embedded font cannot be read without the Adobe CMaps — measured:
the #17 fixture gives its three lines with them and an empty string without. Same-origin keeps the
CMaps at exactly the installed version, adds no third party to the moment of import, and survives a
future CSP. Committing 1.6 MB of CMaps would drift from the package on the next bump.

### [2026-09-22] An import replaces the box's text, without a confirm

**Decided:** the extracted text replaces whatever the box held, and `source_filename` becomes the new
file's name (capped at 255 characters, `07` §5.2).
**Alternatives considered:** a confirm before overwriting a non-empty box; appending.
**Reason:** `10` §13 says the text is dropped into the box. The only thing an import can lose is unsaved
edits in that one box — the saved text is still the current version. Appending would mix two sources
under one filename.

### [2026-09-22] A failed import says which of two things went wrong, and leaves the box alone

**Decided:** `no_text` (the file opened but held no text — a scanned PDF) and `unreadable` (corrupt,
password-protected, or not really a `.docx`/`.pdf`, judged by leading bytes as well as extension) each
have their own line under the box. No OCR.
**Alternatives considered:** one generic line; OCR with `tesseract.js`.
**Reason:** the two have different next steps, and a scanned PDF reported as a generic failure looks
like a bug. OCR is a heavy dependency whose Japanese quality is unmeasured, and pasting is always
available. The two lines are client-side copy in `app/(app)/cv/copy.ts`, not error codes: no request is
made, so `07` §3's catalogue is untouched.

### [2026-09-22] The import fixtures are generated, and the PDF's font is not embedded

**Decided:** `scripts/make-import-fixtures.mts` writes `e2e/fixtures/{shokumu.docx,rirekisho.pdf,blank.pdf}`
from Node built-ins, deterministically; script and output are both committed. The PDF uses
`HeiseiMin-W3` under `UniJIS-UCS2-H`, not embedded.
**Alternatives considered:** authoring the files in Word; adding a Word-exported PDF beside the
generated one.
**Reason:** a Word-exported PDF embeds its font with a ToUnicode map and passes whether or not the CMaps
are served, so it cannot catch the failure that matters. Verified: with `public/pdfjs/` hidden, the
import test fails on the PDF's box.

### [2026-09-22] Imported text is tidied, never unwrapped

**Decided:** every import gets LF line endings, no control characters, no trailing spaces (including
U+3000), at most one blank line in a row and no blank ends (`lib/cv/import/text.ts`). Line wraps are
left as they are.
**Alternatives considered:** keeping mammoth's two newlines per paragraph as-is; joining a PDF's wrapped
lines.
**Reason:** mammoth's empty paragraphs stack into runs of blank lines nobody wants. Unwrapping is a
guess that would join lines meant apart, and fixing a PDF's wraps is exactly the correction `10` §13
asks the user to make before saving.

---
## Phase 6 — #16, next CV versions

Decided while building #16. The first four came from grilling.

### [2026-09-22] Carry-forward is many-to-one, lowest `span_start` wins a tie

**Decided:** each new claim whose `text_normalised` matches a claim in the immediately previous version
points at the match with the lowest `span_start`. Several new claims may point at one previous claim.
`carried_forward` is the count of new claims with a parent.
**Alternatives considered:** one-to-one pairing in position order, a surplus duplicate counting as new.
**Reason:** `04`'s exact-match rule stays the only rule, with a deterministic tie-break and no pairing
logic for an edge case (the same sentence in two documents). A forked lineage is harmless: coverage
asks whether anything in the chain was ever cited.

### [2026-09-22] Older CV versions open at `/cv/versions/{id}`

**Decided:** a history row links to a server-rendered read-only page in the current-version view's
shape, with a link back. Another user's id or a bad id is a 404.
**Alternatives considered:** expanding the row inline in the panel.
**Reason:** `/cv` loads only label, date and count for history, not every old body, and needs no new
`GET` endpoint. Each version gets a URL, which a CV stamp on an old answer will link to.

### [2026-09-22] `cv_unchanged` is checked twice

**Decided:** once before the model call against the current version, and again inside the write
transaction, under the lock, against what is current then. Either match is `422 cv_unchanged`,
nothing written.
**Alternatives considered:** the pre-extraction check only.
**Reason:** two tabs saving the same edit both pass the first check, and the loser would otherwise
write a permanent duplicate and a false Progress boundary. The second check costs one wasted
extraction in a rare case.

### [2026-09-22] Saves in one language are serialised by an advisory lock; `created_at` is `clock_timestamp()`

**Decided:** the write transaction starts with `pg_advisory_xact_lock` on `(user_id, language)`. The
version row's `created_at` is set to `clock_timestamp()`. The unique label index stays as a backstop;
the retry-with-the-next-number loop is removed, so a violation fails the save.
**Alternatives considered:** keeping `now()` and the retry loop; ordering "current" by label number
instead of `created_at`.
**Reason:** `now()` is the transaction's start. A save that began first but read second would become
`v3` dated before `v2`, and "current" — `max(created_at)` — would name `v2` while `v3` exists: rounds
stamped against the wrong version, carry-forward from the wrong one. The unique index does not catch
it. The lock also makes the in-transaction `cv_unchanged` check and "immediately previous" exact.
Checked against Neon's pooling docs (2026-09-22): PgBouncer transaction mode refuses session-level
advisory locks only. Ordering by label would have rewritten `04` §6 #9 and its index.

### [2026-09-22] The prefilled form carries each document's `source_filename`

**Decided:** the new-version form is seeded with every document's kind, title, text and
`source_filename`, and sends the filename back unless the document is removed. Import (#17) replaces
it.
**Alternatives considered:** dropping the filename on prefill; dropping it once the text is edited.
**Reason:** the text still came from that file. `cv_unchanged` ignores the filename, so it cannot make
an unchanged save look changed.

---
## Phase 6 — #15, the Japanese CV and additional documents

Decided while building #15. The first three came from grilling; the rest are the shapes the code took.

### [2026-09-21] Document order is refused, not repaired

**Decided:** a set's documents arrive in one order: the required document (`rirekisho` / `cv`), then,
for `ja` only, at most one `shokumu_keirekisho`, then up to five `additional` documents in the order
the user added them. `position` is the request index, and `body` is joined in that order. Any other
order is `400 invalid_request` naming `documents`. A kind the language refuses is named at
`documents.<i>.kind`.
**Alternatives considered:** the server sorts whatever it receives into that order (stable for
additional documents); no kind order at all, with `position` being whatever the client sent.
**Reason:** it follows the endpoint's rule that anything outside the shape is refused rather than
quietly fixed. With no reordering, request index, extractor document index and `cv_documents.position`
are the same number, which keeps `survivingClaims` and #16's `cv_unchanged` "same order" comparison
simple. The form always builds that order anyway: a 職務経歴書 added after a supporting document is
placed straight after the 履歴書.

### [2026-09-21] The total text-size cap is #20's, measured, not #15's, guessed

**Decided:** #15 ships no size cap. #20 measures the real extraction call on the real CV and sets the
cap there, with its own entry here. `07` §5.2 says so.
**Alternatives considered:** a provisional generous cap now, replaced later; measuring in #15 on
synthetic CVs with a real key.
**Reason:** `07` §5.2 says the number is measured, not guessed, and measuring needs a real
`OPENAI_API_KEY`, which `.env.local` does not have yet. A provisional number would get defended rather
than checked. The 300s function ceiling still holds whatever the size, because the SDK timeout is 240s
and a timeout is a `502` that writes nothing.

### [2026-09-21] Claim is `記載事項` in Japanese

**Decided:** the 応募書類 panel says `記載事項 34件`, `記載事項を抽出しています。…`. Proposed until
#20's native read, where it is read in place on the screen.
**Alternatives considered:** keeping `10` §13's `主張`; avoiding the noun (`抽出 34件`) and deferring
again.
**Reason:** #13's read rejected `主張` (it reads as argument) and deferred the word to "the first
screen that lists claims". This panel is that screen. `記載事項` was #13's leading candidate. In the
same pass `10` §13's `版` became `バージョン`, applying #13's rule rather than deciding anything new.
`app/(app)/cv/copy.test.ts` now enforces both, as `lib/copy/errors.test.ts` does for the catalogue.

### [2026-09-21] English prompt bumped to `cv-extract-en-1.1`; `1.0` is kept, unused

**Decided:** each document's header now names its kind and, for an additional document, the user's
title: `=== document 2: additional, titled: <title> ===`. `cv-extract-en-1.0` described the old
header, so English moves to `cv-extract-en-1.1`, and Japanese starts at `cv-extract-ja-1.0`. The 1.0
file stays, unedited.
**Alternatives considered:** editing 1.0 in place, since no deployed database holds a 1.0 stamp.
**Reason:** a prompt's version is its filename and a changed prompt is a new file (`03` §4). The
safety of an in-place edit rested on no stamp existing anywhere, and that is not something to rely on.
Keeping 1.0 means any 1.0 stamp still points at the text that produced it. The model needs the kind so
it can treat a 履歴書's particulars differently from a portfolio's prose. A title's line breaks are
collapsed so that it stays on its header line.

### [2026-09-21] Both prompts are written in English; the Japanese one names Japanese sections

**Decided:** `cv-extract-ja-1.0` gives its instructions in English and names the material in
Japanese: 学歴, 職歴 (and the 職務経歴書's 職務要約 / 職務経歴 / 活かせる経験・知識・スキル), 免許・資格,
志望動機, 自己PR. It lists the personal particulars by their 履歴書 headings, including 本人希望記入欄
(salary expectations are on `12` §7's never-log list), 通勤時間 and 扶養家族数. It rules out 趣味・特技
and the date written at the top of the form. It forbids converting between full- and half-width
characters and between eras in a quote, because the server locates the quote verbatim.
**Alternatives considered:** instructions written in Japanese.
**Reason:** the rules are the same in both languages, so writing both prompts in one language keeps a
diff between them readable. The section names are in Japanese because that is what the documents
literally say. Whether this extracts well is #20's question, answered on the real CV, not here.

### [2026-09-21] A quote across a document join is counted as `not_found`

**Decided:** the integration test for a claim that runs from the 履歴書 into the 職務経歴書 asserts that
it is dropped and counted in `spans_rejected`, with no stored span leaving its range. The reason
logged is `not_found`, not `crosses_document`.
**Alternatives considered:** widening `locate` to search the whole body, so that such a quote reaches
the validator and is rejected as `crosses_document`.
**Reason:** `locate` searches only the document the model named, so a quote containing the separator
can never be found there. The validator's `crosses_document` check stays as the backstop, and its unit
test proves it. Searching the whole body only to reject the result would add a code path that exists
to produce a different log label.

---
## Phase 6 — #14, the tracer bullet

Decided while building #14: an English CV pasted, saved and read back with its claims underlined.
The first two came from grilling during the build; the rest are the shapes the code took.

### [2026-09-21] The extractor returns a verbatim quote and a start hint; the server finds the span

**Decided:** the extraction port returns, per claim, a document index, the quote copied verbatim, and
an approximate start offset within that document. The server finds every exact occurrence of the quote
in that document, takes the one nearest the hint, and runs the resulting span through the unchanged
span validator (`lib/cv/spans.ts`). A quote that is not in the document verbatim has no span and is
counted in `spans_rejected` as `not_found`. The hint picks between occurrences; it never moves one.
**Alternatives considered:** the model returns `[start, end)` plus the text, as `04`, `07` §5.2 and
`03` §11 first assumed, and anything that does not slice back exactly is dropped.
**Reason:** models count characters badly, and worst of all in Japanese. On a 5,000-character CV most
model-counted offsets would miss, get dropped, and push saves into `cv_extraction_failed`, and the
first place anyone would find out is the real-CV check in #20. Locating the quote keeps everything the
design relies on. The rendered quote is still sliced from stored text by span. A hallucinated quote is
still dropped and counted, never clamped. The validator still checks range, graphemes and document
boundaries. Only the source of the offset changes, and that is the part the model was worst at. One
consequence: `mismatch` (a span whose slice differs from the claimed text) can no longer happen through
the handler, because the span comes from finding that text. It stays in the validator, which is also
what the seed runs its fixture spans through (#19).

### [2026-09-21] A character is a Unicode code point

**Decided:** every span, every `cv_documents.start/end` and every `cv_claims.span_start/end` counts
Unicode code points. `lib/cv/spans.ts` works on `Array.from(body)`, and span boundaries must also fall
on grapheme boundaries (`Intl.Segmenter`), or the span is dropped as `splits_grapheme`.
**Alternatives considered:** JavaScript string indices (UTF-16 code units); bytes.
**Reason:** the rendered quote is Postgres `substring(body, …)`, which counts code points. JavaScript
indices would shift every quote after the first surrogate pair (𠮷, most emoji) by one. An integration
test slices through Postgres to prove the two agree. Correcting `11` §3.3 in passing:
`請求処理を40%短縮` is **10** characters and **24** UTF-8 bytes, not 9 and 27. The point of the
example (characters are not bytes) stands.

### [2026-09-21] Playwright answers OpenAI from a local mock, via a localhost-only `OPENAI_BASE_URL`

**Decided:** `e2e/mock-openai.ts` is a small HTTP server that answers `POST /v1/responses` in the
Responses API's shape and records what it was sent. `playwright.config.ts` boots the app with
`OPENAI_BASE_URL` pointing at it and `OPENAI_API_KEY` set to a string that is not a key.
`lib/config.ts` gains `OPENAI_BASE_URL` as its one optional variable, **refused unless the host is
`localhost` or `127.0.0.1`**, and the extractor always passes a base URL to the SDK explicitly, so the
SDK never reads `process.env.OPENAI_BASE_URL` itself.
**Alternatives considered:** Next's `experimental.testProxy`, chosen first and dropped (below); an env
switch that swaps the fake extractor into the route.
**Reason:** the real extractor's request and parsing run end to end, and nothing the mock misses can
spend money or reach OpenAI. The localhost rule means no value of this variable can send the key to
anyone else's server. **Why the test proxy was dropped, measured on Next 16.3.5:** with `testProxy` on,
a request carrying a valid session hung for over 20 seconds on the session lookup, and the same cookie
worked on the same build with the proxy off. Its interceptors break node-postgres, so no signed-in page
can run behind it. It also broke the sign-in Server Action's redirect to Google. The fake-extractor
switch was rejected because it never exercises the real implementation, and it is a flag that could
put a fake into production.

### [2026-09-21] Playwright gets its own database, and loads env files the way `next start` does

**Decided:** Playwright's global setup drops and recreates `suburi_e2e` on the local (or CI service)
Postgres, runs the real migrations and seeds `ALLOWED_EMAIL`. The server under test is booted against
it. `playwright.config.ts` loads env with `@next/env`'s `loadEnvConfig`, pinned at 16.3.5 with `next`.
CI's separate "migrate the end-to-end database" step is gone.
**Alternatives considered:** keep pointing e2e at `DATABASE_URL`, the local dev database.
**Reason:** a spec that saves a CV must start from a real empty state, and nothing Playwright writes
should land in the database where the real CV is checked (#20). `.env.local` exists locally and takes
precedence over `.env` for `next start`; reading only `.env` in the test process would sign sessions
against different values than the server verifies them with.

### [2026-09-21] The extraction call runs before the transaction, not inside it

**Decided:** the model call happens first. The version, its documents and its claims are then written
in one transaction. A lost race on the label index retries that transaction with the next number,
up to three times. **`03` §4 said the call "runs inside the same transaction as the insert"**; it now
says the writes are one transaction and the call precedes them.
**Alternatives considered:** open the transaction, call the model, write, commit.
**Reason:** there is no observable difference. Nothing is written before the call either way, so
`cv_extraction_failed` still leaves nothing behind. Holding a Postgres transaction open across a model
call measured in tens of seconds only pins a pooled connection, idle in a transaction, for the whole
wait. All-or-nothing is a property of the writes, and the writes are still atomic. An integration test
breaks the claims insert after the version row lands and asserts that all three tables are empty.

### [2026-09-21] #14 accepts English with exactly one `cv` document, and nothing else

**Decided:** the request schema is strict and narrow: `language` must be `en`, `documents` is a
one-element tuple of `{ kind: "cv", text, source_filename? }`, and unknown keys are refused. So a
client-sent `version_label` is a `400`, not silently ignored. `400`s name fields by path, never values.
**Reason:** #15 widens the schema to the `04` composition rules. A schema that is loose now would be
discovered later rather than widened deliberately. Refusing unknown keys enforces `07` §1 rule 6 (the
client chooses no stamp) at the boundary. Stripping them would only enforce it by accident.

---
## Phase 6 — between #13 and #14

### [2026-09-21] Every model string is a constant in code; no model string or prompt version is an env var

**Decided:** all model strings (scoring, generation, CV extraction, transcription, TTS) are pinned
constants in `lib/ai/models.ts`, and prompt versions come from the prompt filename in `lib/prompts/`.
`12` §2 loses `OPENAI_SCORING_MODEL`, `OPENAI_GENERATION_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`,
`OPENAI_TTS_MODEL` and `SCORING_PROMPT_VERSION`; `03` §4 and §10 name the file. **This resolves the
divergence recorded in "The extraction model string is a pinned constant in code, not an env var"
(2026-09-19)** by extending that entry's reasoning to the other strings rather than reversing it.
**Alternatives considered:** all model strings as env vars, extraction included (`OPENAI_EXTRACTION_MODEL`);
leaving the split until the scoring code lands.
**Reason:** that entry's argument was never specific to extraction. A stamp that can be changed from
the Vercel dashboard can be changed without a commit or a review, and invariant 8 says a change to the
scoring model *is* the `12` §5 procedure. The boot-time Zod check could only have refused a malformed
string, not a well-formed unreviewed one. Constants also make local, `develop` and production run the
same models by construction. It is cheap now because nothing reads any of these variables yet: none is
in `lib/config.ts`, and none was ever set in Vercel. TTS and the scoring prompt version were included
even though the tension named only the three model strings. TTS is not a stamp, but leaving one model
string in the environment would mean two ways to configure the same kind of thing. The prompt version
*is* a stamp, so it is covered by exactly the same argument.

## Phase 6 — #13, the error envelope and the catalogue

Decided while building #13, the prefactor every later ticket returns errors through. `07` §3's code
set was already closed by #12; these entries are about the shape the code takes, and the last is the
native read that closed it.

### [2026-09-21] The catalogue's native read: 質問, バージョン, 応募書類, and no word for Claim yet

**Decided:** all 24 `ja` strings accepted as written except `cv_unchanged`, where `版` became
`バージョン`. `質問` is the noun for a question and `出題` is only the generator's stamp word;
`応募書類` stands; a Japanese word for **Claim** is deferred to the first screen that lists claims,
with `記載事項` as the leading candidate. `05` §6 records the rules, and `lib/copy/errors.test.ts`
now fails any catalogue string containing `出題` or `版`.
**Alternatives considered:** `出題` for the noun, matching `10`, where it had been the only word;
keeping `版`; choosing the Claim word now, with `主張` as the other candidate.
**Reason:** an interviewer asks a `質問`, and every `出題` in `10` turned out to be a stamp, so
splitting the two words costs no screen change. `版` reads as a print edition beside a stamp that
already says `v3`. The Claim word is left open because no string needs it yet, and a word read on its
own without the screen around it is the kind of choice the read exists to prevent. `主張` was rejected
anyway: it reads as argument.

### [2026-09-21] The copy layer is `lib/copy/`, not a file inside `lib/api/`

**Decided:** error copy lives in `lib/copy/errors.ts`, a new directory whose first occupant it is.
`lib/api/errors.ts` holds the codes and their statuses and **no user-visible string**; `lib/copy/`
holds the strings and **no status**. The dependency runs one way, copy → api, so the API layer cannot
reach a Japanese sentence even by accident.
**Alternatives considered:** `lib/api/errors-copy.ts` beside the envelope; a full i18n library
(`next-intl` or similar) with locale files.

**Reason:** `07` §2 routes every user-visible string away from the API precisely so
this document does not decide the still-open bilingual chrome rule. A file inside `lib/api/` keeps the
strings one import away from the thing that must not hold them, and it makes `11` §3.10's
both-directions test compare two halves of one module rather than two modules.

*Why not an i18n library:* the bilingual chrome rule is deliberately open in `CONTEXT.md`. Choosing a
library now would answer it — every one of them has an opinion about where the active locale comes
from — and it would put a dependency on a path that currently has none.

**`03` §10's repo layout gained the `copy/` line in this ticket**, because code that diverges from the
layout means the layout changes first.

### [2026-09-21] One builder driven by a code→status table, not a function per code

**Decided:** `ERROR_STATUS` maps all twenty-four `07` §3 codes to their statuses, `ErrorCode` is
`keyof` it, and `apiError(code, message, detail?)` reads the status from it. Two named wrappers:
`unauthenticated()`, moved onto the builder with its response unchanged to the byte, and
`rateLimited(message, retryAfterSeconds, detail?)`, which is separate only because `07` §2 requires
`Retry-After` on every 429.
**Alternatives considered:** twenty-four exported functions, one per code; a thrown `ApiError` caught
by a `withErrors()` route wrapper.

**Reason:** it **is** the code list, as a value. `11` §3.10's
test iterates it rather than a hand-kept array, so a code added without copy fails without anyone
remembering to extend the test. Twenty-four declarations would have to be mirrored somewhere for the
test to see them, and a mirror drifts.

*Why not the thrown error:* `proxy.ts` returns a `Response` directly and has no wrapper to throw
into, so `unauthenticated` would need both paths from day one. #13 is a prefactor — there are no deep
call stacks yet to pay for it.

### [2026-09-21] Catalogue entries are flat strings, with nothing interpolated

**Decided:** `Record<ErrorCode, { ja, en }>`, every value a plain sentence. The two codes that render
with a value — `rate_limited` ("inline, with wait") and `invalid_request` ("inline, per field") — are
phrased so the screen renders the wait from `Retry-After` and the field marks from `detail` *beside*
the sentence, rather than the catalogue splicing them in.
**Alternatives considered:** a mixed `string | (params) => string`; every entry a function.

**Reason:** a catalogue with no placeholder has no slot
for a value to arrive in, so `03` §8's never-log list is unreachable from copy by construction. A test
asserts no entry contains `{`, `}`, `$` or `%`, which closes that door before a screen opens it.

*Why not the mixed shape:* the parameter shapes would be guesses until #18 and the CV screen exist,
and a native read of a function body is harder than a native read of a string literal — which matters,
because the native read is this ticket's acceptance criterion.

### [2026-09-21] The type check and the catalogue test guard opposite directions, and both were mutation-checked

**Decided:** the catalogue is declared `satisfies Record<string, ErrorCopy>` and then assigned to
`Record<ErrorCode, ErrorCopy>`. That assignment fails `tsc` when a code has no copy. It does **not**
fail when copy has no code — TypeScript permits the extra key — and that direction is caught only by
`11` §3.10's runtime test. Both were mutation-checked rather than assumed:

| Mutation | `tsc` | `vitest` |
| --- | --- | --- |
| `cv_unchanged` removed from the catalogue | 1 error, naming the property | 4 failures |
| `cv_deleted` added with no code | **0 errors** | 2 failures |

**Reason:** the measured zero is the whole reason `11` §3.10 says "both directions".
A reader who assumes the type covers it would be right half the time, and would delete the test that
covers the other half during a refactor.

*One rule narrowed by measurement:* the test that enforces `05` §6's counter rule started as a blanket
ban on `点` and was narrowed to a digit followed by `点`. `採点`, `未採点` and `採点をやり直す` are
already established in `10`; the rule is about `3点` as a count of marks, not about the word for
scoring.

---

## Phase 6 — getting a CV in, decided before it was built

Settled 2026-09-19 in the grilling for the first feature (spec #11, tickets #12–#21), and written into
the docs by #12 before any code followed them. Every entry below contradicts something an earlier
phase wrote; each says what.

### [2026-09-19] A CV is a set of documents per language, not one text

**Decided:** a CV is **one per language, each a set of documents**. `ja` requires exactly one 履歴書 and
allows at most one 職務経歴書 plus up to five additional documents; `en` requires exactly one CV
document plus up to five additional. An additional document may be written in either language whatever
the set's language is; the set's language decides which rounds it is scored against.
**Alternatives considered:** one text per language, as `04` and `07` §5.2 originally had it, with the
user pasting everything into one box; a `documents` table with no required kinds; separate version
histories per document.
**Reason:** it is how the user actually applies. A Japanese application *is* a 履歴書 first, sometimes
a 職務経歴書, sometimes supporting material — and a single box makes the app unable to say which
document a claim came from, which is the difference between "your 職務経歴書 never mentions this" and a
sentence it cannot write. Required kinds rather than a free-form list because a CV set missing its core
document is not a CV, and catching that at the boundary is cheaper than discovering it in a round.

### [2026-09-19] `応募書類` replaces `職務経歴書` as the Japanese stamp word

**Decided:** every Japanese version label reads `応募書類 v{n}`; English reads `CV v{n}`. `職務経歴書`
stays in use only where it means that one document. Stamps in `05` §5.4, §5.9 and every drawn stamp in
`10` were changed.
**Alternatives considered:** keeping `職務経歴書 v{n}`; `CV v{n}` in both languages; `応募書類一式`.
**Reason:** `職務経歴書` names one member of the set, and the set is what the stamp identifies. A stamp
that names a document the set may not even contain — a first-job 応募書類 is a 履歴書 alone — points at
the wrong thing on every screen that shows it. `応募書類` is the ordinary word for the bundle a
candidate submits. **It has not had its native read**; that happens with the CV screen's chrome and the
error catalogue (#13), and the read is what ships.

### [2026-09-19] One immutable `body` for the whole set, with `cv_documents` carrying ranges

**Decided:** `cv_versions.body` stays one immutable string — the set's documents joined server-side in
`position` order with a fixed separator. A new `cv_documents` table records each document's `kind`,
`title`, `source_filename`, `position` and its `[start, end)` range into that `body`. Spans, the span
validator, quote slicing and the CV-version stamp are unchanged.
**Alternatives considered:** one text column per document, with spans carrying a document id; a
`documents` JSON column on `cv_versions`; recomputing ranges from the join order on read.
**Reason:** every mechanism that makes citation trustworthy already works on a single immutable string
(`03` §11), and splitting `body` would have meant a new span type, a second validator, and a migration
that rewrites `body` — which `04` §5 forbids outright because every existing span indexes into it.
Storing the ranges beside the joined text buys the document boundary without touching any of it.
Recomputing them on read would make a separator change silently move every historical boundary.

### [2026-09-19] `cv_versions.source_filename` is retired, not dropped

**Decided:** the column stays, always null. Filenames now live on `cv_documents`, one per document.
`04` records it as retired.
**Alternatives considered:** dropping it; keeping it as the first document's filename.
**Reason:** migrations are expand-only (`12` §4) — that rule is what makes Vercel's instant rollback a
complete rollback story, and a dropped column breaks it for a tidier table. Keeping it as one
document's filename would be worse than null: a value that looks meaningful and is arbitrary.

### [2026-09-19] The version label is derived per language, and the database enforces it

**Decided:** the server derives `version_label` — `応募書類 v{n}` / `CV v{n}`, `n` per language — and
the client never sends one. `unique (user_id, language, version_label)` backs it.
**Alternatives considered:** the user naming their versions; a global sequence across both languages; a
sequence number column instead of a label.
**Reason:** the label is a **stamp** — it appears on scored answers and on Progress boundaries — and
§1's rule 6 already says the client chooses no stamp. Per-language numbering keeps the two histories
independent, which is the same reason they are separate CVs at all: changing the English CV must not
draw a boundary on Japanese progress. The unique index is there because two concurrent saves would
otherwise both compute `v4`, and two rows labelled `v4` make every answer stamped with that string
ambiguous forever.

### [2026-09-19] The current CV version is the newest one, with no flag to say so

**Decided:** current = `max(created_at)` per `(user_id, language)`. No `is_current` column. Older
versions stay readable and are never selectable for a new round; no endpoint makes one current.
**Alternatives considered:** an `is_current` boolean; a `current_cv_version_id` on `users`; letting a
round pick a version.
**Reason:** a flag is a second source of truth that a half-committed transaction can leave pointing at
the wrong row, and the ordering cannot disagree with itself. Letting a round choose would make the CV
stamp a user decision, which is exactly the failure the decision log already refused for the model and
the rubric: a stamp the user picks makes drift voluntary and biased.

### [2026-09-19] Claims stay flat — no `kind` column on `cv_claims`

**Decided:** `cv_claims` gains nothing. Which document a claim came from is answered by which
`cv_documents` range its span falls inside.
**Alternatives considered:** a `kind` column mirroring the document's; a `cv_document_id` foreign key.
**Reason:** both would be a second, copyable answer to a question the span already answers, and the two
could disagree. A `cv_document_id` is the more defensible of the two and still loses: it would have to
be kept consistent with the span, and the span is the thing the citation mechanism actually trusts.

### [2026-09-19] A claim's span may not cross a document boundary

**Decided:** the span validator gains one rule — a span must lie inside exactly one `cv_documents`
range. A span that crosses a boundary is dropped and counted in `spans_rejected`, never clamped.
**Alternatives considered:** clamping to the nearest boundary; allowing it and attributing the claim to
the document holding its start.
**Reason:** a "claim" spanning the join between a 履歴書 and a portfolio is an assertion the user never
made — it is two fragments the separator happened to put next to each other. Clamping would turn a
detected hallucination into a plausible-looking quote, which is the precise failure the validator
exists to prevent: it drops, it never repairs.

### [2026-09-19] Personal particulars never become claims

**Decided:** the extraction prompt draws only from education, work history, qualifications, 志望動機 and
自己PR. Birth date, address, telephone number, photograph and family details are never claims. The CV
screen hints beside the 履歴書 box that they can be left out of the pasted text altogether.
**Alternatives considered:** stripping them server-side before the model call; a claim `kind` marking
them so they could be filtered at citation time; saying nothing and relying on the model.
**Reason:** feedback that cites the user's address is the failure being designed out, and the cheapest
place to prevent it is for the text never to be there. Stripping server-side means pattern-matching
addresses in two languages, which fails quietly. The hint is offered rather than enforced because the
user may have reasons to paste a complete 履歴書, and the prompt rule still holds if they do.

### [2026-09-19] Extraction is synchronous, all-or-nothing, and zero surviving claims is a failure

**Decided:** one model call, inside the transaction that writes the version, its documents and its
claims. On a model failure **or zero claims surviving the validator**, nothing is written and the
response is `502 cv_extraction_failed`. The latency is measured on the first real run, not budgeted in
advance.
**Alternatives considered:** background extraction with the version written first; writing the version
and retrying extraction later; accepting a version with zero claims.
**Reason:** a CV version holding half its claims — or none — makes *"CV material never used"* a lie for
as long as that version is current, and it is current until the user saves another one. Asking the user
to press save again is a much smaller cost than a coverage count nobody can trust. Background
extraction would also put a spinner between the user and the thing they came to check.

### [2026-09-19] Extraction sits behind a port, with per-language versioned prompts

**Decided:** claim extraction is a port in `lib/ai/`, beside generate · transcribe · score, with one
real implementation on the pinned `gpt-5.6-sol` and a fake for tests — **no test ever calls OpenAI**
(`11` §2). Its prompt is one file per language in `lib/prompts/`, `cv-extract-ja-…` and
`cv-extract-en-…`, with the version in the filename and recorded on the version row as
`extractor_prompt_version`. Everything deterministic around it — the composition rules, the join that
builds `body`, the span validator, quote slicing — lives in `lib/cv/`, callable with no model at all.
**Alternatives considered:** calling the SDK directly from the route handler; one bilingual prompt
with a language parameter.
**Reason:** the same argument that made `lib/ai/score.ts` a port. Extraction quality is unmeasured, and
the only way to compare two extractors on the same CV is to swap the implementation — impossible if the
call is inlined at its call site. One bilingual prompt would make a Japanese-only wording fix a change
to the English prompt's version too, which is a boundary drawn where nothing changed. Splitting
`lib/cv/` out is what lets the span validator be a pure unit test (`11` §3.3) rather than an
integration test with a fake model bolted on.

### [2026-09-19] Carry-forward matches the immediately previous version of the same language, from any document

**Decided:** a new claim carries forward when its `text_normalised` is byte-identical to a claim in the
**immediately previous version of the same language**, from any document in it. Two versions back never
matches; the other language never matches.
**Alternatives considered:** matching against every prior version; matching within the same document
only; similarity-based matching.
**Reason:** same-document matching would reset coverage for text moved from a 職務経歴書 into a
portfolio, which is reorganisation, not a new assertion. Matching against every prior version would
make a claim deleted three versions ago and retyped today inherit coverage it had not earned, and would
make the rule's result depend on history the user cannot see. Similarity was already refused for claims
in Phase 1 and is refused again for the same reason: a reworded claim is honestly a different thing to
cite.

### [2026-09-19] A no-op save is refused: `422 cv_unchanged`

**Decided:** if every document in the request matches the current version of that language exactly on
`kind`, `title` and `text`, in the same order, the save is refused and **nothing is written**. The
client also disables the save control while a save is in flight.
**Alternatives considered:** returning `200` with the existing version; allowing the duplicate;
client-side prevention alone.
**Reason:** the new-version form is **prefilled from the current version**, so an accidental no-op save
is the likely mistake, not an unlikely one. A duplicate version is permanent (`04` §5), costs an
extraction call, and draws a Progress boundary marking a change that did not happen — a false line on
the chart the whole product exists to keep honest. A `200` would hide the refusal from a client that
should show it; client-side prevention alone is not a boundary (`07` §1, rule 3).

### [2026-09-19] Documents are pasted, or imported into editable text in the browser

**Decided:** every document is pasted, or imported from `.docx`/`.pdf` **in the browser** into an
editable box the user checks before saving. The file never reaches the server; only approved text does.
The extraction library is chosen and pinned at implementation.
**Alternatives considered:** uploading the file and parsing server-side; uploading to S3 and parsing
asynchronously; paste only.
**Reason:** a Vercel function caps bodies at 4.5 MB and a CV is text, so there is no reason for the
file to cross the boundary at all — and what gets scored must be text the user has read, because PDF
extraction reliably mangles line wraps and tables. Paste only would have been honest but makes the
user do by hand what the browser can do. Parsing server-side would add a file upload path, a
content-type surface and a temporary file, for no gain.

### [2026-09-19] The CV screen is specified straight into `10`, with per-panel chrome and no artboard

**Decided:** `/cv` is two panels, one per language; **each panel's chrome is in its own language**;
empty state offers one action; the current version renders each document's text with claim spans
underlined; the new-version form is prefilled; version history is readable and never selectable. **No
coverage marks until citations exist.** Written into `10` §13 from `05` components — no artboard.
**Alternatives considered:** a design pass first; one panel with a language switch; showing a claim
list instead of the underlined text; marking cited/never-cited now.
**Reason:** every element it needs is already measured in `05`, so an artboard would have produced
nothing the specification does not already fix, and `10` §12 had been carrying this screen as an open
item since Phase 3. The underlined full text rather than a claim list is the point of the screen: it is
how extraction quality gets checked, and a wrong span is only visible against the user's own sentences.
Coverage marks would read as "never used" on every claim until scoring exists, which is false rather
than empty. **The per-panel chrome decision is local to this screen and settles nothing for the round
screens** — the general bilingual chrome rule stays open (`CONTEXT.md`).

### [2026-09-19] The shared rate limiter is built now, with its mechanism chosen at implementation

**Decided:** one shared per-session limiter for every ⚡ route, built with `POST /api/cv-versions`
because it is the first ⚡ route to exist. `429 rate_limited` with `Retry-After`. The mechanism —
a Postgres-backed window as an expand-only migration, or Vercel's own limiting if Hobby offers it — is
chosen against current platform documentation when it is built, not asserted here.
**Alternatives considered:** deferring the limiter until the round loop; a per-route limiter.
**Reason:** this endpoint calls a model, and an unlimited model route is the second worst thing an
attacker could do (`03` §9) — deferring it means the first route that can spend the OpenAI budget ships
without the guard. Built once and shared, because a limiter re-implemented per route is a limiter with
a different bug per route. The mechanism is left open deliberately: platform rate-limiting offerings
change, and a document that asserts one from memory is a document that is wrong later (`CLAUDE.md`).

### [2026-09-19] The whole error catalogue's copy is written now, in one batch

**Decided:** `lib/api` grows from the single `unauthenticated` helper to the full `07` §2 envelope and
every `07` §3 code, and the **entire** catalogue's `ja` and `en` copy is written now — including
`cv_unchanged` — and goes through one native read (#13).
**Alternatives considered:** writing copy code by code as each endpoint lands.
**Reason:** the Japanese half is one native read either way, and a catalogue written in instalments
acquires a different voice in each instalment. `11` §3.10 already asserts the two lists match, so the
work fails loudly until it is done; doing it in one pass is the cheaper way to make it pass.

### [2026-09-19] The extraction model string is a pinned constant in code, not an env var

**Decided:** `OPENAI_API_KEY` joins `lib/config.ts` and `.env.example` and is added to the `develop`
branch's Preview scope. The **extractor model string** is a pinned constant in code — changing it is a
migration with a re-score and a boundary, not a deploy-time edit.
**Alternatives considered:** an `OPENAI_EXTRACTION_MODEL` env var, matching the three model strings
already in `12` §2.
**Reason:** a stamp that can be changed from a hosting dashboard is a stamp that can be changed without
a code review, and invariant 8 says changing it is a migration. **This is a live divergence from `12`
§2**, which treats `OPENAI_SCORING_MODEL`, `OPENAI_GENERATION_MODEL` and `OPENAI_TRANSCRIPTION_MODEL`
as environment variables. Reconciling those three is a bigger decision than this feature's docs ticket,
and moving them is a `12` §5 stamp-change procedure, so they are left alone and the tension is recorded
here rather than resolved quietly in a docs edit.

### [2026-09-19] `develop`'s CV is invented, and its claims are fixtures rather than a model call

**Decided:** the seed inserts one CV version per language about an invented person — Japanese: a
履歴書, a 職務経歴書 and one additional document; English: a CV document and one additional — with
**claims written directly as fixtures**, no model call, and **every seeded span run through the span
validator**. Idempotent, like the user seed.
**Alternatives considered:** seeding by calling the real extractor once and committing what came back;
a redacted version of the real CV; no CV on `develop` at all.
**Reason:** a seed that calls OpenAI costs money, needs a key in whatever runs it, and produces
different rows on every run — which makes `develop`'s data unreproducible and any test against it
unrepeatable. A redacted real CV is still the real CV and `12` §1 gives it exactly two homes, neither
of them a public repository. Running the fixtures through the validator is the point of the exercise:
a hand-typed span that does not slice back to its text fails the seed loudly instead of sitting on
`develop` as a wrong underline that looks like an extractor bug.

### [2026-09-19] The real-CV check runs locally; production is set up last

**Decided:** extraction on the real CV is checked **locally, against Docker Postgres** (#20), before
anything is scored against it. Production setup — `12` §3 steps 3–6 and 9–11, with `sslmode=verify-full`
— is the **last** ticket of this feature (#21). `develop` gets an invented CV in both languages, with
claims written as fixtures and every seeded span run through the validator (#19).
**Alternatives considered:** running the check on `develop`; setting production up first so the real CV
has somewhere to live.
**Reason:** `12` §1 and `11` §8 give the real CV exactly two homes, and a Neon branch that unfinished
code writes to is not one of them — that is the same rule that forbids branching Neon `develop` from
`main`. Setting production up first would create a database that must sit empty and correct for the
length of a feature; setting it up last means the real CV lands only once there is something correct
for it to land in.

---

## Phase 6 — the foundation slice, decided before it was built

Settled 2026-09-13/14 in the grilling for the foundation slice (spec #1, tickets #2–#7). Library and
platform facts were checked that day against npm, the vendors' docs and, where the docs were silent,
the library source.

### [2026-09-19] Remote Postgres URLs must say `sslmode=verify-full`, and config refuses anything else

**Decided:** both database URLs use `sslmode=verify-full`. `lib/config.ts` rejects a non-local
Postgres URL whose `sslmode` is anything else, or which sets `uselibpqcompat`; `localhost` and
`127.0.0.1` are exempt. `develop`'s two Vercel variables were changed by id (#10).
**Alternatives considered:** changing the URLs only; `uselibpqcompat=true` for libpq semantics now.
**Reason:** the installed `pg-connection-string` treats `require` as `verify-full` and warns that pg v9
will switch it to libpq's meaning, which encrypts but does not check the certificate. Dependabot
opens majors weekly, so the URL alone would downgrade TLS silently on one merged PR, and Neon's console
hands out `require` to whoever sets up production. Refusing it at boot turns both into a loud failure.
libpq semantics are the weaker mode. **Checked 2026-09-19:** both `develop` URLs connect over TLS 1.3
with the certificate verified (`authorized: true`) and no warning.

### [2026-09-19] Feature branches are not deployed

**Decided:** `vercel.json` sets `git.deploymentEnabled` to `{ "**": false, "main": true, "develop":
true }`. `12` §1 no longer says feature previews share Neon `develop`.
**Alternatives considered:** make Home's build independent of config by reading `headers()` before
`getAuth()`, so previews build; give general Preview `develop`'s config.
**Reason:** a feature preview holds no configuration, cannot sign in (its URL is not a redirect URI),
and its production build is already checked in CI, so deploying one produced only a failing check.
Building without config would have turned that into a green check on a deployment that refuses to boot.
Giving it `develop`'s config spreads those credentials to every branch for a URL that still cannot
sign in. Vercel's docs (checked 2026-09-19): a branch matching several rules deploys if any is `true`;
`**` is needed because branch names contain `/`. Home's build still needs config — revisit if a build
without it ever has a reason to exist.

### [2026-09-19] `next dev` does not write agent rules

**Decided:** `agentRules: false` in `next.config.ts`, plus one hand-written line in `CLAUDE.md`
pointing at `node_modules/next/dist/docs/`.
**Alternatives considered:** commit Next's managed block; turn it off with no pointer.
**Reason:** Next 16.3.5 writes `AGENTS.md` and a block in `CLAUDE.md` on every `next dev` it thinks an
agent started, which reverses "No `AGENTS.md`" (Phase 6) and dirtied the tree each run. The block's one
idea — read the docs for the installed version — survives as a line that never needs updating.

### [2026-09-19] Neon `develop` is a Schema only branch with a role `main` never has

**Decided:** `develop` was created as **Schema only** from `main`, then given its own role
`suburi_develop` and database `suburi` owned by it. Only that role appears in `develop`'s URLs.
**Alternatives considered:** an empty branch; a full branch of `main` while it is still empty; the
copied `neondb` database with its `neondb_owner` role.
**Reason:** Neon offers no empty branch (checked against its branching docs 2026-09-17). Schema only
copies no rows, but it copies `main`'s roles *with their passwords*, so `neondb_owner` on `develop`
would authenticate against `main` too. A role created on the child never exists on the parent.
Owning the database also lets migrations create tables in `public`. **Checked 2026-09-19:**
`suburi_develop` connects to `develop` over both URLs, and `main`'s host refuses it with `28P01`.

### [2026-09-19] Production is `suburi-murex.vercel.app`, and Neon lives in `aws-ap-southeast-1`

**Decided:** the production domain Vercel assigned on import, since `suburi.vercel.app` was taken.
`develop` got `suburi-develop.vercel.app` as planned. Google's three redirect URIs and `12` §1/§3
changed together, as `12` §3 step 2 required. The Neon project is in `aws-ap-southeast-1`.
**Alternatives considered:** a custom domain — not needed for one user, and not free.
**Reason:** the name was not available; the region was chosen at project creation, the docs having
named none. Both are recorded here because nothing else says why they are what they are.

### [2026-09-19] Vercel Deployment Protection stays on for Preview

**Decided:** keep Vercel's default Standard Protection. `suburi-develop.vercel.app` asks for a Vercel
login before the app's own Google sign-in.
**Alternatives considered:** turning it off so `develop` behaves like production.
**Reason:** `12` §1 already accepts that a discovered `develop` URL must open nothing; this makes it
show nothing at all. The cost is one extra login per browser. Testing the refused account in a
second browser therefore needs a Vercel login too — on 2026-09-19 GitHub's OAuth failed there, and the
test was run by deleting the `__Secure-better-auth` cookies in the already-authorised window instead.

### [2026-09-19] Both locks proven on the real Google flow; Google itself gates nothing

**Decided:** #7 is proven. On `develop`, the allowlisted account lands on the empty Home; a second
Google account is refused with the refusal line, and Vercel's log shows Better Auth's
`signup_disabled`. Local sign-in on `http://localhost:3000` works with the same client.
**Alternatives considered:** relying on the OAuth app's Testing status and test-user list.
**Reason:** Google exempts apps asking only for `openid`, `email` and `profile` from the test-user
limit, so any account reaches the callback. The locks in `08` §2 are the whole gate. The second
account has no user row, so it is refused by `disableSignUp`; the session hook's `auth_rejected`
path needs a user row with another email and stays covered by the integration test, not by a live
sign-in. node-postgres over the pooled URL showed no connection errors, so the WebSocket fallback
(2026-09-14) is not taken. Its only noise is `pg`'s deprecation warning for `sslmode=require`,
logged at error level.

### [2026-09-17] Seam 2 drives the real Google callback, with only the token exchange stubbed

**Decided:** `lib/auth/auth.integration.test.ts` mints state with `auth.api.signInSocial`, then sends
`GET /api/auth/callback/google` through `auth.handler`. Only `globalThis.fetch` is stubbed, for
`https://oauth2.googleapis.com/token`, returning an unsigned but decodable `id_token`. Any other
network call fails the test.
**Alternatives considered:** calling `handleOAuthUserInfo` directly; Playwright with the callback
intercepted, as #6 allowed.
**Reason:** calling `handleOAuthUserInfo` means the test passes `disableSignUp` itself, so it proves
nothing about the config. Playwright's `page.route` cannot see the token exchange, which is
server-side. Better Auth 1.7.4's Google `getUserInfo` only decodes the `id_token` on the callback
path, so an unsigned token is enough. **Checked by mutation, 2026-09-17:** with `disableSignUp`
off, the no-user test fails (the row gets created); with the hook's email check removed, the
other-email test fails. Each lock is proven on its own.

### [2026-09-17] `createAuth({ db, transaction })`, with tests binding a rolled-back transaction

**Decided:** `lib/auth/auth.ts` exports a factory. `lib/auth/index.ts` binds the app pool with
`transaction: true`. Tests bind drizzle over the client `inRolledBackTransaction` holds, with
`transaction: false`, so every auth write rolls back. That flag is the only difference from
production. The app's db and auth instances are created on first use, so importing them reads no
configuration.
**Alternatives considered:** a module-level `auth` singleton, with tests cleaning up after
themselves.
**Reason:** a singleton cannot be pointed at the test transaction. Cleanup by hand is how a test
database collects stray rows.

### [2026-09-17] The sign-in button is a Server Action, and `nextCookies()` is load-bearing

**Decided:** `/sign-in` stays a server component. #4's Button submits a `<form action>` whose Server
Action calls `auth.api.signInSocial({ body: { provider: "google", callbackURL: "/", errorCallbackURL:
"/sign-in" }, headers })` and then `redirect(url)`. `nextCookies()` is the only plugin, and it stays
last. No `better-auth/react`.
**Alternatives considered:** a plain HTML form posting to `/api/auth/sign-in/social`; the React
client.
**Reason:** `POST /sign-in/social` takes JSON only and answers 200 with a URL, not a 302, so a plain
form cannot use it. The client would add a bundle to a page that needs no client JS.
**Corrected at implementation:** the grill said state lives only in the `verifications` table, so
the action had no cookie to forward. That is wrong for 1.7.4. With database state storage,
`generateGenericState` also sets a signed `better-auth.state` cookie, and the callback refuses with
`state_security_mismatch` if it is missing. Without `nextCookies()` the flow starts and can never
finish. **Checked by mutation:** remove the plugin and the Playwright button test fails on the
missing cookie.

### [2026-09-17] Cookie attributes are set explicitly, not inferred from the URL's scheme

**Decided:** `advanced.defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" }`.
**Alternatives considered:** Better Auth's default, which sets `Secure` (and the `__Secure-` name
prefix) only when `BETTER_AUTH_URL` is `https`; `useSecureCookies: true`, which also forces the
prefix.
**Reason:** #6 asks for `Secure`, and the default would leave localhost and CI without it. Setting
only the attribute keeps unprefixed names on `http://localhost`, and `develop` and production still
get the prefix from their `https` URL. The proxy's `getSessionCookie` reads both names. **Measured
2026-09-17:** Chromium stores the `Secure` state cookie from `http://localhost:3100`, so local sign-in
is not broken by it.

### [2026-09-17] Refusals are logged in the session hook only, with a keyed hash

**Decided:** the hook logs `{"event":"auth_rejected","emailHash":…}` with `console.warn`, where the
hash is HMAC-SHA256 of the lowercased email keyed by `BETTER_AUTH_SECRET`. It then throws
`APIError("UNAUTHORIZED", { code: "account_refused" })`, which the callback turns into
`/sign-in?error=account_refused`.
**Alternatives considered:** a plain SHA-256; returning `false` from the hook; a log line on the
`disableSignUp` path too.
**Reason:** a plain hash of an email can be reversed by hashing guesses. A keyed one still lets the
owner check a known address. Returning `false` also redirects, but as
`error=unable_to_create_session`, which looks the same as a database fault. The thrown code names the
refusal. The `disableSignUp` refusal cannot carry a hash:
Better Auth refuses before any hook sees the profile, and logs only `signup_disabled`, with no email.
Both refusals land on `/sign-in` with `?error=`, and the page shows the same line for any error.

### [2026-09-17] Session re-checks go through `lib/auth/session.ts`

**Decided:** `requireSession()` for pages and Server Actions redirects to `/sign-in`.
`requireApiSession()` for route handlers returns the user id or the `401` envelope, and never
redirects. Both wrap `auth.api.getSession({ headers })` and return the `user_id` queries scope by.
`signInWithGoogle` is the one action without a check, because it only starts the flow.
**Reason:** `08` §5 treats the proxy as optimistic. A named helper per surface is easier to spot
when it is missing than an inline `getSession` call.

### [2026-09-17] The proxy matches everything and keeps its public list in code

**Decided:** `proxy.ts` matches every path except `_next/static`, `_next/image` and `favicon.ico`.
`/sign-in` and `/api/auth` (and anything under `/api/auth/`) are public, checked in code. Without a
session cookie, `/api/*` gets the `07` §2 `401` envelope and every other path redirects to
`/sign-in`. The envelope lives in `lib/api/errors.ts`.
**Alternatives considered:** a negative-lookahead matcher that also excludes the public routes.
**Reason:** a route added later is covered by default, which is the gap `08` §5 warns about. A
lookahead for `api/auth` would also exempt `/api/authors`. The unit test asserts it does not, and the
Playwright test hits an `/api/*` path that has no handler.

### [2026-09-17] Google's profile does not overwrite the seeded user's name

**Decided:** `overrideUserInfoOnSignIn` stays at its default, off. Account linking stays at its
default too.
**Reason:** this was left to #6 when `users.name` became not null. The seeded local part is enough for
a single user, and it keeps the user row the seed wrote.

### [2026-09-16] Both families are self-hosted by `next/font`, so §3's stacks name variables

**Decided:** `IBM Plex Sans JP` and `IBM Plex Mono` are loaded with `next/font/google`, downloaded at
build time and served from this origin. `--font-sans` and `--font-mono` keep §3's order and fallbacks
but begin with the loader's generated variable rather than the literal family name. `05` §10.1
amended.
**Alternatives considered:** a `fonts.googleapis.com` stylesheet link, which keeps the literal names
and needs no doc change; `@fontsource` packages, self-hosted with literal names.
**Reason:** the link tag is the only option that keeps the literal spelling, and it makes a private
app holding a CV call Google on every page load and adds two hosts to a later CSP. `@fontsource` is
self-hosted too, but adds two pinned dependencies and hand-listed weights to gain only that spelling.
Order and fallbacks are what §3 was protecting, and both survive the variable form intact.
**Why the variable rather than the literal name, having chosen `next/font`:** the variable resolves
to `"IBM Plex Sans JP", "IBM Plex Sans JP Fallback"` — Next generates a second, metric-adjusted
`@font-face` per family (`size-adjust`, `ascent-override`) whose only job is to hold the layout still
before the webfont arrives. Naming the family literally drops it. It is also the portable form: the
webpack build hashes the family name, and only the Turbopack build in 16.3.5 keeps it readable.
**Measured on the build, 2026-09-16:** 380 self-hosted `woff2` files for the two families, 379 of
them scoped by `unicode-range`; nothing is fetched that a page does not set.
**Found in passing:** Google publishes no `japanese` subset for Plex Sans JP, so `next/font` refuses
to preload it and the CJK slices are fetched on use. `preload: false` is required on that family, not
optional.

### [2026-09-16] The derived `--radius-*` scale is declared, not just `--radius: 0`

**Decided:** `--radius-sm`, `--radius-md`, `--radius-lg` and `--radius-xl` are declared from
`--radius` alongside it. `05` §10.2 amended.
**Alternatives considered:** `--radius: 0` alone, per `05` §10.2 as written; stripping the radius
utilities out of the vendored component instead.
**Reason:** found building #4 — the Base UI Button's classes are `rounded-lg` and
`rounded-[min(var(--radius-md),10px)]`, which read Tailwind's `--radius-*` scale, not `--radius`. The
`@theme` wipe covers `--color-*` and `--shadow-*` only, so that scale keeps Tailwind's defaults and
`rounded-lg` would compute to `0.5rem` with `--radius: 0` set and obeyed. Declaring the scale fixes
every vendored component at once, where editing classes fixes one.

### [2026-09-16] `components/ui/button.tsx` is restyled in place to `05` §5.7

**Decided:** the vendored Button's `default` and `outline` variants are edited to §5.7 — 48px tall,
square, 14px at `0.04em`, `--ink-1` solid and `1px solid --ink-1` outline — rather than corrected by
`className` at each call site.
**Alternatives considered:** leaving the registry file pristine and overriding per call site;
hand-building the sign-in button with no shadcn component at all.
**Reason:** `05` §10.3 already calls `components/ui/` vendored source to restyle in place, and §5.7
is a component specification, not a one-page exception — the registry's `h-8` default would otherwise
be re-overridden on every screen and §5.7 would live nowhere. Hand-building was rejected because
spec #1's user story 40 wants a vendored component proving the token mapping reached the components.
**Cost accepted:** re-adding `button` from the registry overwrites the file. Nothing upgrades it
automatically — vendored source is outside Dependabot's reach.

### [2026-09-16] `/sign-in`: one card, Japanese above English, one button

**Decided:** a single centred `05` card — wordmark `素振り` plus the `SUBURI` lockup (§5.1), one 48px
primary button whose label is Japanese with the English beneath it in §5.7's 12px `--ink-6` caption
slot, and a fixed-height refusal slot below it, Japanese over English. Draft copy uses **ログイン**:
`Googleでログイン` and `このアカウントではログインできません。`
**Alternatives considered:** English label with Japanese beneath; two side-by-side language columns;
`サインイン`, which matches Google's own branded button wording.
**Reason:** `10` §12 wants both languages on the page so it does not decide the open bilingual chrome
rule, and a single button carrying both labels shows both without making either the app's chrome
language — two columns would have had one column hold the button and the other only text. `ログイン`
is the more common everyday verb on Japanese sites.
**Not final:** these are the first three Japanese strings in the build. They go to a native read
before `develop` is called done, per `05` §6 and the ticket.
**Deliberately not decided here:** the refusal line is rendered but empty in #4 — what sets it is
#6's business. The bilingual chrome rule, the hover surface and the focus ring all stay open.

### [2026-09-15] No foreign key between application tables cascades or sets null

**Decided:** `scores.scoring_attempt_id`, `claim_citations.answer_id` and
`cv_claims.supersedes_claim_id` are `on delete restrict`. `04` amended.
**Alternatives considered:** keep `04`'s original cascade, cascade and set null as three exceptions to
§0; restrict the two cascades but keep lineage as set null.
**Reason:** found building #5 — `04` §0 and #5 said restrict everywhere except from `users`, while
`04`'s tables said otherwise. A cascade from an attempt to its scores, or from an answer to its
citations, is a deletion of measurement nobody wrote; set null on lineage silently severs the
coverage chain. Invariant 7 wants the delete refused, loudly.

### [2026-09-15] Enumerated text columns carry value check constraints

**Decided:** every enumerated `text` column in `04` gets a check constraint listing its values, named
`<table>_<column>_check`; `11` §3.1 gains an "Enumerated values" test. `scores.dimension` is excluded.
**Alternatives considered:** only the constraints `04` already named, with a follow-up issue; Postgres
enum types.
**Reason:** found building #5. A row with `language = 'jp'` was accepted and would split one
first-attempt series into two without any error. Text plus a check keeps `04`'s typing and makes a new
value a constraint swap rather than an `ALTER TYPE`. `scores.dimension`'s valid set depends on the
rubric row, which a column check cannot see.

### [2026-09-15] users.name is not null, seeded from the email's local part

**Decided:** `users.name text not null`; the seed writes the local part of `ALLOWED_EMAIL`. `users`
also gains Better Auth's `image` and `updated_at`. `04` amended.
**Alternatives considered:** nullable per `04`'s original row (Better Auth's `User` type says string,
so #6 would carry a null it is not typed for); not null with an empty string (a placeholder that
means nothing).
**Reason:** Better Auth 1.7.4 declares `name` required (`@better-auth/core` `db/get-tables`), and with
sign-up disabled it never writes the row itself. The local part adds nothing to the repository or the
environment. Whether Google's profile name overwrites it on sign-in is #6's call.

### [2026-09-15] TypeScript falls back to 6.0.3

**Decided:** `typescript` 6.0.3, the fallback #1 named. `03` §1 amended.
**Alternatives considered:** keep 7.0.2 and lint without `typescript-eslint`.
**Reason:** found building #3. 7.0.2 passes `tsc --noEmit` on the scaffold, but `typescript-eslint`
8.70.0, latest and canary alike, throws "does not support TS 7.0" on load; its peer range is
`<6.1.0`. Linting without it leaves ESLint unable to parse `.ts` and `.tsx`, which empties the lint
step. Revisit when `typescript-eslint` supports 7 (typescript-eslint#10940).

### [2026-09-15] ESLint 10 with a hand-assembled config, not `eslint-config-next`

**Decided:** `eslint` 10.10.0 with a flat config built from `@next/eslint-plugin-next` (recommended
and core-web-vitals), `eslint-plugin-react-hooks` and `typescript-eslint`. `eslint-config-next` is not
installed. The config also forbids `process.env` outside `lib/config.ts`. `03` §1 amended.
**Alternatives considered:** `eslint` 9.39.5 with `eslint-config-next`; `eslint` 10 with
`eslint-config-next` forced in by `--legacy-peer-deps`.
**Reason:** found building #3. `eslint-config-next` 16.3.5 depends on `eslint-plugin-react`, `-import`
and `-jsx-a11y`, whose peer ranges stop at ESLint 9, and `eslint-plugin-react` crashes on 10.10.0
(eslint-plugin-react#3977, open). ESLint 9 reached end-of-life on 2026-08-06, so pinning it breaks the
version floor rule. Forcing the install still crashes at lint time. The cost is the react, import and
jsx-a11y rules; return to `eslint-config-next` when its plugins support 10.

### [2026-09-14] The slice stops at `develop`

**Decided:** the foundation slice ends with `develop` deployed on a stable Vercel subdomain and a real
Google sign-in there. Production and Neon `main` are not touched.
**Alternatives considered:** local only; everything through production.
**Reason:** `develop` is where `12` §1 says real behaviour is verified, and it is the only way to close
`12` §3's env-scoping question. Seeding production before anything is measured creates the
irreplaceable record early for no gain, and `12` §8's restore drill belongs to a production deploy that
holds something.

### [2026-09-14] The user row is seeded by script, not by migration

**Decided:** a hand-run seed script reads `ALLOWED_EMAIL` and inserts the single `users` row with
`email_verified = true`, idempotently. `03` §2, `04` §2, `08` §2 and `12` §3 amended.
**Alternatives considered:** the email literally in a migration, as the docs said; no seed, letting
the first sign-in create the row behind the `ALLOWED_EMAIL` check alone.
**Reason:** migrations are committed files and the repository is public, so a migration would publish
the email forever. Dropping the seed would mean turning `disableSignUp` off and leaving one lock where
`08` deliberately has two. `email_verified = true` is not incidental: Better Auth 1.7.4 links a first
Google sign-in to an existing user only when that user is verified (read in its source).

### [2026-09-14] Sessions last 30 days, refreshed daily

**Decided:** `expiresIn` 30 days, `updateAge` 1 day. Closes `08` §3's TBD.
**Alternatives considered:** Better Auth's defaults, 7 days and 1 day.
**Reason:** `08`'s target was ~30 days rolling. Seven days signs the user out across a gap between
practice weeks, which is the interruption `08` §3 exists to avoid; the threat model in `03` §9 gains
nothing from the shorter window.

### [2026-09-14] node-postgres everywhere

**Decided:** the `pg` driver locally, in CI and on Vercel, over Neon's pooled URL.
**Alternatives considered:** Neon's HTTP driver; Neon's WebSocket driver deployed with `pg` in tests.
**Reason:** Drizzle's Neon HTTP driver throws on `db.transaction()` (read in its source), and `11` §2's
integration tests and `07`'s submit path both need transactions. Using the same driver in tests and in
production keeps the invariant tests proving what production runs. This is a judgement, not a
documented recommendation for Vercel Node functions.
**Fallback:** Neon's WebSocket driver if `pg` shows connection churn on `develop`. Taking it is a new
entry here.

### [2026-09-14] Drizzle stable, not the 1.0 RC

**Decided:** `drizzle-orm` 0.45.2 and `drizzle-kit` 0.31.10.
**Alternatives considered:** the 1.0 RC, which Drizzle's own Neon and schema docs now describe.
**Reason:** `db/schema.ts` holds the measurement record and its migrations are manual and expand-only.
That is the wrong place to absorb pre-release breaking changes. Moving to 1.0 is its own deliberate
upgrade, with its own entry. Docs written for the RC API are not a guide to 0.45.2.

### [2026-09-14] TypeScript 7, with a fallback

**Decided:** `typescript` 7.0.2, the native compiler.
**Alternatives considered:** 6.0.3, the last JavaScript-based line.
**Reason:** it is the current stable release. Whether Next, Drizzle and Better Auth's types are clean
under it was not verified in advance, so the scaffold is the test.
**Fallback:** 6.0.3 if `tsc --noEmit` does not pass on the scaffold. Taking it is a new entry here,
naming what failed.

### [2026-09-14] Postgres 18

**Decided:** Postgres 18 on Neon, `pgvector/pgvector:pg18` locally and in CI. Every `pg17` in
`CLAUDE.md`, `CONTEXT.md`, `03`, `04`, `11` and `12` replaced.
**Alternatives considered:** staying on 17, as Phase 4 wrote.
**Reason:** 18 is the newest supported major (18.6, supported to November 2030). Neon runs it and ships
`pgvector` 0.8.6 on it against 0.8.0 on 17, and the near-duplicate guard (`03` §11) rests on pgvector.
Nothing had been provisioned, so switching cost nothing; after real data lands on Neon `main` it
would be a major-version migration.

### [2026-09-14] Versions are at least the newest LTS, checked live

**Decided:** every runtime, framework, database and library is chosen at the newest LTS or newest
supported line, verified against the registry and the vendor's support policy when chosen, and pinned
exactly. The pins are in `03` §1.
**Alternatives considered:** always the absolute latest; carrying versions forward from planning notes.
**Reason:** the user's rule. A re-check on 2026-09-14 found Postgres still pinned at 17 from Phase 4
when 18 was current — exactly what carrying a version forward without checking produces. The latest is
not required: Node stays on 24 because 26 is not yet LTS and Vercel does not offer it.

### [2026-09-14] Smaller calls, recorded together

- **Sign-in page in both languages.** `/sign-in` has no artboard (`10` §12) and no round, so it cannot
  follow a round's language. Showing both avoids deciding the open bilingual chrome rule by accident.
- **No `AGENTS.md`.** `create-next-app` writes one by default; it is removed. `CLAUDE.md` and
  `CONTEXT.md` are the agent docs, and a third would drift.
- **React Compiler off.** Nothing here needs it, and its cost with Turbopack was not checked.
- **Three Google redirect URIs.** `localhost`, `develop`'s stable URL and production. `12` §1 has local
  development signing in with the same allowlist, which the earlier two-URI list missed.
- **Client caches named as rejected.** `03` §7 now names TanStack Query, TanStack Router and Zustand,
  so a ticket cannot add one on the grounds that nothing forbade it by name.

---
## Phase 5d — styling, components, and the framework's real reason

Settled on 2026-09-13, before the foundation slice, because the foundation slice is where each would
otherwise have been decided silently. Library facts checked against the official docs that day:
`tailwindcss` 4.3.3, `shadcn` CLI 4.21.0, `@base-ui/react` 1.8.0 were the published versions. They are
a record of what was current, not pins — pins are set at install.

### [2026-09-13] Tailwind CSS v4, CSS-first, with `05` as the only palette

**Decided:** Tailwind v4 via `@tailwindcss/postcss`, tokens in `@theme`, and `--color-*: initial` and
`--shadow-*: initial` so the default palette and shadow scale do not exist.
**Alternatives considered:** plain CSS custom properties; CSS Modules.
**Reason:** the user's call, and it strengthens `05` rather than diluting it. `05` §2 says no other hue
appears anywhere; with the palette wiped, a stray hue fails to generate instead of waiting for review.
That is the project's standing preference — enforced, not merely stated — and it makes
`app/globals.css` `05` in code, the same relationship `db/schema.ts` has with `04`.

### [2026-09-13] shadcn/ui, on Base UI

**Decided:** shadcn/ui, initialised with `-b base`. Components are added when a screen needs them.
**Alternatives considered:** no component library; two unstyled primitives (tooltip, radio group)
without shadcn; shadcn on Radix.
**Reason:** the user's call, made over a recommendation against it. The recommendation rested on an
inventory: across the nine screens there are no dialogs, drawers, toasts, popovers, selects, checkboxes
or sliders — one tooltip, two rows of options, three button variants — and the six marks that make up
the app (`05` §5) exist in no library. The user preferred to have the setup and conventions in place
from the start. **Base UI over Radix:** it is shadcn's default since its July 2026 changelog, made by
the teams behind Radix, Floating UI and Material UI, and new shadcn components ship for both libraries
only "unless a component is exclusive to Base UI" — so Radix is the side that falls behind.
**Cost accepted:** a second token vocabulary in the codebase. Contained by `05` §10: shadcn's variables
alias `05`'s, and code outside `components/ui/` uses `05` names only.
**Guard:** no shadcn `Progress`, `Slider` or chart component ever displays a score (invariant 1).

### [2026-09-13] `05` tokens stay the source; the accent family is renamed `--mark` in code

**Decided:** shadcn's semantic variables point at `05` tokens (`05` §10.2). `--radius: 0`, no `.dark`
block. `05`'s `--accent` family is `--mark`, `--mark-mid`, `--mark-faint`, `--mark-pale` in code.
**Alternatives considered:** adopting shadcn's semantic tokens and mapping `05` onto them; renaming
shadcn's `--accent` inside vendored components instead.
**Reason:** `05` measured six rule weights it refuses to collapse and nine ink levels; shadcn has one
`--border` and two foreground levels, so adopting its vocabulary would quietly undo Phase 3. The rename
goes on our side because shadcn's `--accent` is the hover surface in every component it will ever
vendor — renaming theirs means re-editing each component on every add.
**Left open:** the hover surface and the focus ring are aliased to placeholders. Neither is drawn, and
`05` §7 makes keyboard focus required (`05` §9).

### [2026-09-13] The framework rejection had the wrong reason

**Decided:** Next.js stands. `03` §1's reason is replaced.
**What was wrong:** `03` rejected Remix and SvelteKit for "a thinner ecosystem for the auth and ORM
choices." Checked against the Better Auth docs, that is false — it ships a SvelteKit handler and a Nuxt
integration — and Drizzle has no framework coupling. Nuxt had never been considered.
**The real reason:** `07` §1 makes reads Server Components, so the feedback screen is a Postgres read
with no loading state, which is what makes invariant 2 structural. SvelteKit and Nuxt have excellent
SSR but not RSC; either would turn that screen back into a client fetch. The user raised both out of
curiosity and agreed to keep Next.js for this project.

### [2026-09-13] Still no `.mcp.json` — the shadcn MCP server is not wired

**Decided:** the Phase 5 decision stands.
**Alternatives considered:** adding shadcn's MCP server via `.mcp.json`.
**Reason:** context7 already resolves the shadcn, Base UI and Tailwind docs above project scope, which is
the same reasoning that kept Neon and context7 out of `.mcp.json`.
**Revisit if:** registry lookups become frequent once components are being added.

---
## Phase 5c — the four pre-build verifications

All four closed on 2026-09-12 against primary sources, before any implementation ticket was written.
Each had been left as a TBD precisely so a ticket could not decide it silently.

### [2026-09-12] Speech-to-text is `gpt-transcribe` at $0.0045/minute

**Decided:** `OPENAI_TRANSCRIPTION_MODEL` is `gpt-transcribe`. `03` §4's TBD and `07` §5.7's
placeholder are both replaced with the real string.
**Alternatives considered:** `gpt-4o-transcribe` ($0.006/min), `gpt-4o-mini-transcribe` ($0.003/min),
Whisper ($0.006/min).
**Reason:** it is newer *and* cheaper than `gpt-4o-transcribe`, and it is the only one of the four
that accepts keyword hints and multiple language hints. That is not a generic nicety here — a Japanese
answer about a Japanese employer, mixing 敬語 with English technical terms, is exactly the
domain-term-plus-code-switching case those hints exist for. Cost was not the deciding factor: at ~24
minutes of audio a round it is ~$0.11, a quarter of the model bill and still not a constraint.
**Two things carried rather than buried.** It requires **API Tier 1 or above** — the Free tier does
not serve it, which is a deployment precondition, not a runtime error to discover later. And its only
published snapshot is also called `gpt-transcribe`, so **the "never point at an alias" rule in `03` §4
cannot be satisfied here** the way it is for scoring. That is acceptable only because transcription is
not the instrument: invariant 8 governs the *scoring* model, and `transcriber_model_id` is stamped on
the answer row, so a silent repoint surfaces as a change in the stamp rather than as drift in a chart.

### [2026-09-12] The scoring trigger moves into `submit`, via `after()`

**Decided:** `submit` schedules scoring with Next.js `after()`. `POST /api/scoring-attempts/{id}/run`
stays, demoted to the History retry path.
**Alternatives considered:** keeping the client-initiated, un-awaited `fetch` that `07` §5.10 shipped
as the working default.
**Reason:** `07` §5.10 set its own condition — move it if `after()` reliably completes ~60s of
post-response work inside a Hobby function's ceiling. It does. Next.js documents `after` as running for
the route's configured max duration, implemented on serverless through Vercel's `waitUntil`, which
extends the invocation until the scheduled promises settle; Hobby Node.js functions are 300s default
and 300s maximum. Sixty seconds fits. `after` also runs when the response failed, redirected or 404'd,
so an attempt is dispatched even on a submit that errored after writing the row — which is what this
design wants, since the row exists and `run` is idempotent.
**The trap this closes.** The 300s is the **whole invocation**, not a post-response allowance: request
handling, response, and `after` share one budget, and §5.10's three exponential-backoff retries now
live inside it. A ticket sizing that backoff against a fresh 300s would build a path that silently
runs the ceiling down and leaves a `pending` row. Hobby also cannot raise `maxDuration`, so there is no
escape hatch to reach for later — the next move would be a plan change, deliberately made.

### [2026-09-12] Vercel Hobby cron is daily-only; the `pending` threshold becomes 24 hours

**Decided:** `12` §6's one-hour threshold is now 24 hours. `self-check` (daily) and `digest` (weekly)
remain two separate routes.
**Reason:** verified — 100 cron jobs per project, minimum interval once per day, per-hour precision
(±59 min), and a more frequent expression **fails the deployment** rather than degrading. The
threshold change was pre-decided in `12` §6 and is recorded here only as the outcome. A delayed
discovery is not a lost row, and it is not worth a vendor or a plan to shorten.
**One worry reversed.** `12` §6 assumed daily-only might force a single job to do both. It does not:
the limit is a *floor* on the interval, so a weekly digest is legal precisely because weekly is less
frequent than daily. The section said the wrong thing and now says the right one.

### [2026-09-12] The `pg_dump` moves from weekly to daily

**Decided:** the dump runs daily, from the `self-check` cron route, not weekly from `digest`.
**Alternatives considered:** keeping it weekly and recording the 6-hour window as accepted; dumping
after every round; upgrading Neon to Launch for a 7-day window.
**Reason:** Neon Free keeps **6 hours of history, and 6 is also the maximum** — it is a ceiling, not a
raisable default. `12` §8 was right to make the dump independent of that answer, but the combination it
left standing was a worst case of about **seven days of rounds**: a bad write on a Sunday, found on
Monday, is past the window and behind the last dump. This project's premise is that the accumulated
measurement is the only unrecoverable thing in it, so a week-wide hole is the failure the backup exists
to prevent, not a limitation to note. Daily closes the worst case to ~24 hours, inside which the
6-hour window covers the recent tail, at the cost of one small S3 object a day.
**Why not the other two.** The Launch plan buys a 7-day window the daily dump already covers, for
money, on a project otherwise entirely on free tiers. A per-round dump would put a backup write on a
user-facing path and give it a failure mode there — to protect against losing a single round, in a
system whose §6 monitoring already assumes the keyboard tells you when something is broken *now*.
**Unchanged and still the weakest link:** the restore is untested. `11` §9 and `12` §8 both say so, and
a daily dump does not make an untested restore any less of a hope.

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

> **Superseded in part, 2026-09-20:** `superpowers` was uninstalled machine-wide and its key removed
> from `.claude/settings.json`. The reasoning below stands as the record of why it was never enabled
> here; there is no longer a plugin for the entry to point at. `frontend-design` is unchanged.

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
