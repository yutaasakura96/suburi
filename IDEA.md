# AI interview bot

Working title: **Suburi** (素振り). Renamed from `interview-lab` on 2026-09-12; this file predates the rename.

**Status:** idea capture, 2026-09-11. Written before any technical decision.
No stack, no voice model, no database, no framework choices appear below, and none should be added
to this file. Those belong to the first working session.

Sections marked **Suggested** are Claude's additions to the original idea, not my decisions. They are
here to be accepted, cut, or argued with.

---

## 1. The problem

I interview in Japanese and in English, and I have no way to practise either one.

Reading a list of common questions does nothing for me. The hard part is not knowing roughly what to
say. It is saying it out loud, once, under pressure, in the right language and the right register,
with the right story picked from my own history. Nothing I have gives me reps at that.

Two extra facts about my situation that shape the product:

- Both languages matter equally. An English answer that works does not become a Japanese answer that
  works, and the reverse is worse.
- Interviews are rare and expensive. I get very few real attempts, so the only way to get reps is to
  manufacture them.

## 2. Who it is for

One user: me. No accounts to manage, no sharing, no teams. Design for that and stop.

## 3. The rounds

In my experience a hiring process is four rounds, and they judge different things:

| Round | What it actually tests |
| --- | --- |
| Behavioural | Whether I have real stories and can tell one without rambling. |
| Technical | Whether I can explain what I built and defend a decision. |
| HR | Motivation, reason for leaving, availability, conditions, culture questions. |
| CEO / final | Why this company, where I am going, whether I ask anything worth asking. |

Each round should be practisable on its own. A full four-round run is a later feature, not the first
thing.

## 4. The core loop

Voice, but **turn based**, not a live conversation with an AI talking over me.

1. The AI asks one question.
2. I speak my answer.
3. Speech to text produces a transcript.
4. **I correct the transcript before submitting.** Recognition gets names, product names, technical
   terms and Japanese wrong often enough that submitting the raw text would mean being graded on the
   recognizer's mistakes.
5. I submit. The answer is stored, and the round moves to the next question.

Turn based is a choice, not a limitation I am working around. It buys the correction step, it makes
every answer a durable record instead of a stream that disappears, and it means latency does not
have to be conversational.

### The correction step, and what to keep

**Suggested:** store both the raw transcript and my corrected text, and treat the difference as data.
Words the recognizer never gets right are often words I mispronounce, and the filler I quietly delete
is filler I actually said. If only the corrected version survives, the record flatters me.

## 5. Context the AI works from

Two inputs, uploaded by me.

**My CV.** Uploaded once. It is where my talking points come from, and it is what the evaluation
holds my answers against.

**The company and the role.** Either the AI researches it, or I hand it a text file (a job posting,
notes, a scraped page) that becomes the context.

**Suggested:** when both exist, the uploaded file wins. A pasted job posting is the ground truth for
what they asked for. Research is a guess about a company, and a confident wrong guess about the role
would generate questions for a job I am not applying to.

## 6. Evaluation

After a round finishes, the AI evaluates my answers and gives me pointers I can act on.

**Suggested, and this is the one I care most about:** score against a small fixed rubric, the same
dimensions every time. Prose feedback alone cannot be tracked. If round three's advice is written in
different words from round one's, I cannot tell whether I improved or whether the AI just phrased it
differently.

A starting rubric, per answer:

- **Structure.** Did the answer have a shape, or did it wander. STAR for behavioural rounds.
- **Evidence.** Specific numbers, systems, decisions, outcomes. Not adjectives about myself.
- **Relevance.** Did it answer *this* question for *this* role, or was it a generic answer I had
  ready.
- **Language and register.** Grammar, vocabulary, and politeness level. Weighted differently per
  language (see section 8).
- **Length and pacing.** Too short reads as thin. Too long is the more common failure and the harder
  one to feel from the inside.

Round-level output is the rubric scores, the two or three things to fix, and one thing that worked so
I know not to change it.

