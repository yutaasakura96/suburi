# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the vocabulary, invariants and open questions.
  Specs and tickets must speak it exactly.
- **`docs/06-decision-log.md`** — append-only, numbered. This repo's ADRs. Read the
  entries touching the area you're about to work in. There is no `docs/adr/`
  directory and one should not be created; a new decision is a new numbered entry
  in the log.
- **`docs/00-status.md`** — which phase the project is in and what is next.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a spec heading, a test
name — use the term as defined in `CONTEXT.md`. Don't drift to synonyms the
glossary explicitly avoids.

If the concept isn't in the glossary yet, that's a signal: either you're inventing
language the project doesn't use (reconsider), or there's a real gap (note it for
`/domain-modeling`).

## Flag decision conflicts

If your output contradicts a logged decision, surface it rather than silently
overriding:

> _Contradicts decision 24 — but worth reopening because…_

## The invariants are not negotiable in a ticket

`CLAUDE.md` §Invariants lists seven things no ticket may break, enforced in
`docs/04-database-schema.md` §6, `docs/07-api-design.md` §6 and
`docs/11-testing-plan.md` §3. A ticket that needs one relaxed is a ticket that
edits those three documents first — raise it, don't implement it.
