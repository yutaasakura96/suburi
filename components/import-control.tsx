"use client";

import { useRef, useState } from "react";
import type { ImportResult } from "@/lib/cv/import/extract";

// The importer's control, shared by the CV screen's document boxes (10 §13) and Setup's posting box
// (10 §2): wherever a box takes text that may come from a .docx or .pdf.

/** `07` §5.2's cap on `source_filename`, in UTF-16 units as Zod counts it. */
const MAX_FILENAME = 255;

/** Cut to the cap without leaving half a surrogate pair at the end. */
export function capFilename(name: string) {
  const cut = name.slice(0, MAX_FILENAME);
  return /[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut;
}

// Extensions and MIME types both: a picker filters on either, depending on the platform.
const IMPORT_ACCEPT =
  ".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const sectionLabel = "font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase";

// A text control, not a 05 §5.7 button: 05 draws no quiet variant, and a 48px outline beside every
// box would outweigh the box. Used for `外す`, for import, and for Setup's `Add a posting`. Removing
// a document from an unsaved draft deletes nothing stored.
export function TextButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${sectionLabel} hover:text-ink-2 hover:underline disabled:opacity-50 disabled:hover:no-underline`}
    >
      {label}
    </button>
  );
}

/**
 * `ファイルから読み込む` / `Import from a file` (10 §13): the text is extracted **in the browser** and
 * replaces the box's text, which stays editable; the file itself is never sent (07 §5.2). What is
 * saved is whatever the user leaves in the box.
 */
export function ImportControl({ label, onResult, disabled = false }: { label: string; onResult: (result: ImportResult, name: string) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again is a new import.
    event.target.value = "";
    if (!file) return;
    setReading(true);
    try {
      const { extractText } = await import("@/lib/cv/import/extract");
      onResult(await extractText(file), file.name);
    } catch {
      onResult({ ok: false, reason: "unreadable" }, file.name);
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      <TextButton label={label} disabled={reading || disabled} onClick={() => input.current?.click()} />
      <input ref={input} type="file" accept={IMPORT_ACCEPT} onChange={picked} disabled={disabled} hidden tabIndex={-1} />
    </>
  );
}