**Suggested:** withhold per-answer feedback until the round ends, at least in the realistic mode
below. Being graded after every answer trains me to expect a coach in the room.

## 7. History and progress

Every round is stored: the questions asked, the raw transcript, my corrected answer, the scores, and
the pointers. The point is to open the app in three months and see whether I got better.

**Suggested, learned the hard way on another project:** keep the *first* attempt at a question
distinct from every later one, and never overwrite it. Progress measured on best-ever answers drifts
upward by memorisation and stops meaning anything. Improvement on first attempts at questions I have
not seen before is the honest number.

That implies something the first session has to decide: questions need stable identity, or at least
the rubric does, or "I improved" is just noise from getting easier questions.

## 8. Suggestions worth arguing about

Each of these is an addition to the original idea. Take them or cut them.

### Japanese is not English with different words

The Japanese interview has its own set pieces, and they are scored on things an English rubric does
not look at:

- 自己紹介, 志望動機, 転職理由, 自己PR, 逆質問. Some of these are close to mandatory and have an
  expected shape.
- Keigo. The same content in the wrong register fails. 敬語 should be its own rubric dimension in
  Japanese, weighted heavily, and it has no English counterpart.
- What counts as a good answer differs. Japanese HR rounds tolerate, and sometimes expect, a longer
  and more formal self-introduction than an English one would.

So the rubric is not one rubric with a language field. It is two rubrics that share most of their
dimensions.

### Two modes: practice and realistic

**Practice.** Edit the transcript freely, retry an answer, see feedback immediately, look at the
question as long as I like.

**Realistic.** One take. A timer per answer. Correction limited to obvious recognition errors, not
rewriting what I said. Feedback held to the end of the round.

Both are useful and they measure different things. Only the realistic mode's scores belong in the
progress history.

### One follow-up question

Real interviewers dig. "You said you led that migration. What went wrong?" is where most candidates
come apart, and a bot that only reads from a list never gets there. One follow-up per answer,
generated from what I actually said, would be the single highest-value feature after the core loop.

### Ground the evaluation in the CV, both directions

- Flag claims in my answer that my CV does not support. Not to accuse me of lying, but because a real
  interviewer has the CV open and will notice the gap.
- Flag things on my CV that I never brought up across a whole round. Those are usually my strongest
  material, left on the table.

### Keep some record of delivery, not only content

Text loses everything about how I sounded. Pace, hesitation, filler, dead air. Keeping the audio
would be ideal. If not, keep at least the answer duration and words per minute, since rambling shows
up there for free.

### A story bank

The same six or seven stories from my CV answer most behavioural questions. Extract them once, keep
them, and let the evaluation tell me which ones I overuse and which ones I never touch.

### Privacy

My CV, my salary expectations, my reasons for leaving a job, and notes on companies I am interviewing
with. All of it is private by default. Wherever it is stored, it is stored for one user and shared
with nobody.

## 9. Not in v1

Named so they do not creep in:

- Live conversational voice, where the AI interrupts and talks over me.
- Video, facial expression, or body language analysis.
- Multiple users, sharing, or comparing scores with anyone.
- Job board integration, application tracking, scheduling.
- Rewriting my CV.
- Languages other than Japanese and English.

## 10. Open questions for the first working session

Not answered here on purpose. These are the ones where a wrong guess costs real work:

1. Does the AI *speak* the question, or only display it? Text-only is cheaper and probably enough,
   but hearing the question is part of what makes it hard.
2. One round per session, or a full four-round loop in one sitting?
3. How many questions per round? Fixed, or chosen at the start?
4. Are the rubric scores numbers, bands, or labels? This decides whether progress can be charted.
5. Where does the transcript correction happen: retype the whole thing, or edit inline word by word?
6. Does the question set come from the AI each time, or from a stored bank that grows? This is the
   question that decides whether section 7's first-attempt idea is even expressible.
7. Desktop only, or does answering by voice on a phone matter?
8. Does anything run locally, or is it fine for a CV and an audio file to leave the machine?
