# CONTEXT — Suburi

Shared vocabulary and standing invariants. **Read this before writing any spec, ticket or code.**
`docs/` holds the product; this file holds the words it is written in and the rules that bind every
change. Specs and tickets must speak this vocabulary exactly.

---

## What Suburi is

A private, single-user, turn-based voice interview simulator for practising job interviews in
Japanese and English. The app asks one question, the user answers out loud, **corrects the
speech-to-text transcript before submitting**, and receives rubric-scored feedback at the end of the
round. Every round is stored so improvement can be measured over months.

**The product is an honest instrument, not an improved user.** Whether the user improves depends on
the user doing the reps. Whether the measurement can be trusted is the app's job, and it is the only
half the app controls. When a trade-off appears between a nicer experience and a more trustworthy
measurement, the measurement wins.

---

## Vocabulary

Use these words and no synonyms. Renaming any of them in code or copy breaks the link between the
docs and the build.

| Term | Means |
| --- | --- |
| **Round** | One sitting. Exactly one round type, one language, one mode, one length. The unit of practice *and* the unit of history. |
| **Round type** | `behavioural` \| `technical` \| `hr` \| `ceo`. |
| **Mode** | **Practice** — edit freely, retry, immediate per-answer feedback, no timer. **Realistic** — one take, timed, feedback held to round end. |
| **Question** | A bank entry with a **permanent id**. Either a **set piece** (hand-authored, fixed) or **generated** (created from CV + role context, then written into the bank on first use). |
| **Bank** | The accumulated set of questions. Grows; entries are never deleted, only retired. |
| **Follow-up** | A question generated from what the user just said. **Not a bank entry**, no stable identity, never in progress data, never scored as a first attempt. |
| **First attempt** | The first *realistic-mode* answer to a given question id in a given language. **Never overwritten.** The only data Progress plots. |
| **Take** | One recorded audio capture of one answer. |
| **The correction step** | Editing the raw transcript inline before submitting. Raw and corrected both persist. **This is the feature no surveyed competitor has — never optimise it away.** |
| **Rewrite magnitude** | How much the correction step changed the raw transcript. The diff is data, not a side effect. |
| **Role context** | What the round is pitched at: an uploaded posting, researched notes, or explicit **General practice**. |
| **CV** | The set of documents a round is scored against, **one per language**, each with its own version history. Japanese: a required **履歴書**, an optional **職務経歴書**, and additional documents. English: a required **CV** document and additional documents. In Japanese copy the set is **応募書類**; in English, **CV**. |
| **Document** | One member of a CV: a 履歴書, a 職務経歴書, a CV document, or an **additional document** (titled by the user, up to five, in either language). Pasted, or imported from `.docx`/`.pdf` into editable text that the user checks before saving. |
| **CV version** | An immutable snapshot of one language's whole CV. Changing any document makes a new version of the set. Labelled `応募書類 v{n}` / `CV v{n}`, numbered per language, never typed by the user. |
| **Current CV version** | The newest CV version in a language. The only one a new round in that language can use; older versions stay readable, never selectable. |
| **Claim** | One atomic, citable assertion extracted from a CV version, with a character **span** into that version's immutable text. Never drawn from a 履歴書's personal particulars. |
| **Span** | `[start, end)` into `cv_versions.body`. Quotes are **sliced from stored text by span**, never taken from model output. A span **may not cross a document boundary** — one that does is dropped and counted, never clamped. |
| **Coverage** | Which CV claims have been cited, and which never have. Makes *"CV material never used"* expressible. |
| **Carry-forward** | A claim in a new CV version whose normalised text exactly matches a claim in the **immediately previous** version **of the same language** — from any document in it. It inherits that claim's coverage. Two versions back never matches; the other language never matches. |
| **Stamps** | The four version markers on every scored answer: **CV version, rubric version, generator prompt version, scoring model**. |
| **Boundary** | The line Progress draws wherever a stamp changed. Makes drift visible instead of silent. |
| **Drift** | The same answer scoring differently over time because the *scorer* changed. The central technical risk. |
| **Felt pressure** | A 1–5 self-report taken once per realistic round, **before any feedback**. Instrumentation for the brief's falsification test — never feedback, never averaged, never shown as something to improve. |
| **敬語 / register** | A scored rubric dimension in Japanese only. Not a politeness filter, not a translation concern. |

---

## Invariants — never violated, in any ticket

From PRD §9 and screen-spec §11. A change that breaks one of these is wrong even if it was asked for;
raise it rather than implement it.

1. **No composite score** is ever computed, stored or displayed — no column, no view, no tooltip, no
   export. Not "overall", not "average", not "total".
