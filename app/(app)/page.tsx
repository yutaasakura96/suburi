import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loadStatus } from "@/lib/monitor/status";
import { statusLine } from "./status/copy";
import { StatusLine } from "./status/status-line";

// Home, until the Due list and first attempts arrive (#51): its status line and the way into a round
// (10 §1). Protected here as well as in the proxy (08 §5).
export default async function HomePage() {
  const userId = await requireSession();
  const line = statusLine(await loadStatus(getDb(), userId, new Date()));
  return (
    <main className="flex w-[1280px] flex-col gap-[14px] px-[44px] py-[40px]">
      {line ? <StatusLine line={line} /> : null}
      <section className="flex flex-col items-start gap-[10px] border border-rule-frame bg-surface px-[32px] py-[30px]">
        <Link href="/round/new" className={buttonVariants()}>
          Start a round
        </Link>
        <p className="text-[12px] leading-[1.6] text-ink-6">Defaults to HR · English · realistic · 3. Type and length can be changed.</p>
      </section>
    </main>
  );
}
