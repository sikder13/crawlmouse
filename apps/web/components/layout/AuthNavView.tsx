import Link from 'next/link';
import type { UrlObject } from 'url';

const loginHref: UrlObject = { pathname: '/login' };

/**
 * Pure auth slot for the header nav. Signed out → the Login link (also the SSR / no-JS default).
 * Signed in → a glanceable avatar + email disclosure whose only action is Log out: a native <form>
 * POST to the server route (the logout REQUEST itself needs no client JS). Which branch renders is
 * decided by AuthNav from the BROWSER session, so the signed-in menu appears only after client JS runs
 * (with JS disabled a signed-in user sees the Login link) — the deliberate trade for keeping every page
 * statically rendered (no getUser/cookies in the server-rendered Header). Pure → unit-tested without a
 * DOM; React escapes the email.
 */
export function AuthNavView({ email }: { email: string | null }) {
  if (!email) {
    return (
      <Link href={loginHref} className="hover:text-peach transition-colors">
        Login
      </Link>
    );
  }
  const initial = email.trim().charAt(0).toUpperCase() || '?';
  return (
    <details className="group relative [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-2 outline-none transition-colors hover:bg-oat/60 focus-visible:ring-2 focus-visible:ring-peach">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-peach/15 font-display text-sm font-semibold text-accent-text"
        >
          {initial}
        </span>
        <span className="hidden max-w-[12rem] truncate sm:inline">{email}</span>
        <span aria-hidden="true" className="text-ink/40 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-oat bg-cream shadow-lg">
        <p className="truncate border-b border-oat px-4 py-3 text-xs text-ink/60">
          Signed in as <span className="font-medium text-ink">{email}</span>
        </p>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="block w-full px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-oat/60 hover:text-warning"
          >
            Log out
          </button>
        </form>
      </div>
    </details>
  );
}
