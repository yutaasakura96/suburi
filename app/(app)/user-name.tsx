"use client";

import Link from "next/link";
import { createContext, useContext, useState } from "react";

interface UserName {
  readonly name: string | null;
  readonly setName: (name: string) => void;
}

const UserNameContext = createContext<UserName>({ name: null, setName: () => {} });

/**
 * The display name the app header shows (05 §5.1), loaded once by the `(app)` layout. Context rather
 * than a prop on every screen, because Setup's form and the error boundary render the header on the
 * client; and state, so a save on `/settings` changes the header at once (10 §17).
 */
export function UserNameProvider({ name, children }: { name: string | null; children: React.ReactNode }) {
  const [current, setCurrent] = useState(name);
  // A fresh read from the server (a refresh, a navigation that re-renders the layout) wins.
  const [loaded, setLoaded] = useState(name);
  if (name !== loaded) {
    setLoaded(name);
    setCurrent(name);
  }
  return <UserNameContext value={{ name: current, setName: setCurrent }}>{children}</UserNameContext>;
}

export function useUserName() {
  return useContext(UserNameContext);
}

/**
 * The name at the right of the app header: the way to `/settings`, not a fifth nav item (05 §5.1).
 * Nothing renders without a signed-in user, as on a 404 outside the app's layout.
 */
export function HeaderName({ current }: { current: boolean }) {
  const { name } = useUserName();
  if (name === null) return null;
  return (
    <>
      <span aria-hidden className="h-[14px] w-px bg-rule-row" />
      <Link
        href="/settings"
        title={name}
        aria-current={current ? "page" : undefined}
        className={`block max-w-[200px] truncate ${
          current ? "border-b-2 border-mark pb-[2px] text-ink-1" : "pb-[4px] text-ink-4 hover:text-ink-1"
        }`}
      >
        {name}
      </Link>
    </>
  );
}
