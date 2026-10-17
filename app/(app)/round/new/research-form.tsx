"use client";

import { useState } from "react";
import { TextButton } from "@/components/import-control";
import { Button } from "@/components/ui/button";
import { ERROR_COPY } from "@/lib/copy/errors";
import { characterLength } from "@/lib/cv/spans";
import { sameCompany, sameJob } from "@/lib/round/job-name";
import { MAX_POSTING_CHARS } from "@/lib/round/limits";
import { WaitLine } from "../[roundId]/wait-line";
import { failureText, postJson, type FailureCode } from "../api";
import { SETUP_COPY as COPY } from "../copy";
import type { PostingOption } from "../load";
import { CalloutRail, caption, sectionLabel } from "../parts";
import { capPostingName, field, inert, lineInput, savedOption } from "./setup-parts";

/** 07 §5.22's answer: the names as the route trimmed them, and the draft exactly as returned. */
interface Draft {
  readonly companyName: string;
  readonly roleTitle: string;
  readonly text: string;
}

type Phase = "naming" | "asking" | "researching" | "editing" | "saving";

/** A source in the notes that is a link (07 §5.22: `[https://…]` after its fact), once each. */
function linksIn(notes: string) {
  return [...new Set(Array.from(notes.matchAll(/\[(https?:\/\/[^\]\s]+)\]/g), (match) => match[1]))];
}

/**
 * Setup's research card (10 §2, US-16; 06, R1 to R5). A company and a role title go to the research
 * route, which saves nothing; its English notes come back into an editable box, each fact with its
 * source and the role part marked as a guess. **Saving fixes the edited notes as a new role context,
 * the draft kept beside them** (R3); like a posting, a saved research is never edited.
 *
 * **A saved posting wins** (R4, US-2), on the very comparison the routes refuse on (`job-name.ts`): the
 * same job is not researched and the callout says the posting is used; the same company under another
 * title is asked about before anything is researched.
 */
