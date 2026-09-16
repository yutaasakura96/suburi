import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "./actions";

export const metadata: Metadata = {
  title: "Sign in — Suburi",
};

/**
 * The refusal line, 03 §8: "This account cannot sign in." with no enumeration of why.
 *
 * The slot reserves its height so nothing moves when the line appears. Any `?error=` sets it: both
 * refusals (no user row, and not ALLOWED_EMAIL) land here and read the same. Japanese sits above
 * English, as everywhere on this page (06, 2026-09-16) — the page shows both languages so it does
 * not decide the open bilingual chrome rule (10 §12).
 */
function RefusalSlot({ refused }: { refused: boolean }) {
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
export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { error } = await searchParams;

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

        {/* 05 §5.7 — one 48px primary button, its caption 12px --ink-6 twelve pixels beneath it. */}
        <form
          action={signInWithGoogle}
          className="flex flex-col gap-[12px] px-[32px] pt-[36px] pb-[32px]"
        >
          <Button type="submit" className="w-full">
            <span lang="ja">Googleでログイン</span>
          </Button>
          <p className="text-[12px] leading-[1.7] text-ink-6">Sign in with Google</p>
          <RefusalSlot refused={error !== undefined} />
        </form>
      </div>
    </main>
  );
}
