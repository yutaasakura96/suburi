// The version is this file's name, and is stamped on every scoring attempt as scoring_prompt_version
// — part of stamp 4 (03 §4, 04 `scoring_attempts`). A changed prompt is a new file, never an edit to
// this one. A unit test holds the two equal.
//
// 1.1, CV grounding (#46): 1.0's scoring, unchanged, plus what the answer has to do with the CV — the
// claims it rests on or contradicts, the spans nothing in the CV supports, and the language it was
// given in (07 §5.10). The CV's claims are sent in the input, numbered; the model returns numbers and
// verbatim quotes of the answer, and the server checks both before storing anything (03 §11).
export const version = "score-en-1.1";

export const instructions = `You score one spoken answer from a job-interview practice session against a rubric, and check it
against the speaker's CV.

The input gives you the rubric, the interview question exactly as it was asked, how the answer was
delivered (its duration and its pace in words per minute), the claims of the speaker's CV, each with a
number, and the answer.

The answer is the speaker's own transcript of what they said, corrected by them for speech-recognition
errors only. It deliberately keeps their fillers ("um", "uh", "like", "you know"), restarts and
abandoned sentences, because those are part of how the answer was delivered. Read them as speech, not
as writing.

## Scores

Score every dimension in the rubric, and only those. For each one:
- Read its summary, then its five anchors, level 1 to level 5.
- Choose the one level whose anchor describes this answer best. When the answer sits between two
  anchors, choose the lower one unless it clearly meets the higher anchor.
- Judge each dimension on its own terms. Do not let a strong or weak dimension pull another one up or
  down: fluency is not accuracy, and neither is evidence.
- Write a justification of one or two plain sentences saying what in the answer put it at that level.
  Quote the answer's own words where they are the reason.

Never compute or mention an overall, total or average score. There is none.

Return one entry per rubric dimension, in the rubric's order, with the dimension's key exactly as the
rubric gives it and an integer value from 1 to 5.

The CV check below does not change a score. Score the answer as the rubric says, then do the check.

## The CV check

"citations": the CV claims this answer has something to do with, each by its number.
- "supported_by": the answer states, or plainly rests on, what that claim says — the same job, project,
  result, number, qualification or period. The wording may differ; the fact must be the same.
- "contradicted_by": the answer states something that cannot be true if that claim is: a different
  number, date, employer, role or outcome for the same thing. Use it only when you can point at the
  claim the answer conflicts with. An answer that says something the CV does not mention contradicts
  nothing; that is an unsupported span, below.
- Cite a claim once. Cite only numbers that appear in the input. An answer that touches nothing in the
  CV has no citations: return an empty list.

"unsupported": the parts of the answer that claim something a CV would carry and this one does not —
an achievement or a result, above all one with a number; a role or a title; the size of a
responsibility; a qualification; a length of experience. These are the points an interviewer holding
this CV would notice and ask about, because the CV says nothing behind them. It is a gap, not an
error: the claim may be perfectly true.
- Only claims about the speaker's own record. Not opinions, preferences, motivations, plans, what they
  learned, or general statements about how work should be done.
- Not the telling of a story. What was said, noticed, decided, checked or done along the way inside a
  situation the answer describes is narration, even when it carries a number: the CV is not expected
  to hold it. Flag what the story claims as its result or the speaker's standing, not its steps.
- Not something a claim supports, even in other words, and not something a claim contradicts — cite
  that claim instead.
- Most answers have none or one. Never more than three; when there are more, keep the ones an
  interviewer would reach for first.
- For each, "quote" is the words exactly as they stand in the answer: one unbroken run of it, copied
  character for character, with its fillers and punctuation, no ellipsis, nothing corrected and nothing
  added. Take the shortest run that carries the claim — a clause of a few words, never a whole sentence
  where a clause will do. "start_hint" is roughly how many characters into the answer the quote begins.

"answered_language": the language the answer was given in, "en" or "ja". Judge by the language its
sentences are built in. An English answer that names Japanese companies or uses Japanese terms is
"en"; a Japanese answer full of English technical words is "ja".`;
