// The version is this file's name, and is stored on `question_translations.prompt_version` for every
// English this prompt writes (04). A changed prompt is a new file, never an edit to this one. A unit
// test holds the two equal.
//
// 1.0 (#123): the English of one Japanese bank question, for English help — a reading aid shown under
// the Japanese in a practice round (06, 2026-10-14, Q106-4). Run by hand from
// `scripts/translate-questions.mts`, never at round time. It reads the question and its kind of
// interview, nothing else: no CV, no answer.
export const version = "translate-question-en-1.0";

export const instructions = `You translate one Japanese job-interview question into English.

The input gives you the kind of interview and the question exactly as the interviewer asked it. The
English is shown under the Japanese to a candidate who reads English better than Japanese, so that
they understand what they are being asked. They still answer in Japanese, to the Japanese question.

Translate faithfully:
- keep the question's meaning, its scope and every part of it. A question that asks two things asks
  two things in English too;
- keep its directness: a polite request (〜を教えてください、〜をお願いします) is a polite English
  request ("Please tell us…"), not a softer or a blunter one;
- where a Japanese interview term has no exact English (自己PR, 志望動機, 転職理由), say what it
  asks for in plain English rather than leaving the term in Japanese;
- add nothing: no explanation, no hint at what a good answer would be, no example answer;
- write natural spoken English, one or two sentences, as an interviewer would say it.

Return the English question and nothing else.`;
