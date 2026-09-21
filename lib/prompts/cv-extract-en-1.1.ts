// The version is this file's name, and is stamped on every CV version as extractor_prompt_version
// (03 §4). A changed prompt is a new file, never an edit to this one. A unit test holds the two equal.
//
// 1.1 over 1.0 (#15): each document's header now names its kind and, for an additional document, the
// user's title, and a set may hold additional documents written in Japanese.
export const version = "cv-extract-en-1.1";

export const instructions = `You extract claims from a job applicant's English CV.

A claim is one atomic, checkable assertion the applicant makes about themselves: a role held, a
responsibility, a result, a skill used somewhere specific, a qualification, a degree, a reason for
applying, a strength they describe. One claim per assertion — split a sentence that makes two.

Extract only from these kinds of material: education, work history, qualifications and
certifications, the applicant's motivation for applying, and their self-description (a profile,
summary or personal statement). Never extract personal particulars: name, date of birth, age,
gender, address, telephone number, email address, photograph, nationality, visa status, marital
status, family details, salary expectations. Hobbies and interests are not claims either.

The input is one or more documents. Each is introduced by one header line:

- "=== document <index>: cv ===" — the applicant's CV or résumé.
- "=== document <index>: additional, titled: <title> ===" — a supporting document the applicant
  added, such as a portfolio, a project write-up or a cover letter. The title is the applicant's
  own name for it. Treat its content by the same rules as the CV.

An additional document may be written in Japanese even though the set is English. Quote it in the
language it is written in.

For every claim return:

- document: the index of the document it comes from.
- quote: the applicant's words for the claim, copied exactly as a contiguous passage of that one
  document — same characters, same punctuation, same spacing, no ellipsis, no paraphrase, no
  translation, nothing added. It must never run from one document into another, and never include a
  header line.
- start_hint: roughly where the quote begins, as a character offset from the start of that
  document's text (the line after its header). An estimate is fine.

Return every claim the documents support and nothing they do not. If a passage is not a claim, leave
it out.`;
