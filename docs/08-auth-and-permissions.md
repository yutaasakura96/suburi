# Auth & permissions — Suburi

**Date:** 2026-09-12
**Status:** Phase 4. Tier 2, triggered: the app is reachable on the public internet and users sign in.

---

## 1. What auth is for here

Two things that are easy to conflate and must not be:

- **The lock.** Suburi is deployed on the public internet and holds a CV, salary expectations and
  notes on companies being interviewed with. It needs a front door that only one person can open.
  **This is live in v1.**
- **The tenancy.** The data model carries `user_id` on every table so that a future multi-user
  product is a migration rather than a rewrite. **This is dormant in v1** — the columns exist, and
  exactly one value ever appears in them.

The schema anticipates many users. The door admits one. Those are separate decisions and this
document keeps them separate, because collapsing them is how a sharing surface gets built by
accident.

---

## 2. Login method

**Google OAuth, via Better Auth. The only method. No password anywhere in the system.**

*Why:* no password to store, hash, rotate, reset or leak; no password-reset email flow to build and
secure; 2FA is inherited from the Google account rather than implemented; and it is one click on the
desktop machine this app is built for (desktop-only, decision log Phase 2).

*Rejected:*
- **Email + password** — every failure mode of credential storage, for one user, with no upside.
- **Magic link** — needs a transactional email provider, which is a vendor, a key and a deliverability
  problem in exchange for nothing Google does not already give.
- **No auth, private deployment only** — one host misconfiguration away from publishing a CV and
  salary expectations with no second layer behind it.

### The allowlist

Better Auth's per-provider `disableSignUp: true` on the Google provider (verified 2026-09-12 against
Better Auth's `socialProviders` reference). A Google account with no matching `users` row **cannot
create one by signing in**. The single row is inserted by a seed script, below.

```
socialProviders: {
  google: { clientId, clientSecret, disableSignUp: true }
}
```

This gives an allowlist with **no invite flow, no signup route, and no admin surface to build** —
which is the whole reason to prefer it over a hand-rolled email check.

`ALLOWED_EMAIL` is additionally asserted server-side on session creation, so the guarantee does not
rest on a single library flag being correct. It lives in a session-creation database hook, which
refuses the session for any other email.

**The row comes from a seed script, not a migration.** A hand-run script reads `ALLOWED_EMAIL` from
the environment and inserts the row with `email_verified = true`, idempotently. A migration would
commit the email to a public repository forever. Two library facts, verified 2026-09-14 against Better
Auth 1.7.4's source: `disableSignUp` blocks only the create-a-new-user path — a matching existing user
still signs in — and a first Google sign-in links to that existing row only if the row is
`email_verified`, otherwise it fails with "account not linked". Account linking stays at its default.

---

## 3. Sessions

Better Auth's **database-backed sessions with an HTTP-only, `Secure`, `SameSite=Lax` cookie.**
Sessions are rows, so revocation is a delete and does not wait for a token to expire — which is what
you want for the only credential guarding this data.

*Rejected:* stateless JWTs. Nothing here needs to validate a token without touching the database
(every request that matters reads Postgres anyway), and unrevocable credentials are a poor trade for
a single-user app holding sensitive documents.

**Expiry: `expiresIn` 30 days, `updateAge` 1 day** — a session lasts 30 days and is extended at most
once a day while in use. Better Auth's defaults are 7 days and 1 day (verified 2026-09-14); the expiry
is deliberately overridden. A short expiry buys nothing against the threat model in `03` §9 and costs
a sign-in mid-practice, or after a gap between practice weeks, which is exactly the interruption
realistic mode is designed not to have.

---

## 4. Roles and permissions

**There are no roles.** No `role` column, no `is_admin`, no permission plugin.

| Action | Signed in (the one user) | Anyone else |
| --- | --- | --- |
| Sign in | ✅ (allowlisted Google account only) | ❌ |
| Start a round, record, correct, submit | ✅ | ❌ |
| Read own history, progress, feedback | ✅ | ❌ |
| Upload a CV / role context | ✅ | ❌ |
| Retry a failed scoring attempt | ✅ | ❌ |
| Delete a round, answer or score | ❌ **nobody** | ❌ |
| Share, export to another person, publish | ❌ **nobody** | ❌ |

The last two rows are the interesting ones. They are not "unimplemented" — they are refused by
design (PRD §9, screen-spec refusals #3 and #6). A scoring record that can be quietly deleted after
a bad round is a chart that stops being honest, and the brief names *"scores that cannot be quietly
deleted"* as a deliberate pressure countermeasure.

**When tenancy activates**, this table grows a column, not a hierarchy. There is still no admin.

---

## 5. Route protection

| Route group | Protection | Unauthenticated lands |
| --- | --- | --- |
| `/sign-in` | public | — |
| `/api/auth/*` | Better Auth's own | — |
| `/` (Home), `/round/*`, `/progress`, `/history`, `/cv` | session required | `/sign-in` |
| `/api/*` (presign, transcribe, score) | session required | `401`, no redirect |

Enforced in the proxy **and** re-asserted inside every page, Server Action and Route Handler. Next.js
16 renamed middleware to proxy. The proxy's session check is **optimistic** — Better Auth's own docs
say so, since it reads the cookie without validating the session — so it only decides where to
redirect. The proxy alone is not a security boundary — a route added later that its matcher does not
cover would otherwise be silently public.

In code: `proxy.ts` matches every path but build output, and keeps the public list itself. Pages and
Server Actions re-check with `requireSession()`, route handlers with `requireApiSession()`, both in
`lib/auth/session.ts`.

**Every query is scoped by the session's `user_id`**, from day one, even though there is only one.
That is the point of doing tenancy now: the scoping habit is established while it is free, not
retrofitted across every query later under pressure.

---

## 6. Password reset and email verification

**Not applicable, not deferred — structurally absent.** There is no password to reset. Email is
verified by Google before Better Auth ever sees it, and `requireEmailVerification` is redundant
against a provider that already asserts it.

If email+password is ever added, both flows become required and this section must be rewritten
before that ships.

---

## 7. What would have to change for a second user

Recorded so the cost is known rather than guessed:

1. Remove `disableSignUp` and drop the `ALLOWED_EMAIL` assertion — or replace both with a real invite
   table.
2. Seed per-user set-piece questions; the `questions` bank is already `user_id`-scoped, so generated
   questions and their near-duplicate slices are correct as-is.
3. **Re-examine every screen against refusal #6.** Multi-user is not permission to build sharing,
   leaderboards or comparison — the brief puts *"comparing scores with anyone"* out of scope for
   reasons about the instrument, not about scale.
4. Revisit the cost model in `03` §6, where model spend dominates infrastructure by two orders of
   magnitude.

Nothing in this list is blocked by a v1 decision. That was the goal.
