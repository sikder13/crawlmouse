/**
 * Who a page's header is for (RC-02, F-008): one answer for a person on every page, so the result,
 * the kept pages and the home cannot disagree about whether the same person is signed in.
 *
 * Two ways in, for the two ways a page is rendered:
 *
 * - A page rendered per request reads the session on the server, with `readSessionHeader()`
 *   (`lib/v2/account/session-header-read.ts`, server only). That is `sessionHeaderOf` over the
 *   viewer, and it carries the seat's theme (F-101).
 * - A prerendered page (the v2 home, `/v2-home`; the kept pages) is the same HTML for everyone, so
 *   it cannot. A client island there reads `document.cookie` with `hasSessionCookie`. That is a hint,
 *   not a check: it says a Supabase session cookie is present, and `/dashboard` still decides who
 *   the person is, sending a stale session to sign-in. It carries no theme.
 *
 * Nothing here holds an email, an account id or an account name, so a header built from it cannot
 * show one person's details to another, whatever caches the page.
 *
 * This module has no server-only import, so a client component may import it. It names no label:
 * the header's entry for each state is the shell's own (`LOG_IN` signed out, the account rail's
 * first entry signed in), so the words stay where the shell keeps them.
 */
import type { z } from 'zod';
import type { ThemeSchema } from '@crawlmouse/types/v2';
import type { ViewerResult } from './account/viewer-read';

type Theme = z.infer<typeof ThemeSchema>;

export type SessionHeader =
  | { kind: 'signed_out' }
  | {
      kind: 'signed_in';
      /** The seat's theme; null where it is not known (a hint, or a person with no account). */
      theme: Theme | null;
    };

export const SIGNED_OUT: SessionHeader = Object.freeze({ kind: 'signed_out' });

/**
 * The header for a viewer (`loadViewer`). A person signed in with no v2 account, or with several and
 * none chosen, is still signed in: their header offers the dashboard, which tells them what to do.
 */
export function sessionHeaderOf(viewer: ViewerResult): SessionHeader {
  switch (viewer.kind) {
    case 'signed_out':
      return SIGNED_OUT;
    case 'no_account':
    case 'ambiguous':
      return { kind: 'signed_in', theme: null };
    case 'viewer':
      return { kind: 'signed_in', theme: viewer.viewer.seat.theme };
  }
}

/**
 * The name `@supabase/ssr` gives the session cookie: `sb-<project ref>-auth-token`, split into
 * `.0`, `.1`… when it is long. The PKCE verifier (`…-auth-token-code-verifier`) is not a session.
 */
const SESSION_COOKIE = /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/;

/** One `name=value` pair of a cookie header: the name is everything before the first `=`. */
const COOKIE_PAIR = /^([^=]*)=(.*)$/s;

/**
 * Whether a `Cookie` header (or `document.cookie`) holds a non-empty Supabase session cookie. A hint
 * for a prerendered page's header only: see the module comment.
 */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(';').some((pair) => {
    const m = COOKIE_PAIR.exec(pair);
    return m !== null && m[2]!.trim() !== '' && SESSION_COOKIE.test(m[1]!.trim());
  });
}

/** The header a prerendered page shows once it can read the cookies: no theme, as said above. */
export const sessionHeaderFromCookies = (cookieHeader: string | null | undefined): SessionHeader =>
  hasSessionCookie(cookieHeader) ? { kind: 'signed_in', theme: null } : SIGNED_OUT;
