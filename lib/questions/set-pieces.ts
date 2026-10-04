// The set pieces: hand-authored bank questions, checked-in seed data (11 §8, 12 §3 step 9). Each
// belongs to exactly one round type — self-introduction, self-PR and reason for leaving to `hr`,
// motivation to `ceo` — and there is one row per set piece per language, never one per round type,
// so a question has one id and one first attempt (04 `questions`, 06 2026-09-27). No reverse
// question (逆質問): the candidate asking does not fit answer-then-score.
//
// The content version is stamp 3 for every answer to a set piece. A changed wording is a new content
// version with new rows, never an edit to a stored body.

export type SetPieceLanguage = "ja" | "en";

export interface SetPiece {
  readonly roundType: "hr" | "ceo";
  readonly body: string;
}

export interface SetPieceContent {
  readonly language: SetPieceLanguage;
  readonly contentVersion: string;
  readonly pieces: readonly SetPiece[];
}

export const SET_PIECES_EN: SetPieceContent = {
  language: "en",
  contentVersion: "set-piece-en-1.0",
  pieces: [
    { roundType: "hr", body: "Could you start by introducing yourself?" },
    {
      roundType: "hr",
      body: "What is the strength you would most want an employer to know about, and where have you shown it at work?",
    },
    { roundType: "hr", body: "Why are you looking to leave your current role?" },
    { roundType: "ceo", body: "Why do you want to join this company?" },
  ],
};

// 自己紹介, 自己PR and 転職理由 (`hr`), 志望動機 (`ceo`), each as an interviewer says it. Not translations
// of the English set: a Japanese interviewer asks for 自己PR by name.
export const SET_PIECES_JA: SetPieceContent = {
  language: "ja",
  contentVersion: "set-piece-ja-1.0",
  pieces: [
    { roundType: "hr", body: "まず、簡単に自己紹介をお願いします。" },
    { roundType: "hr", body: "自己PRをお願いします。" },
    { roundType: "hr", body: "転職を考えた理由を教えてください。" },
    { roundType: "ceo", body: "当社を志望した理由を教えてください。" },
  ],
};

export const SET_PIECES: readonly SetPieceContent[] = [SET_PIECES_EN, SET_PIECES_JA];
