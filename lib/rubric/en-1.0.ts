import type { Rubric } from "./types.ts";

// Rubric `en` v1.0 (06, 2026-09-27): drafted by Claude with an anchor for every level of every
// dimension, and **reviewed by the user before it is seeded anywhere real** (04 `rubric_versions`,
// 11 §5). A changed rubric is a new file and a new version label, never an edit to this one: every
// scored answer carries the version as stamp 2, and Progress draws a boundary where it changes.
//
// What the scorer reads (03 §4): the corrected transcript, never the raw one, plus the answer's
// duration and pace. Fluency is defined on what the correction step keeps — fillers, restarts and
// abandoned sentences, which screen 5's caption asks the user to leave in — so correcting cannot
// launder it. Accuracy is the language itself, not the facts: an answer can be true and inaccurate.

export const EN_1_0: Rubric = {
  versionLabel: "v1.0",
  language: "en",
  dimensions: [
    {
      key: "structure",
      label_ja: "構成",
      label_en: "Structure",
      definition: {
        summary:
          "How the answer is organised: whether the point comes early, whether the parts follow an order the listener can track, and whether the answer closes rather than stops.",
        anchors: [
          "No discernible point or order. A sequence of fragments that does not add up to an answer.",
          "The answer wanders. The main point is buried or only implied, and parts repeat or double back.",
          "A point is there, but it arrives late or the parts are loosely ordered. The listener can reconstruct it with some effort.",
          "The main point is stated early and the order is easy to follow. One part is out of place, or the close is thin.",
          "Opens with a direct answer, develops it in a clear order (for example situation, action, result) and closes by returning to the point. The listener never has to guess where it is going.",
        ],
      },
    },
    {
      key: "evidence",
      label_ja: "根拠",
      label_en: "Evidence",
      definition: {
        summary:
          "Whether the answer's claims are backed by specifics a listener could check: a concrete situation, what the speaker personally did, and a result with a number, a scale or a time frame.",
        anchors: [
          "No evidence. Claims about qualities or experience with nothing behind them.",
          "Mostly assertions (\"I'm a hard worker\", \"I'm good with people\"), with at most a passing example that has no detail.",
          "One real example, but the speaker's own part or the outcome stays general (\"we improved it\", \"it went well\").",
          "The main claims are backed by a concrete example with the speaker's own action and a result. One claim rests on assertion, or one result is vague.",
          "Every substantive claim is backed by a concrete example: the speaker's own action and a specific, plausible result — a number, a scale, a time frame or a named outcome.",
        ],
      },
    },
    {
      key: "relevance",
      label_ja: "関連性",
      label_en: "Relevance",
      definition: {
        summary:
          "Whether the answer addresses the question actually asked, all of it, and connects to what the role needs — or, in General practice, to what an interviewer asking this question wants to learn.",
        anchors: [
          "Does not answer the question asked.",
          "Mostly off the question. Relevant material appears only in passing.",
          "Addresses the topic but only part of the question: answers an easier neighbouring question, or one half of a two-part question.",
          "Answers the question asked. One part is covered lightly, or the connection to the role is left for the listener to make.",
          "Answers exactly the question asked, every part of it, and makes clear why the answer matters for the role or for what the interviewer is trying to learn.",
        ],
      },
    },
    {
      key: "fluency",
      label_ja: "流暢さ",
      label_en: "Fluency",
      definition: {
        summary:
          "How smoothly the answer was delivered, read from what the corrected transcript keeps: fillers (um, uh, like, you know), restarts, abandoned sentences and hesitations, together with the pace. Not grammar or word choice — that is accuracy.",
        anchors: [
          "Delivery breaks down. Most sentences are restarted or abandoned, or long stretches are fillers.",
          "Frequent fillers, restarts or abandoned sentences make the listener work to follow.",
          "Noticeable fillers or restarts in several places, but the listener follows without real effort.",
          "Occasional fillers or a restart, none of which breaks the thread.",
          "Speech runs continuously. Fillers and restarts are rare and never interrupt the meaning, and the pace is steady.",
        ],
      },
    },
    {
      key: "accuracy",
      label_ja: "正確さ",
      label_en: "Accuracy",
      definition: {
        summary:
          "Grammatical and lexical correctness of the English: grammar, word choice, collocation and the correct use of technical terms. Not delivery — that is fluency — and not whether the content is true.",
        anchors: [
          "Errors throughout obscure the meaning of most sentences.",
          "Frequent errors. Several phrases are unclear, or technical terms are misused.",
          "Regular errors, a few of which make a phrase momentarily unclear. Word choice is sometimes imprecise.",
          "A few minor errors (articles, prepositions, agreement) that never obscure the meaning.",
          "Errors are absent or trivial. Word choice is precise, including domain and technical terms.",
        ],
      },
    },
    {
      key: "length_pacing",
      label_ja: "長さ・配分",
      label_en: "Length and pacing",
      definition: {
        summary:
          "Whether the answer's length suits the question and its time is spent where it matters, read from the duration and pace as well as the text. For most questions one to two minutes is enough; a question asking for a detailed example can take up to about three. A pace of roughly 110 to 170 words per minute is comfortable to follow.",
        anchors: [
          "A few words only, or runs to the four-minute cap without reaching the point.",
          "Far too brief to answer properly (under about 30 seconds for a substantive question), or far too long, with repetition filling the time.",
          "Noticeably short for what the question asks, or noticeably long (over about three minutes) with some padding; or the pace is noticeably fast or slow.",
          "Close to the right length. The setup takes a little too long, or one part gets less time than it needs; the pace is comfortable.",
          "The length fits the question and most of the time goes to the substance rather than the setup. The pace is comfortable throughout.",
        ],
      },
    },
  ],
};
