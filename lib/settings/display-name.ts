import { characterLength } from "../cv/spans";

/**
 * The display name's bounds (`04` `users`, `07` §5.21): trimmed, 1–80 **code points**, the unit every
 * other text cap here is stated in. Shared by the route and the settings page, so the save button is
 * disabled for exactly what the route would refuse.
 */
export const MAX_DISPLAY_NAME_CHARS = 80;

export type DisplayNameProblem = "blank" | "too_long";

export function displayNameProblem(raw: string): DisplayNameProblem | null {
  const length = characterLength(raw.trim());
  if (length === 0) return "blank";
  if (length > MAX_DISPLAY_NAME_CHARS) return "too_long";
  return null;
}
