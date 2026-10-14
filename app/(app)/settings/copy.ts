import { MAX_DISPLAY_NAME_CHARS, displayNameProblem } from "../../../lib/settings/display-name";

// 10 §17's copy. App-level, so English only (10 §0).

export const SETTINGS_COPY = {
  section: "Settings",
  name: "Name",
  nameCaption: "Shown at the top of every page. Nothing else reads it.",
  email: "Email",
  emailCaption: "Your Google account. It is the only account that can sign in.",
  save: "Save settings",
  saving: "Saving…",
  saved: "Saved.",
} as const;

/**
 * Why `Save settings` is disabled, or `null` when it is not: the caption under it (10 §17). The name
 * is compared trimmed, the way the route stores it, so trailing spaces alone are not a change.
 */
export function saveBlocker(typed: string, saved: string): string | null {
  const problem = displayNameProblem(typed);
  if (problem === "blank") return "The name cannot be blank.";
  if (problem === "too_long") return `The name is over ${MAX_DISPLAY_NAME_CHARS} characters.`;
  if (typed.trim() === saved) return "Nothing has changed since the last save.";
  return null;
}
