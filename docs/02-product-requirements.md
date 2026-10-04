# Product requirements — Suburi

**Date:** 2026-09-12
**Status:** Phase 1 complete. **Amended 2026-09-27** by the round-loop decisions (`06`, "Phase 6 — the
round loop"): §2, §3, US-2, US-4, US-5, US-7, US-8, US-11, US-13 and §7.
**Upstream:** `01-project-brief.md`. Decisions and their reasoning: `06-decision-log.md`.

No technical decisions appear here. Stack, storage, speech engine and model choices belong to
Phase 4.

---

## 1. Users

**One user type: the author.** No roles, no sharing, no administration. Exactly one person can sign
in, and no second account can be created.

**Amended 2026-09-12 (Phase 4).** This section previously read "single-user is a design constraint,
not a v1 simplification — nothing in this document should be built in a way that anticipates a second
user." That is now half true, and the half that changed matters:

- **The door still admits one person.** Google is the only sign-in method, against a hardcoded
  allowlist, with signup disabled. There is no invite flow, no role, no administration.
- **The data model anticipates many.** Every table carries `user_id` so that a future multi-user
  product is a migration rather than a rewrite.

These are separate decisions and must stay separate. **Multi-tenancy is not permission to build a
sharing surface** — §8 item 3 and §9's privacy requirement are unchanged and still bind every screen.
See `06-decision-log.md` and `08-auth-and-permissions.md`.

---

## 2. Definitions

These terms are used precisely throughout.

| Term | Meaning |
| --- | --- |
| **Round** | One sitting. Exactly one round type, one language, one mode, one length. The unit of practice and the unit of history. |
| **Round type** | Behavioural, Technical, HR, or CEO/final. |
| **Mode** | **Practice** (edit freely, retry, per-answer feedback once each answer is scored) or **Realistic** (one take, timed, feedback held to round end). |
| **Question** | A bank entry with a permanent ID. Either a **set piece** (hand-authored, fixed, belonging to one round type) or **generated** (created from CV + role context, then written into the bank on first use). |
| **Follow-up** | A question generated from what the user just said. Not a bank entry, has no stable identity, and never appears in progress data. |
| **First attempt** | A realistic-mode answer to a question ID, in a language, when **no earlier answer to it in that language exists in either mode**. A question practised first never has one. Never overwritten. The only data the progress screen plots. |
| **Role context** | Defined in `CONTEXT.md`; US-2 below sets the product requirements. |

---

## 3. The core loop

One round = one round type × one language × one mode × one length, chosen at the start.

1. The app asks question *n*. Every question in the round was **chosen when the round started**, so a
   reload never swaps one. Realistic mode **speaks it and leaves the text on screen**; practice mode
   displays it silently.
2. The user speaks an answer. Realistic mode is one take, under a per-answer timer.
3. Speech-to-text produces a raw transcript.
4. The user **corrects the transcript inline**. Raw and corrected are both kept; the diff is data.
5. The user submits. A **follow-up** is generated from the corrected answer and asked.
6. The user answers the follow-up through the same steps 2–5, without a further follow-up.
7. Repeat for all *n* questions.
8. Realistic mode only: the user gives a **felt-pressure rating 1–5** before any feedback appears.
9. Round-end feedback renders: per-dimension scores, two or three things to fix, one thing that
   worked.

Practice mode differs at steps 1 (text only), 2 (retry allowed, no timer) and 8 (no pressure
rating). It also shows **each answer's scores as soon as that answer is scored**, and still ends with
step 9's round feedback. *Amended 2026-09-27:* this read "feedback is immediate per answer" — scoring
takes tens of seconds, so "immediate" meant "once scored" (`06`).

---

## 4. The rubric

Two rubrics sharing most dimensions. Every dimension is an **integer 1–5**. There is **no composite
score** — not computed, not stored, not displayed, ever.

| Dimension | English | Japanese |
| --- | --- | --- |
| Structure | ✓ | ✓ |
| Evidence | ✓ | ✓ |
| Relevance | ✓ | ✓ |
| Fluency | ✓ | ✓ |
| Accuracy | ✓ | ✓ |
| Length and pacing | ✓ | ✓ |
| 敬語 (register) | — | ✓ |

Fluency and accuracy are separate dimensions, not one language score — see the decision log.

**Feedback language.** A Japanese round's feedback is written in Japanese, with a toggle to view it
in English. An English round's feedback is in English. Rubric dimension names follow the feedback
language.

---

## 5. User stories

Each story is `MUST`, `SHOULD` or `LATER`.

`MUST` means the story is in v1. **Round-one gate** marks the subset that must work before the first
realistic round can be run — everything else in v1 may land during the 30-day window.

### Setup

**US-1 — Upload a CV** `MUST` · **round-one gate**
> As the user, I want to upload my CV once, so that my answers are evaluated against my real history.

*Acceptance:*
- The CV is uploaded once and persists across rounds.
- It is parsed into individually addressable units (roles, projects, claims, numbers) that evaluation
  can cite — not stored as an opaque blob.
- Re-uploading creates a **new version**; prior versions are retained.
- Every scored answer records which CV version it was scored against.

**US-2 — Give the round a role context** `MUST` · **round-one gate**
> As the user, I want to point the app at a specific company and role, so that questions and
> relevance scoring are about the job I am actually applying for.

*Acceptance:*
- A role context is one of: a pasted or browser-imported posting, AI research (US-16), or **General
  practice**. **Round one needs only the posting and General practice**; AI research lands with US-16
  (amended 2026-09-27 — this cited a nonexistent "US-17", and research is not a round-one gate).
- A saved role context is kept and can be picked again for later rounds. It is never edited; a changed
  posting is a new one. There is one General practice, not one per round.
- When an imported posting and researched context both exist, **the posting wins** and the app says so.
- A round cannot start without one selected; the selection is stored with the round.
- **General practice** is a first-class choice, not a fallback, and rounds run under it are grouped
  separately in progress data.

### Running a round

**US-3 — Start a round** `MUST` · **round-one gate**
> As the user, I want to choose round type, language, mode and length, so that a sitting fits the
> time I have and the thing I need to practise.

*Acceptance:*
- Four choices required before start: round type (Behavioural / Technical / HR / CEO), language
  (Japanese / English), mode (Practice / Realistic), length (**3 / 5 / 7** questions).
- Defaults are pre-selected from what spacing says is due (US-14); every default is overridable.
- All four choices, plus the role context, are stored with the round.

**US-4 — Be asked a question** `MUST` · **round-one gate**
> As the user, I want questions that are real for this round type and this role, so that the rep is
> worth taking.

*Acceptance:*
- Questions come from the bank. **Set pieces** (自己紹介, 志望動機, 転職理由, 自己PR and their English
  counterparts) are hand-authored, fixed, and never regenerated. **Each belongs to exactly one round
  type:** 自己紹介, 自己PR and 転職理由 to HR; 志望動機 to CEO/final. Set pieces carry a content version,
  so a reworded one draws a boundary like a new generator prompt does.
- **Generated** questions are written into the bank on first use with a permanent ID and, set at
  creation and never changed: round type, language and **generator prompt version**.
- A round asks **at most one unseen set piece** of its type, then generated questions, **unseen
  first**. Practice rounds prefer questions already answered, so the unseen pool is not spent in
  practice.
- A near-duplicate of an existing bank question maps to the existing ID rather than creating a new
  one.
- No question repeats within a round.
- *Amended 2026-09-27:* **逆質問 is no longer a scored set piece** — the candidate asking the questions
  does not fit answer-then-score — and **the declared difficulty tier is struck**: nothing read it, and
  generator drift is already visible through the generator prompt version (`06`).
- Realistic mode speaks the question aloud and leaves the text visible; practice mode is text only.

**US-5 — Answer by voice** `MUST` · **round-one gate**
> As the user, I want to speak my answer, so that I am practising saying it rather than writing it.

*Acceptance:*
- Record / stop, then a raw transcript appears.
- **Answer duration and words-per-minute are computed and stored** for every spoken answer.
- The **audio is stored** and replayable from history.
- Realistic mode is one take, under a per-answer timer. Practice mode allows two retries: a **re-take**
  before the transcript, which replaces the take, and **answering again** after seeing the feedback,
  which is a new answer beside the first and gets no follow-up of its own.

**US-6 — Correct the transcript before submitting** `MUST` · **round-one gate**
> As the user, I want to fix what the recognizer got wrong, so that I am graded on what I said rather
> than on its mistakes.

*Acceptance:*
- One inline editable field, pre-filled with the raw transcript.
- **Raw and corrected text are both stored permanently**, and the diff is computed and stored.
- In realistic mode, a **rewrite-magnitude figure is shown before submit** and stored with the
  answer. It does not block submission and nothing adjudicates "error" versus "rewrite."
- Practice mode allows unrestricted editing; the diff is still stored.

**US-7 — Be dug into once per answer** `MUST`
> As the user, I want one follow-up generated from what I actually said, so that I practise the part
> where candidates come apart.

*Acceptance:*
- Exactly one follow-up per submitted answer, in **both modes**, generated from the corrected text.
- The follow-up answer goes through record → transcript → correct → submit, and does **not** generate
  a further follow-up.
- A follow-up is stored linked to its parent answer, with its text and the version of what generated
  it, is scored, and is **excluded from progress data** — it has no stable question identity, so it
  cannot be a first attempt.
- If generation fails, the round continues and the missing follow-up is recorded as missing, visibly.

**US-8 — Not be graded mid-round** `MUST` · **round-one gate**
> As the user, I want realistic mode to stay silent until the round ends, so that I am not trained to
> expect a coach in the room.

*Acceptance:*
- Realistic mode shows no score, no flag and no hint of evaluation until the round ends.
- Practice mode shows per-answer feedback as soon as each answer is scored, and round feedback at the
  end.

**US-9 — Record felt pressure** `MUST` · **round-one gate**
> As the user, I want to rate the pressure I felt before I see any feedback, so that the project's
> riskiest assumption is actually tested.

*Acceptance:*
- After the last answer of a **realistic** round and **before any feedback renders**, a required 1–5
  rating.
- Once per round. Never per answer.
- Stored with the round. **Never appears on the progress screen** and is never framed as something to
  improve.

### Feedback

**US-10 — Round-end feedback** `MUST` · **round-one gate**
> As the user, I want scores on fixed dimensions plus a few concrete pointers, so that round three's
> advice is comparable to round one's.

*Acceptance:*
- Per-dimension integer scores 1–5 for every answer, on the rubric for that language (§4).
- Round level: **two or three things to fix, and one thing that worked.**
- **No composite or overall score anywhere.**
- Every scored answer stores the **rubric version** and the model/prompt version used.
- Feedback renders **while the user is still at the machine**. Evaluation that lands later is a
  defect.
- Japanese rounds get Japanese feedback with an English toggle.

**US-11 — CV-grounded flags, both directions** `MUST` · **round-one gate**
> As the user, I want to see claims my CV does not support and CV material I never used, so that I
> stop leaving my strongest material on the table.

*Acceptance:*
- **Unsupported claims:** flagged at answer level, citing the span of the **corrected** answer and the
  absence in the CV. The quoted span is taken from the stored answer, never reworded. Framed as a gap
  a real interviewer would notice, not an accusation.
- **Untouched material:** flagged at round level: **two or three relevant** CV units never referenced,
  chosen from everything the round left uncited — not a list of all of them.
- Both cite the CV version used.

### History and progress

**US-12 — Review any past round** `MUST`
> As the user, I want to open a round from three months ago and see exactly what happened.

*Acceptance:*
- A stored round contains: round type, language, mode, length, role context, every question with its
  ID, raw transcript, corrected text, diff and rewrite magnitude, audio, duration, WPM, per-dimension
  scores, pointers, follow-ups, felt-pressure rating, and all version stamps.
- Nothing in history is editable after the round ends.

**US-13 — See per-dimension progress** `MUST`
> As the user, I want per-dimension trends on first attempts at questions I had not seen, per
> language, so that the number is honest.

*Acceptance:*
- Plots **realistic-mode first attempts only**. Practice rounds, repeat attempts, questions already
  answered in practice, follow-ups, answers in the wrong language and abandoned rounds are excluded.
- One line per rubric dimension, **split by language**, and plotted **within round type**.
- A change in **generator prompt version or rubric version draws a visible marker** on the chart.
- **No composite score.**
- The screen states the first-attempt count per language against the ≥30 target.

**US-14 — Know what is due** `MUST`
> As the user, I want the app to tell me what I have not practised lately, so that I do not do six
> rounds in a weekend and then nothing.

*Acceptance:*
- Tracks when each (round type × language) pair was last practised in realistic mode.
- The home screen surfaces what is due, most overdue first.
- It is a suggestion. It never blocks starting any round.

### Committed v1 scope, not gating round one

**US-15 — Story bank** `MUST` *(lands during the 30-day window)*
> As the user, I want my recurring stories extracted once, so that I can see which I overuse and
> which I never touch.

*Acceptance:*
- Stories are extracted from the CV into a persistent, editable list.
- Round feedback reports which stories were used, which are overused across recent rounds, and which
  have never been used.
- Depends on US-1's parsed CV units.

**US-16 — AI researches the company and role** `MUST` *(lands during the 30-day window)*
> As the user, I want the app to research a company when I have not given it a file, so that I can
> start a round without preparing input first.

*Acceptance:*
- Runs **only** when no posting exists for that role context. A saved posting always wins.
- The researched context is shown to the user and is **editable before the round starts**.
- Its provenance is stored with the round, so rounds run on researched context are distinguishable
  from rounds run on a real posting.

### Later

| Story | Why deferred |
| --- | --- |
| A full four-round run in one sitting | IDEA.md §3 already calls it a later feature. Not shaped into v1's model. |
| Interleaving round types within a session | Contextual-interference benefits are contested in field settings. |
| Mobile or responsive use of any kind | §7. |
| Scorer-drift detection by re-scoring held-out past answers | Named in the brief as a Phase 4 technical risk with a known mitigation. |
| More than one follow-up per answer | Unvalidated; one is the tested unit. |

---

## 6. Empty states

Empty states are requirements.

| State | Behaviour |
| --- | --- |
| **No CV uploaded** | Starting a round is blocked. One screen, one action: upload a CV. The app does not offer a degraded round without one — CV-grounded evaluation is a reason the project exists. |
| **No role context for this round** | Setup presents posting and **General practice** as equal choices; AI research adds a third with US-16. General practice never silently defaults. |
| **No rounds completed yet** | The progress screen shows the dimensions it will plot, in both languages, and states the count needed (≥30 first attempts per language). Not a blank chart. |
| **Too few first attempts to trend** | Points are shown but no trend line is drawn below **5 first attempts** for that dimension × language × round type. The screen says how many remain. |
| **Bank exhausted for a round type × language** | Setup says new questions will be written when the round starts and warns that repeats will not appear in progress data. |
| **Story bank not yet extracted** | Feedback omits the story section entirely rather than showing an empty one. |
| **A round with no scores yet** (scoring failed or pending) | Shown in history marked unscored, with a retry. Excluded from progress until scored. |

---

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| **Duplicate submit** | Submitting an answer is idempotent. One stored answer per question per round, whatever the client does. |
| **Mic permission denied, or recording fails** | The round pauses. No partial answer is stored and **the question is not consumed** — it remains unseen. Nothing is recorded against a question until a take exists. |
| **Transcript comes back empty or unusable** | The user may type the answer. It is stored flagged as *typed, not spoken*, excluded from duration/WPM, and **excluded from progress data** — it is not a voice rep. |
| **Realistic timer expires mid-answer** | The take ends. Whatever was captured is transcribed, correction is still allowed, and the answer counts normally. |
| **Very long answer** | A hard recording cap per answer in both modes. Hitting the cap ends the take like the timer does. |
| **Round abandoned part-way** | Stored as abandoned with its answers intact and reviewable. **Excluded from progress data entirely** — a partial round has no pressure rating and is not comparable. A question it answered is **seen for good**. A round is abandoned when a newer round is started, or when the day it was started has passed (the user's local day, Asia/Tokyo); only the newest open round can be resumed, and only that day. |
| **Scoring call fails after the round** | Answers are never lost. The round is stored unscored, the user is told, and scoring is retryable. *Amended 2026-09-28:* when one answer's scoring has failed for good at the round's end, round feedback is written without it, the answer shows as unscored, and it can be retried on its own. |
| **Question cannot be spoken** (realistic mode) | The round goes on with the question as text, and a short notice says it could not be read aloud. |
| **Saving fails mid-round** | The user is told plainly; nothing is half-saved, and the round can be resumed. |
| **Follow-up generation fails** | The round continues. The gap is recorded as a missing follow-up rather than silently skipped. |
| **CV re-uploaded mid-history** | New version. Old answers keep their original version reference; the progress screen marks the change like a rubric version change. |
| **Near-duplicate question generated** | Deduplicated against the bank before insertion; maps to the existing ID. Prevents inflating the first-attempt count with the same question under new IDs. |
| **User answers in the wrong language** | Detected when the answer is scored, flagged in feedback, and the answer is **excluded from that language's progress data**. |
| **Question already answered in a previous round, in either mode** | Allowed and asked, marked a repeat, scored normally, and excluded from first-attempt data. *Amended 2026-09-27:* this said "realistic round", which let a practised question count as unseen. |
| **Huge or unparseable role-context file** | Rejected with a clear reason before the round starts, never mid-round. |
| **Spacing across timezones or a system clock change** | Due-ness is computed from stored timestamps; a clock change does not retroactively alter history. |

---

## 8. Not in v1

Carried from the brief, and extended.

1. Live conversational voice where the AI interrupts or talks over the user.
2. Video, facial expression, or body language analysis.
3. **Sharing, or comparing scores with anyone.** Unchanged and permanent. *Amended 2026-09-12:* the
   schema is multi-tenant (§1), but no second account can sign in and no sharing surface exists.
4. Job board integration, application tracking, scheduling.
5. Rewriting the CV.
6. Languages other than Japanese and English.
7. Real-time assistance during an actual interview — the "interview copilot" category. Named so a
   later session cannot drift into it.
8. Interleaving round types within a session.
9. **A full four-round run in one sitting.** Deferred to LATER, and deliberately **not** pre-shaped
   into v1's model.
10. **Any mobile or responsive support.** Desktop only. The app states this rather than degrading.
11. **Per-answer feedback in realistic mode.** Not a scheduling detail — it is the mode's definition.
12. **A composite or overall score.** Not deferred. Never.

---

## 9. Requirements that are not features

These constrain every screen and are not negotiable at build time.

- **No composite score is ever computed, stored or shown.**
- **Round-end feedback renders while the user is still at the machine.** Asynchronous evaluation that
  lands later is a defect.
- **First attempts are never overwritten.**
- **Raw transcripts are never discarded** in favour of corrected text.
- **Every scored answer carries its version stamps** — CV version, rubric version, generator prompt
  version, scoring model/prompt version — because the six-month chart is only trustworthy if drift is
  visible.
- **All data is private to one user and shared with nobody.**
