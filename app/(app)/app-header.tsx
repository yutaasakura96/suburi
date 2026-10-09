import Link from "next/link";

// No "use client": Setup's form renders it on the client, the other screens on the server.

const NAV = [
  { key: "home", href: "/", label: "Home" },
  { key: "progress", href: "/progress", label: "Progress" },
  { key: "history", href: "/history", label: "History" },
  { key: "cv", href: "/cv", label: "CV" },
] as const;

export type NavItem = (typeof NAV)[number]["key"];

/**
 * 05 §5.1: the wordmark and the four-item nav, the top of every app-level screen's card. A round's
 * own screens carry the round header instead (05 §5.2) — there is no navigation out of a live round.
 * The status page is reached from Home's status line and is not an item here (10 §14). A screen that
 * is none of the four (status, a round's feedback, an error) passes `null`: the nav is still there,
 * with no item current.
 */
export function AppHeader({ active }: { active: NavItem | null }) {
  return (
    <header className="flex items-center justify-between border-b border-rule-frame px-[32px] py-[20px]">
      <div className="flex items-baseline gap-[14px]">
        <span lang="ja" className="text-[21px] font-semibold tracking-[0.06em]">
          素振り
        </span>
        <span className="font-mono text-[11px] tracking-[0.18em] text-ink-label uppercase">Suburi</span>
      </div>
      <nav aria-label="Main" className="flex gap-[28px] text-[13px]">
        {NAV.map((item) =>
          item.key === active ? (
            <Link key={item.key} href={item.href} aria-current="page" className="border-b-2 border-mark pb-[2px] text-ink-1">
              {item.label}
            </Link>
          ) : (
            <Link key={item.key} href={item.href} className="pb-[4px] text-ink-4 hover:text-ink-1">
              {item.label}
            </Link>
          ),
        )}
      </nav>
    </header>
  );
}
