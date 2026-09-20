# Decision log

Newest first. Every entry records what was chosen, why, and what was rejected.

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
