import type { NextResponse } from 'next/server';

/**
 * Mark a response that carries a Set-Cookie auth token as private + no-store, so no shared/CDN cache
 * can ever retain one user's session token. `@supabase/ssr` surfaces exactly these headers as the
 * second `setAll` argument; middleware (updateSession) applies them when IT rotates a session, but
 * route handlers that mint or clear a session (e.g. /login/verify) write cookies through Next's
 * `cookies()` store — which has no handle to set response headers — so they mark their own response
 * with this helper. On Vercel, Set-Cookie responses are not edge-cached, so this is defense-in-depth.
 */
export function applyNoStore<T extends NextResponse>(res: T): T {
  res.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  res.headers.set('Pragma', 'no-cache');
  res.headers.set('Expires', '0');
  return res;
}
