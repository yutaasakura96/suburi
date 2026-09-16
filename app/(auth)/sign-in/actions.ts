"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

// Public by nature: it only starts the Google flow. Both refusals come back to /sign-in with ?error=.
export async function signInWithGoogle() {
  const { url } = await getAuth().api.signInSocial({
    body: { provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" },
    headers: await headers(),
  });
  if (!url) throw new Error("Better Auth returned no Google authorization URL.");
  redirect(url);
}
