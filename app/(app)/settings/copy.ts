import { MAX_DISPLAY_NAME_CHARS, displayNameProblem } from "../../../lib/settings/display-name";

// 10 §17's copy. App-level, so English only (10 §0).

export const SETTINGS_COPY = {
  section: "Settings",
  name: "Name",
  nameCaption: "Shown at the top of every page. Nothing else reads it.",
  email: "Email",
  emailCaption: "Your Google account. It is the only account that can sign in.",
  englishHelp: "English help",
  englishHelpLabel: "Start Japanese practice rounds, and the feedback of every Japanese round, with English shown.",
  englishHelpCaption:
    "Realistic rounds show no English until their feedback, whatever this says. In a round, its English pill switches it for that round only.",
  save: "Save settings",
  saving: "Saving…",
  saved: "Saved.",
} as const;

/** The page's editable fields, as typed or as last saved. */
export interface SettingsFields {
  readonly name: string;
  readonly englishHelp: boolean;
}

/**
 * Why `Save settings` is disabled, or `null` when it is not: the caption under it (10 §17). The name
 * is compared trimmed, the way the route stores it, so trailing spaces alone are not a change.
 */
export function saveBlocker(typed: SettingsFields, saved: SettingsFields): string | null {
  const problem = displayNameProblem(typed.name);
  if (problem === "blank") return "The name cannot be blank.";
  if (problem === "too_long") return `The name is over ${MAX_DISPLAY_NAME_CHARS} characters.`;
  if (typed.name.trim() === saved.name && typed.englishHelp === saved.englishHelp) return "Nothing has changed since the last save.";
  return null;
}
