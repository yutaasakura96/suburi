import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Sign in — Suburi",
};

/**
 * The refusal line, 03 §8: "This account cannot sign in." with no enumeration of why.
 *
 * #4 renders the slot and reserves its height so nothing moves when the line appears; what sets
 * `refused` is #6's business. Japanese sits above English, as everywhere on this page (06,
 * 2026-09-16) — the page shows both languages so it does not decide the open bilingual chrome rule
 * (10 §12).
 */
function RefusalSlot({ refused = false }: { refused?: boolean }) {
  return (
    <div className="min-h-[46px]" role="status" aria-live="polite">
      {refused ? (
        <>
          <p lang="ja" className="text-[13px] leading-[1.7] text-attention-ink">
            このアカウントではログインできません。
          </p>
          <p className="text-[12px] leading-[1.7] text-attention-ink">
            This account cannot sign in.
          </p>
        </>
      ) : null}
    </div>
  );
}

// Desktop only, stated rather than degraded (CONTEXT.md): fixed widths, no breakpoints.
export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center px-[44px] py-[40px]">
      <div className="w-[480px] border border-rule-frame bg-surface">
        {/* 05 §5.1 — the wordmark, baseline-aligned with the mono lockup */}
        <div className="flex items-baseline gap-[14px] border-b border-rule-frame px-[32px] py-[20px]">
          <span lang="ja" className="text-[21px] font-semibold tracking-[0.06em]">
            素振り
          </span>
          <span className="font-mono text-[11px] tracking-[0.18em] text-ink-label uppercase">
            Suburi
          </span>
        </div>

        {/* 05 §5.7 — one 48px primary button, its caption 12px --ink-6 twelve pixels beneath it.
            The button is not wired to Better Auth until #6. */}
        <div className="flex flex-col gap-[12px] px-[32px] pt-[36px] pb-[32px]">
          <Button type="button" className="w-full">
            <span lang="ja">Googleでログイン</span>
          </Button>
          <p className="text-[12px] leading-[1.7] text-ink-6">Sign in with Google</p>
          <RefusalSlot />
        </div>
      </div>
    </main>
  );
}
