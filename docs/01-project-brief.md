# Project brief — Suburi

**Date:** 2026-09-12
**Status:** Phase 1 complete. PRD written.

## What this is

A private, single-user interview simulator that manufactures interview reps in Japanese and English:
the app asks one question, the user answers out loud, corrects the speech-to-text transcript before
submitting, and receives rubric-scored feedback at the end of the round. Every round is stored so
improvement can be measured over months.

## The problem, and for whom

The user interviews in both Japanese and English and has no way to practise either. Reading lists of
common questions does not help — the difficulty is saying an answer out loud, once, under pressure,
in the right language and register, with the right story chosen from his own history. Real interviews
are rare and expensive, so the only way to get reps is to manufacture them.

Both languages matter equally. An English answer that works does not translate into a Japanese answer
that works.

**First and only user:** the author. No sharing, no teams.

## Scale

**Serious side project.** Not a weekend hack, not a product. No interview is currently scheduled, so
there is no deadline pressure and the storage layer can be designed properly rather than bolted on.
This is required by the six-month success criterion below, which a throwaway build cannot deliver.

## Success

**At 30 days**
- The core loop works end to end in both languages.
- **8 realistic-mode rounds completed — at least 3 in Japanese and at least 3 in English.**

The language floor is the criterion that matters: it catches an English app with a Japanese toggle.

**At 6 months**
- One screen showing **per-dimension** score trends across **first attempts at previously unseen
  questions**, per language.
- **At least 30 first-attempt data points per language.**
- The user can name one dimension that rose and one that did not.

Success at 6 months is **an honest instrument, not an improved user.** Whether the user improves
depends on him doing the reps; whether the measurement is trustworthy is the app's job, and it is the
only half the app controls. Macnamara et al. (2014) found deliberate practice explained under 1% of
performance variance in professions — the weakest domain in their analysis — which makes "the chart
goes up" a criterion the app would fail for reasons outside its control.

## Riskiest assumption

**That a turn-based simulation — self-paced, unobserved, with an editable transcript — generates
enough pressure to train what actually fails in real interviews.**

The core loop is deliberately built to remove pressure: no live voice, no interruption, the user
stops to fix the transcript before submitting, nobody is watching, nothing is at stake. That is
correct for the correction step and for making answers durable, but each of those features subtracts
the variable the research says carries the training effect. Behroozi et al. (FSE 2020) found
technical interview performance halved by being watched. Low et al.'s pressure-training meta-analysis
(g = 0.67) concluded instructors should build pressurised environments rather than add volume to calm
ones. Realistic mode's countermeasures are a timer and a single take; a timer is weak pressure next to
a person watching.

If this is wrong, the product is a well-instrumented way of rehearsing at one's own pace, which sits
near the low-utility end of Dunlosky et al.'s ranking rather than at practice testing.

**Falsification test, inside the 30-day window:** after each realistic-mode round, before any feedback
is shown, the user self-reports felt pressure 1–5. It is stored with the round.

- Ratings of 1–2 across the first eight rounds → the simulation is not working. Respond by
  strengthening the pressure manipulation (speak the question aloud, hide the question text after
  asking, visible countdown, camera on, scores that cannot be quietly deleted) — not by adding
  features.
- Ratings of 3+ → the assumption held.

This is **instrumentation, not feedback.** Once per round, never per answer, never surfaced as
something to improve. A pressure score the user tries to raise is exactly the self-directed attention
Kluger and DeNisi (1996) found makes a third of feedback interventions backfire.

### Secondary risks

- **Scorer drift.** If the same answer scores 3 in March and 4 in September, the chart measures the
  model rather than the user. Mitigation: keep a held-out set of the user's past answers and re-score
  them periodically to detect drift. Phase 4 technical risk, not a project-killer.
- **Reps never happen.** Real, but downstream of the pressure assumption — Google's Interview Warmup
  was free, instant and login-free and was still retired.

## Out of scope for v1

1. Live conversational voice where the AI interrupts or talks over the user.
2. Video, facial expression, or body language analysis.
3. Sharing, or comparing scores with anyone. *(Amended 2026-09-12: the schema became multi-tenant in
   Phase 4 so a future product is a migration, not a rewrite. Access is still one allowlisted account,
   and no sharing surface exists. See `02-product-requirements.md` §1.)*
4. Job board integration, application tracking, scheduling.
5. Rewriting the CV.
6. Languages other than Japanese and English.
7. **Real-time assistance during an actual interview.** The "interview copilot" category (Final Round
   AI and imitators). Widely treated as cheating by employers, and the adjacent thing a later session
   could drift toward. Named here so it cannot.
8. Interleaving round types within a session. Deferred to LATER — contextual interference research is
   contested in field settings and low interference suits less-skilled performers anyway.

## Why this exists when Yoodli exists

Commodity, and not a reason to build: voice answer → transcript → AI feedback; Japanese support;
progress charts across sessions; filler words, pace and WPM; question banks by round type. Yoodli
does all of these, including coaching feedback in Japanese.

Not found in any competing tool surveyed (stated as *not found*, not *does not exist*):

1. **The transcript correction step.** Every tool surveyed grades raw speech-recognition output.
2. **Two rubrics rather than one with a language flag** — 敬語 scored as its own dimension, Japanese
   set pieces with expected shapes. Japanese tools score 内容・論理性・具体性・語彙力 and are built for
   新卒就活, not 転職; English tools do not reach Japanese register at all.
3. **First-attempt-only progress measurement.** Competitors plot every session, which is the
   memorisation drift this project is trying to avoid.
4. **CV-grounded evaluation in both directions** — claims unsupported by the CV, and CV material never
   used.

Items 1, 2 and 3 are the reason to build. Not voice, not bilingual, not charts.
