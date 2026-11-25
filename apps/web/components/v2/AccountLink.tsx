'use client';

import { useEffect, useState } from 'react';
import { hasSessionCookie } from '../../lib/v2/session-header';
import { Button } from './Button';
import { LOG_IN } from './footer-links';

/** Where a signed-in person goes from a public page's header (D-27). */
export const DASHBOARD_LINK = { label: 'Dashboard', href: '/dashboard' } as const;

/**
 * Whether this browser may hold a session: a non-empty Supabase session cookie, by the rule the
 * prerendered pages' header hint already uses (`hasSessionCookie`). A stranger has none, so a public
 * page sends them no request at all.
 */
export const mayBeSignedIn = (cookie: string): boolean => hasSessionCookie(cookie);

/**
 * Whether the session is live, asked of the existing signed-in GET: 200 for a person signed in,
 * 401 otherwise. Any other answer, or a failure, reads as signed out.
 */
export async function signedIn(
  fetcher: typeof fetch = fetch,
  cookie: string = document.cookie,
): Promise<boolean> {
  if (!mayBeSignedIn(cookie)) return false;
  try {
    const res = await fetcher('/api/billing/status', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * A public page's header link (D-27). It renders "Log in" on the server, as the page always has, so
 * a prerendered page's HTML is the same for everyone; after load it asks whether this browser is
 * signed in and, if it is, becomes "Dashboard". No server component reads a cookie for it.
 */
export function AccountLink() {
  const [account, setAccount] = useState(false);
  useEffect(() => {
    let live = true;
    void signedIn().then((yes) => {
      if (live && yes) setAccount(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const link = account ? DASHBOARD_LINK : LOG_IN;
  return (
    <Button variant="quiet" href={link.href}>
      {link.label}
    </Button>
  );
}
