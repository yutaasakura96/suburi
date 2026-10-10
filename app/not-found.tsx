import { AppHeader } from "./(app)/app-header";

/** Any path that is not a screen, and a `notFound()` from one that has no row to show (07 §1). */
export default function NotFound() {
  return (
    <main className="w-[1280px] px-[44px] py-[40px]">
      <section className="border border-rule-frame bg-surface" aria-label="Not found">
        <AppHeader active={null} />
        <div className="px-[32px] py-[36px]">
          <h1 className="text-[15px] text-ink-3">There is nothing at this address.</h1>
        </div>
      </section>
    </main>
  );
}
