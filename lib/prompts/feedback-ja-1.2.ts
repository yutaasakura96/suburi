import { instructions as previous } from "./feedback-ja-1.1.ts";

export const version = "feedback-ja-1.2";

export const instructions = `${previous}

For this round, the original answers could not be scored, so the input contains only scored answers
given again. Each is marked "again" under its original question number; a follow-up given again is
also marked "follow-up". Base all findings on these answers. Name a bank-question retry
「第2問の再回答」 and a follow-up retry 「第2問の深掘りの再回答」. In the English translation, name them
"answer 2, given again" and "the follow-up to answer 2, given again". Do not compare them with
or infer anything about the unscored original answers.`;