2. **Round-end feedback renders while the user is still at the machine.** A spinner that outlives the
   sitting is a defect, not a loading state. This is why answers are scored *as submitted*, not
   batched at round end.
3. **First attempts are never overwritten.** A retry is a new row beside the first; Progress plots
   only the first.
4. **Raw transcripts are never discarded** in favour of corrected text. Both persist; raw is
   reachable from History.
5. **Every scored answer carries all four stamps**, and Progress draws boundaries where they changed.
6. **All data is private to one user.** No sharing surface, no leaderboard, no export-to-anyone —
   *despite* the multi-tenant `user_id` columns. Tenancy is not permission to build sharing.
7. **Nothing is hard-deleted.** No delete-my-round feature. A score you can quietly delete after a
   bad round is a chart that stops being honest.
8. **The scoring model is an exact pinned string, never an alias.** Changing it is a migration with a
   re-score and a boundary, not an edit.

**Where these are enforced, not merely stated:** `docs/04-database-schema.md` §6 (what the schema
cannot express), `docs/07-api-design.md` §6 (the endpoints that must never exist — no `DELETE`
anywhere, no `PATCH` on an answer, no response field carrying a composite), and
`docs/11-testing-plan.md` §3 (the tests that may not be deleted to make a refactor pass). A ticket that
needs one of these relaxed is a ticket that edits those three documents first.

---

## Two rubrics, not one with a flag

Dimensions are integers **1–5**. English and Japanese share six; Japanese adds a seventh.

`structure` · `evidence` · `relevance` · `fluency` · `accuracy` · `length_pacing` — plus `keigo`
(Japanese only).

**Fluency and accuracy are separate dimensions** and must never be collapsed into one "language
score". A Japanese round's feedback is written in Japanese with an English toggle; dimension names
follow the feedback language.

---

## Stack, fixed in Phase 4

Next.js (App Router) + TypeScript on Vercel · Tailwind CSS v4 · shadcn/ui on Base UI · Drizzle ·
Postgres 18 + `pgvector` on Neon (Docker locally) · Better Auth with Google as the only IdP · AWS S3
for audio · OpenAI `gpt-5.6-sol`, pinned, for all four model jobs — generation, follow-ups, scoring,
CV claim extraction.

**`docs/05-design-system.md` is the only palette.** Tailwind's defaults are wiped, shadcn's variables
alias `05`'s tokens, and code outside `components/ui/` uses `05` names. `05`'s `--accent` is `--mark`
in code, because shadcn owns `--accent`. `05` §10.

**Speech-to-text is `gpt-transcribe`**, $0.0045/minute, verified 2026-09-12 — about $0.11 a round
against ~$0.40 on Sol. It needs API **Tier 1 or above**, and its only snapshot shares its name, so
unlike the scoring model it cannot be pinned to a dated string; the answer row's
`transcriber_model_id` stamp is what makes a repoint visible. `docs/03-technical-design.md` §4.

**Audio goes browser → S3 directly via presigned PUT.** A Vercel Function caps bodies at 4.5 MB and a
four-minute take can exceed it.

**Three platform ceilings, all verified 2026-09-12 and all on free tiers that cannot be raised.**
Vercel Hobby functions are **300s, default and maximum** — which is the whole invocation, so
`submit`'s `after()` scoring and its retries share one budget (`07` §5.10). Vercel Hobby cron runs
**once per day at most, ±59 minutes**, and a more frequent expression fails the deploy rather than
degrading (`12` §6). Neon Free keeps **6 hours of history, 6 hours maximum** — which is why the
`pg_dump` is daily, not weekly (`12` §8).

**`lib/ai/score.ts` is a port with one implementation.** Re-scoring a held-out set with a different
model is the only way to detect drift, and that is impossible if scoring is inlined at its call
sites.

**Branches and databases, one-to-one:** `main` → Vercel production → Neon `main`. `develop` → a stable
Vercel URL → Neon `develop`, seeded synthetic. Feature branches come off `develop` and share its
database. **Nothing but `main` ever points at Neon `main`**, and Neon `develop` is reset from a fresh
seed rather than branched from `main`. Migrate Neon `main` *before* merging `develop` into it. Full
detail and the non-obvious consequences: `docs/12-deployment.md` §1 and §4.

---

## Language rules

- **Both languages matter equally.** An English answer that works does not translate into a Japanese
  answer that works. A feature that works in English and degrades in Japanese is not done.
- **Every new Japanese string needs a native read.** The rules earned so far are in
  `docs/05-design-system.md` §6 — five of the six came from one review pass, not from care at
  authoring time. Assume the same is true of the next batch.
