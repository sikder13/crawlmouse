import Link from 'next/link';
import type { UrlObject } from 'url';

const r = (p: string): UrlObject => ({ pathname: p });

/**
 * Mobile-only (sm:hidden) nav — a hamburger <details> disclosure (no client JS, accessible, matching
 * the AuthNavView / FixChecklist pattern) that collapses Pricing + Dashboard + the auth control so the
 * header fits a ~390px phone. Signed out → a Login link; signed in → "Signed in as {email}" + a Log out
 * native <form> POST (the same robust server logout as the desktop control). `email` comes from
 * HeaderNav's single browser-session read. Pure → unit-tested; React escapes the email.
 */
export function MobileMenuView({ email }: { email: string | null }) {
  const item = 'block rounded-control px-3 py-2 text-body text-ink transition-colors hover:bg-oat/60';
  return (
    <details className="group relative sm:hidden [&_summary::-webkit-details-marker]:hidden">
      <summary
        aria-label="Menu"
        className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-control text-ink outline-none transition-colors hover:bg-oat/60 focus-visible:ring-2 focus-visible:ring-peach"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-oat bg-cream p-1.5 shadow-lg">
        <Link href={r('/pricing')} className={item}>Pricing</Link>
        <Link href={r('/dashboard')} className={item}>Dashboard</Link>
        <div className="my-1 border-t border-oat" />
        {email ? (
          <>
            <p className="truncate px-3 py-2 text-caption text-ink-muted">
              Signed in as <span className="font-medium text-ink">{email}</span>
            </p>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className={`${item} w-full text-left hover:text-warning`}>
                Log out
              </button>
            </form>
          </>
        ) : (
          <Link href={r('/login')} className={item}>Login</Link>
        )}
      </div>
    </details>
  );
}
