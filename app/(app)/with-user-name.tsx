import { currentUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadSettings } from "@/lib/settings/settings";
import { UserNameProvider } from "./user-name";

/**
 * Reads the signed-in user's display name for the app header. No session is no name, never a
 * redirect: the page under it decides that (08 §5).
 */
export async function WithUserName({ children }: { children: React.ReactNode }) {
  const userId = await currentUserId();
  const settings = userId ? await loadSettings(getDb(), userId) : undefined;
  return <UserNameProvider name={settings?.displayName ?? null}>{children}</UserNameProvider>;
}
