"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/api/errors";
import { ERROR_COPY } from "@/lib/copy/errors";
import { useUserName } from "../user-name";
import { SETTINGS_COPY as copy, saveBlocker } from "./copy";

const caption = "text-[12px] leading-[1.7] text-ink-6";
const rowGrid = "grid grid-cols-[200px_minmax(0,1fr)] py-[16px]";
const fieldName = "text-[13px] text-ink-4";

/**
 * 10 §17's rows and its one write. The email is shown, never sent: it is Google's and the
 * allowlist's (07 §5.21). A failure keeps what was typed.
 */
export function SettingsForm({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const { setName } = useUserName();
  const [saved, setSaved] = useState(displayName);
  const [typed, setTyped] = useState(displayName);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<{ code: ErrorCode; nameRefused: boolean } | null>(null);

  const blocker = saveBlocker(typed, saved);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || blocker) return;
    setSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: typed }),
      });
      const json = await response.json();
      if (!response.ok) {
        const code: ErrorCode = json.error?.code in ERROR_COPY ? json.error.code : "write_failed";
        const fields: unknown = json.error?.detail?.fields;
        setError({ code, nameRefused: Array.isArray(fields) && fields.includes("display_name") });
        return;
      }
      const stored: string = json.settings.display_name;
      setSaved(stored);
      setTyped(stored);
      setName(stored);
      setJustSaved(true);
      router.refresh();
    } catch {
      setError({ code: "write_failed", nameRefused: false });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col">
      <div className="divide-y divide-rule-hairline">
        <div className={rowGrid}>
          <label htmlFor="settings-name" className={fieldName}>
            {copy.name}
          </label>
          <div className="flex flex-col gap-[6px]">
            <input
              id="settings-name"
              type="text"
              value={typed}
              aria-describedby="settings-name-caption"
              aria-invalid={error?.nameRefused || undefined}
              onChange={(event) => {
                setTyped(event.target.value);
                setJustSaved(false);
              }}
              className="w-[360px] border border-rule-frame bg-surface px-[12px] py-[8px] text-[14px] text-ink-1 outline-none focus:border-ink-4 aria-invalid:border-attention-mark"
            />
            <p id="settings-name-caption" className={caption}>
              {copy.nameCaption}
            </p>
          </div>
        </div>
        <div className={rowGrid}>
          <span className={fieldName}>{copy.email}</span>
          <div className="flex flex-col gap-[6px]">
            <p className="text-[14px] text-ink-3">{email}</p>
            <p className={caption}>{copy.emailCaption}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-start gap-[12px] pt-[16px]">
        {error ? (
          <div className="flex gap-[10px]" role="status">
            <span aria-hidden className="w-[3px] shrink-0 self-stretch bg-attention-mark" />
            <p className="text-[12px] leading-[1.7] text-ink-3">{ERROR_COPY[error.code].en}</p>
          </div>
        ) : null}
        <div className="flex items-center gap-[14px]">
          <Button type="submit" disabled={saving || blocker !== null}>
            {copy.save}
          </Button>
          <p className={caption} role="status">
            {saving ? copy.saving : justSaved ? copy.saved : ""}
          </p>
        </div>
        {!saving && !justSaved && blocker ? <p className={caption}>{blocker}</p> : null}
      </div>
    </form>
  );
}
