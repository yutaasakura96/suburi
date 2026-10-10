"use client";

import { Button } from "@/components/ui/button";
import { AppHeader } from "./app-header";

/**
 * A screen that threw. Nothing of the error is shown or logged here (AGENTS.md: ids, counts and error
 * classes only); the header keeps the way back to Home.
 */
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section className="border border-rule-frame bg-surface" aria-label="Error">
        <AppHeader active={null} />
        <div className="flex flex-col items-start gap-[14px] px-[32px] py-[36px]">
          <h1 className="text-[15px] text-ink-3">Something went wrong.</h1>
          <Button type="button" onClick={() => retry()}>
            Try again
          </Button>
        </div>
      </section>
    </main>
  );
}