export function ResearchForm({
  postings,
  onSaved,
  onCancel,
  onUsePosting,
}: {
  postings: readonly PostingOption[];
  onSaved: (research: PostingOption) => void;
  /** Closes the form; none while no research is saved, when the form is the card's only content. */
  onCancel: (() => void) | null;
  onUsePosting: (postingId: string) => void;
}) {
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("naming");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ step: "research" | "save"; code: FailureCode } | null>(null);

  const named = company.trim() !== "" && title.trim() !== "";
  const names = { companyName: company, roleTitle: title };
  // R4: postings are newest first, so the first match is the newest, as the routes name it.
  const samePosting = named && phase === "naming" ? (postings.find((posting) => sameJob(posting, names)) ?? null) : null;
  const sameCompanyPostings = named ? postings.filter((posting) => sameCompany(posting, names)) : [];

  const chars = characterLength(notes.trim());
  const over = chars > MAX_POSTING_CHARS;
  const savable = notes.trim() !== "" && !over;
  // Asked whether it is the same job, the names can still be changed, which withdraws the question.
  const locked = phase !== "naming" && phase !== "asking";

  function rename(set: (value: string) => void, value: string) {
    set(capPostingName(value));
    setPhase("naming");
  }

  function research() {
    if (sameCompanyPostings.length > 0) {
      setPhase("asking");
      return;
    }
    void run();
  }

  async function run() {
    setPhase("researching");
    setError(null);
    const result = await postJson<{ company_name: string; role_title: string; draft: string }>("/api/role-contexts/research", {
      company_name: company,
      role_title: title,
    });
    if (!result.ok) {
      setError({ step: "research", code: result.code });
      setPhase("naming");
      return;
    }
    setDraft({ companyName: result.json.company_name, roleTitle: result.json.role_title, text: result.json.draft });
    setNotes(result.json.draft);
    setPhase("editing");
  }

  async function save() {
    if (!draft) return;
    setPhase("saving");
    setError(null);
    const saved = await postJson<{ id: string; company_name: string; role_title: string; source_filename: string | null; created_at: string }>(
      "/api/role-contexts",
      { kind: "researched", company_name: draft.companyName, role_title: draft.roleTitle, body: notes, research_draft: draft.text },
    );
    if (!saved.ok) {
      setError({ step: "save", code: saved.code });
      setPhase("editing");
      return;
    }
    onSaved(savedOption(saved.json));
  }

  function startOver() {
    setCompany("");
    setTitle("");
    setDraft(null);
    setNotes("");
    setError(null);
    setPhase("naming");
  }

  const errorText = error
    ? error.step === "save" && error.code === "role_context_too_large"
      ? COPY.notesTooLong
      : failureText(error.code, "en")
    : null;
  const links = linksIn(notes);
  const cancel = onCancel ?? (draft ? startOver : null);

  return (
    <div role="group" aria-label={COPY.newResearch} className="flex flex-col gap-[16px]" data-testid="research-form">
      <div className="grid grid-cols-2 gap-[24px]">
        <label className="flex flex-col gap-[8px]">
          <span className={sectionLabel}>{COPY.company}</span>
          <input value={company} onChange={(event) => rename(setCompany, event.target.value)} disabled={locked} className={lineInput} />
        </label>
        <label className="flex flex-col gap-[8px]">
          <span className={sectionLabel}>{COPY.roleTitle}</span>
          <input value={title} onChange={(event) => rename(setTitle, event.target.value)} disabled={locked} className={lineInput} />
        </label>
      </div>

      {samePosting ? (
        <div className="flex flex-col gap-[10px]" data-testid="research-precedence">
          <CalloutRail tone="information">{ERROR_COPY.research_posting_exists.en}</CalloutRail>
          <div>
            <TextButton label={COPY.usePosting} onClick={() => onUsePosting(samePosting.id)} />
          </div>
        </div>
      ) : null}

      {phase === "asking" ? (
        <div className="flex flex-col gap-[12px]" data-testid="research-same-company">
          <p className="text-[13px] leading-[1.75] text-ink-2" role="status">
            {COPY.sameCompanyAsk(
              sameCompanyPostings[0]?.companyName ?? company,
              sameCompanyPostings.map((posting) => posting.roleTitle),
            )}
          </p>
          <div className="flex flex-wrap items-center gap-[20px]">
            {sameCompanyPostings.map((posting) => (
              <TextButton key={posting.id} label={COPY.sameJobYes(posting.roleTitle)} onClick={() => onUsePosting(posting.id)} />
            ))}
            <TextButton label={COPY.sameJobNo} onClick={() => void run()} />
          </div>
        </div>
      ) : null}

      {phase === "researching" ? <WaitLine testId="research-wait" sentence={COPY.researching} hint={COPY.researchingHint} segments={["running"]} /> : null}

      {draft && (phase === "editing" || phase === "saving") ? (
        <div className="flex flex-col gap-[8px]">
          <label htmlFor="research-notes" className={sectionLabel}>
            {COPY.notes}
          </label>
          <p className={caption}>{COPY.notesExplained}</p>
          <textarea
            id="research-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={phase === "saving"}
            rows={16}
            className={`${field} resize-y`}
          />
          <p
            className={`text-right font-mono text-[11px] ${over ? "font-medium text-attention-ink" : "text-ink-label"}`}
            data-testid="research-count"
            data-over={over}
          >
            {COPY.postingCount(chars, MAX_POSTING_CHARS)}
          </p>
          {links.length > 0 ? (
            <div className="flex flex-col gap-[6px]" data-testid="research-links">
              <p className={sectionLabel}>{COPY.notesLinks}</p>
              <ul className="flex flex-col gap-[2px]">
                {links.map((link) => (
                  <li key={link} className="truncate font-mono text-[11px]">
                    <a href={link} target="_blank" rel="noreferrer" className="text-link hover:text-link-hover hover:underline">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {errorText ? <CalloutRail tone="attention">{errorText}</CalloutRail> : null}

      {draft ? (
        <div className="flex items-center gap-[20px]">
          <Button variant="outline" onClick={save} disabled={!savable || phase === "saving"} className={savable ? "" : inert}>
            {COPY.saveResearch}
          </Button>
          {cancel ? <TextButton label={COPY.cancel} onClick={cancel} disabled={phase === "saving"} /> : null}
        </div>
      ) : samePosting || phase === "asking" ? null : (
        <div className="flex items-center gap-[20px]">
          <Button variant="outline" onClick={research} disabled={!named || phase === "researching"} className={named && phase !== "researching" ? "" : inert}>
            {COPY.runResearch}
          </Button>
          {onCancel ? <TextButton label={COPY.cancel} onClick={onCancel} disabled={phase === "researching"} /> : null}
        </div>
      )}
      {draft ? (
        <p className={caption}>{phase === "saving" ? COPY.savingResearch : COPY.saveResearchCommits}</p>
      ) : phase === "naming" && !samePosting ? (
        <p className={caption}>{COPY.runResearchCommits}</p>
      ) : null}
    </div>
  );
}
