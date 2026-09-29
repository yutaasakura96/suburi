import Link from "next/link";

/**
 * Home's status line (10 §1): a 05 §5.8 attention rail above the cards, one sentence and a link.
 * Rendered only when something is wrong; nothing at all otherwise.
 */
export function StatusLine({ line }: { line: string }) {
  return (
    <div className="flex gap-[10px]" role="status" data-testid="home-status-line">
      <span aria-hidden className="w-[3px] shrink-0 self-stretch bg-attention-mark" />
      <p className="text-[12px] leading-[1.7] text-ink-3">
        {line}{" "}
        <Link href="/status" className="text-link hover:text-link-hover hover:underline">
          Open the status page
        </Link>
      </p>
    </div>
  );
}
