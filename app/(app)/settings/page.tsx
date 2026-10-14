import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/settings/settings";
import { AppHeader } from "../app-header";
import { SETTINGS_COPY } from "./copy";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Settings — Suburi",
};

/**
 * The settings page (10 §17): the user's own settings, and nothing a model reads. Reached from the
 * name in the app header, not the nav. No career or personal field, no default round choices, and no
 * delete, export or share control (10 §17, refuses).
 */
export default async function SettingsPage() {
  const userId = await requireSession();
  const settings = await loadSettings(getDb(), userId);

  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section aria-labelledby="settings-heading" className="border border-rule-frame bg-surface">
        <AppHeader active="settings" />
        <div className="border-b border-rule-frame px-[32px] py-[20px]">
          <h1 id="settings-heading" className="font-mono text-[11px] tracking-[0.16em] text-ink-label uppercase">
            {SETTINGS_COPY.section}
          </h1>
        </div>
        <div className="px-[32px] pt-[26px] pb-[32px]">
          <SettingsForm displayName={settings.displayName} email={settings.email} />
        </div>
      </section>
    </main>
  );
}
