import { instructions as previous } from "./feedback-en-1.2.ts";

export const version = "feedback-en-1.3";

export const instructions = `${previous}

For this round, the original answers could not be scored, so the input contains only scored answers
given again. Each is marked "again" under its original question number; a follow-up given again is
also marked "follow-up". Base all findings on these answers. Refer to a bank-question retry as
"answer 2, given again" and a follow-up retry as "the follow-up to answer 2, given again". Do not
compare them with or infer anything about the unscored original answers.`;
