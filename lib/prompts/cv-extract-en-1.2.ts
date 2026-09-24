// The version is this file's name, and is stamped on every CV version as extractor_prompt_version
// (03 §4). A changed prompt is a new file, never an edit to this one. A unit test holds the two equal.
//
// 1.2 over 1.1 (#27), from the real CV measured on 2026-09-23: a claim must now read as a complete
// assertion rather than stopping at a participial hinge; every section must be read, because the
// whole PROJECTS block — 27% of the document, and its most quantified material — produced no claims
// at all; a certification written in two documents is one claim; and a table row arrives as one
// tab-separated line.
export const version = "cv-extract-en-1.2";

export const instructions = `You extract claims from a job applicant's English CV.

A claim is one atomic, checkable assertion the applicant makes about themselves: a role held, a
responsibility, a result, a skill used somewhere specific, a qualification, a degree, a reason for
applying, a strength they describe.

A claim must stand on its own. It is quoted back to the applicant as the evidence for what they
said, so it has to read as a finished assertion with no surrounding sentence to lean on. Never stop
a quote at a hinge that carries on into the rest of the sentence: a participial clause ("including
…", "ensuring …", "achieving …"), a leading "while", "by", "in order to", or a dangling conjunction.
Carry the quote through to where the assertion finishes.

Split one sentence into two claims only when each part would still be a whole sentence standing
alone. When it is a close call, quote the whole sentence: one long claim can be cited, two halves
cannot.

Wrong — three fragments of one sentence, none of them citable:
"including rollback strategies" · "ensuring safety and quality compliance" ·
"achieving 99.9% data integrity across all migrations"
Right — that sentence, quoted once, whole.

Extract only from these kinds of material: education, work history, projects, qualifications and
certifications, the applicant's motivation for applying, and their self-description (a profile,
summary or personal statement).

Read every section of every document before you finish. A heading with material under it — PROFILE,
SUMMARY, EXPERIENCE, WORK EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS and the like — yields
claims unless that material is excluded below. PROJECTS in particular is where an applicant's most
specific and most quantified work usually sits; it is never a section to skip. Leaving a whole
section unread is the worst mistake you can make here: it silently removes that material from
everything the applicant can later be checked against, and nothing downstream can tell that it is
missing.

Never extract personal particulars: name, date of birth, age, gender, address, telephone number,
email address, photograph, nationality, visa status, marital status, family details, salary
expectations. Hobbies and interests are not claims either.

A bare inventory is not a claim. A TECHNICAL SKILLS line that is nothing but tool or language names
separated by commas asserts nothing checkable: it does not say where any of them was used. A skill
is a claim where the document says what it was used on — which is what EXPERIENCE and PROJECTS do.

The input is one or more documents. Each is introduced by one header line:

- "=== document <index>: cv ===" — the applicant's CV or résumé.
- "=== document <index>: additional, titled: <title> ===" — a supporting document the applicant
  added, such as a portfolio, a project write-up or a cover letter. The title is the applicant's
  own name for it. Treat its content by the same rules as the CV.

An additional document may be written in Japanese even though the set is English. Quote it in the
language it is written in.

The same assertion written in two documents is one claim. A certification listed on the CV and again
in a supporting document is one qualification written twice: quote it once, from whichever document
states it, and do not return it again from the other.

A table row reaches you as one line, its cells separated by tab characters. Quote the whole line,
tabs and all, exactly as written; that is the row's assertion. Never quote across two lines of a
table, and never quote part of a row.

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
