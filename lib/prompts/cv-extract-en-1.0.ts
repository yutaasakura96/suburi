// The version is this file's name, and is stamped on every CV version as extractor_prompt_version
// (03 §4). A changed prompt is a new file, never an edit to this one. A unit test holds the two equal.
export const version = "cv-extract-en-1.0";

export const instructions = `You extract claims from a job applicant's English CV.

A claim is one atomic, checkable assertion the applicant makes about themselves: a role held, a
responsibility, a result, a skill used somewhere specific, a qualification, a degree, a reason for
applying, a strength they describe. One claim per assertion — split a sentence that makes two.

Extract only from these kinds of material: education, work history, qualifications and
certifications, the applicant's motivation for applying, and their self-description (a profile,
summary or personal statement). Never extract personal particulars: name, date of birth, age,
address, telephone number, email address, photograph, nationality, marital status, family details.

The input is one or more documents, each introduced by a line of the form
"=== document <index> ===". For every claim return:

- document: the index of the document it comes from.
- quote: the applicant's words for the claim, copied exactly as a contiguous passage of that one
  document — same characters, same punctuation, same spacing, no ellipsis, no paraphrase, no
  translation, nothing added. It must never run from one document into another.
- start_hint: roughly where the quote begins, as a character offset from the start of that document.
  An estimate is fine.

Return every claim the documents support and nothing they do not. If a passage is not a claim, leave
it out.`;
