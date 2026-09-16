import { requireSession } from "@/lib/auth/session";

// Home, empty until the round screens exist. Protected here as well as in the proxy (08 §5).
export default async function HomePage() {
  await requireSession();
  return <main />;
}
