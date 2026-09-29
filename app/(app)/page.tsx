import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadStatus } from "@/lib/monitor/status";
import { statusLine } from "./status/copy";
import { StatusLine } from "./status/status-line";

// Home, empty until the round screens exist but for its status line (10 §1). Protected here as well
// as in the proxy (08 §5).
export default async function HomePage() {
  const userId = await requireSession();
  const line = statusLine(await loadStatus(getDb(), userId, new Date()));
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {line ? <StatusLine line={line} /> : null}
    </main>
  );
}
