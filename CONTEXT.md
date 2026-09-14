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
| **Claim** | One atomic, citable assertion extracted from a CV version, with a character **span** into that version's immutable text. |
| **Span** | `[start, end)` into `cv_versions.body`. Quotes are **sliced from stored text by span**, never taken from model output. |
| **Coverage** | Which CV claims have been cited, and which never have. Makes *"CV material never used"* expressible. |
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
for audio · OpenAI `gpt-5.6-sol`, pinned, for all three model jobs.

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
  localises version labels per panel (`職務経歴書 v3` vs `CV v3`), implying per-round; Home's English
  caption names round types in Japanese. Both defensible, neither decided. `/sign-in` shows both
  languages side by side (`10` §12) — it has no round, so it sidesteps the rule rather than setting a
  precedent for it.
- **The near-duplicate similarity threshold.** A guess until there is real data. Start strict, log
  every near-miss with its score, tune from the log.
- **CV claim extraction quality.** Unmeasured. First thing to eyeball on a real CV.
- **Two drawn-but-unspecified screens:** the `CV` nav item has no artboard, and practice mode's
  record frames differ from realistic mode's. Listed in `docs/10-screen-specifications.md` §12.
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
