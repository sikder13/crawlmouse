import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { applyNoStore } from '@/lib/supabase/no-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign-out — the inverse of /login/verify. Runs server-side so it genuinely INVALIDATES the session.
 *
 * Two steps, and the SECOND is the real guarantee:
 *  1. Best-effort revoke the refresh token with the Auth server (scope:'local' = just this device's
 *     session — a conventional per-device logout, not a sign-out-everywhere).
 *  2. UNCONDITIONALLY expire the sb-*-auth-token cookies on the response. This is load-bearing:
 *     @supabase/auth-js returns from signOut() BEFORE clearing the local session cookies when the
 *     revoke call fails with a non-401/403/404 error (a transient network blip / Auth 5xx), and it
 *     can even throw — so signOut() alone does NOT reliably clear the cookies. Clearing them here
 *     ourselves makes "logged out on this device" true even when Auth is unreachable, which is the
 *     whole point of a shared/public-device logout.
 *
 * 303 → the browser re-issues a GET for '/'. no-store: the cookie-clearing Set-Cookie response must
 * never be cached (middleware can't backstop it — by the time it returns there is no auth cookie).
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  // Normalize a throw into a value so neither a returned { error } nor a thrown rejection can skip the
  // cookie clear below.
  const { error } = await sb.auth.signOut({ scope: 'local' }).catch((e: unknown) => ({ error: e }));
  if (error) console.error('[logout] sign-out revoke failed; clearing session cookies locally regardless');

  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith('sb-') && name.includes('auth-token')) store.delete(name);
  }

  const origin = new URL(req.url).origin;
  return applyNoStore(NextResponse.redirect(new URL('/', origin), 303));
}