- **Desktop only.** Stated by the app, not degraded on a phone. No breakpoints; do not infer one from
  the 1280px canvas.

---

## Still open

Carry these; do not silently decide them in a ticket.

- **The bilingual chrome rule.** Does UI chrome follow the round's language, or the app's? Progress
  localises version labels per panel (`応募書類 v3` vs `CV v3`), implying per-round; Home's English
  caption names round types in Japanese. Both defensible, neither decided. `/sign-in` shows both
  languages side by side (`10` §12) — it has no round, so it sidesteps the rule rather than setting a
  precedent for it. **The CV screen answers it for itself only** (`10` §13): each panel's chrome is in
  its own language because each panel is about one language's documents. A screen showing both
  languages at once does not settle the rule for screens showing one.
- **The near-duplicate similarity threshold.** A guess until there is real data. Start strict, log
  every near-miss with its score, tune from the log.
- **CV claim extraction quality — judged, and the answer is no.** The real 履歴書 + 職務経歴書 and the
  real English CV went through `/cv` locally against Docker Postgres on 2026-09-23 (#20, `03` §4), and
  `11` §5's check was run on the result. **What passes:** 307 of 307 claims slice back **verbatim**
  from `cv_versions.body`, `spans_rejected` is **0** in both languages, and **no claim is drawn from
  the 履歴書's personal particulars** — the first claim starts at code point 239, after the `学歴`
  header at 228, on a 履歴書 that does carry a real address, telephone and date of birth. **What
  fails:** the reading. Single sentences are cut at their 連用形 hinges into fragments that cannot be
  cited (172 of 181 `ja` claims and 113 of 126 `en` sit in consecutive runs); **27% of the English CV,
  the whole `PROJECTS` block, produced no claims at all** while the 17 certification lines were
  extracted twice; and table rows carry their cell breaks inside the span. **The defect is the
  extractor prompt** — [#27](https://github.com/yutaasakura96/suburi/issues/27), which blocks #21. Two
  consequences to carry: **`spans_rejected` is 0 for every one of these**, so `12` §6's alert is blind
  to bad extraction and #27 owes a counter that is not; and **the screen cannot be the check at this
  granularity** — measured in the DOM, the 履歴書 is 83.1% underlined, the 職務経歴書 85.0% and the
  English CV 57.8%, in unbroken runs of 993, 977 and 710 characters. `10` §13's argument for the
  underline is sound and the screen did its job — it is what made this visible — but a marker covering
  six-sevenths of a page marks nothing.
- **One drawn-but-unspecified screen:** practice mode's record frames differ from realistic mode's.
  Listed in `docs/10-screen-specifications.md` §12. **The CV screen came off this list in #12** — it
  still has no artboard, but it is specified in `10` §13 from `05` components, which is the whole of
  what it needed, and `10` §12's own entry is struck through to say so.
- **Japanese copy that has not had its native read.** `応募書類`, the 履歴書 personal-particulars hint,
  every string on the CV screen, and the whole error catalogue — one read, one batch. Separately,
  three *prose* strings on the feedback and Progress screens still say `職務経歴書` where they now mean
  the whole set; every stamp already reads `応募書類 v{n}` (`05` §6, `10` §12).
- **Who sends the alert mail.** `08` §2 rejected magic links specifically to avoid a transactional email
  vendor; §6 of `12` reintroduces one as a placeholder. Decide deliberately — an alert nobody receives
  is not monitoring.
- **User-facing copy for the error catalogue.** `docs/07-api-design.md` §3 closes the set of error codes;
  none of the Japanese or English strings is written. `11` §3.10 asserts the two lists match, so this
  fails loudly until it is done — and the Japanese needs a native read.

---

## Where things live

| | |
| --- | --- |
| `docs/00-status.md` | **The memory.** Which phase is done, which is next. Read it first. |
| `docs/01`–`02` | Brief and PRD — the product. |
| `docs/03`–`04` | Technical design and schema — the build. |
| `docs/05`, `10` | Design system and screen specs — extracted from the prototype, not invented. |
| `docs/06-decision-log.md` | **Append-only.** The answer to every "why is it like this?" |
| `docs/08` | Auth and permissions. |
| `docs/07` | **The API surface.** Every endpoint, the one error envelope, and §6 — the endpoints that must never exist. |
| `docs/11` | Testing plan. §1 names the four silent failures everything else in it guards. |
| `docs/12` | Deployment — environments, every env var, migrations, rollback, monitoring, backups. |
| `design/` | Claude Design working files. **Edit these; never the built `suburi-directions.html`.** |
