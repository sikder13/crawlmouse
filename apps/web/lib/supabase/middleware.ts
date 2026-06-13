import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Upper bound on the middleware Auth round-trip so a hung Auth endpoint can't stall Edge TTFB. */
const AUTH_REFRESH_TIMEOUT_MS = 1500;

/** Seam: build the auth client from request-bound cookie methods. Injectable for tests. */
export type CreateMiddlewareClient = (cookies: CookieMethodsServer) => {
  auth: { getUser: () => Promise<unknown> };
};

const defaultCreateClient: CreateMiddlewareClient = (cookies) =>
  createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies },
  );

/** True when the request carries a Supabase auth cookie (`sb-<ref>-auth-token[.n]`). */
function hasSupabaseAuthCookie(req: NextRequest): boolean {
  return req.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'));
}

/**
 * Refresh the Supabase session in middleware — a context where cookie writes ARE allowed —
 * so a logged-in visitor's rotated tokens are persisted on the response BEFORE any Server
 * Component renders. This is the durable half of the CRAWLMOUSE-7/-8 fix: with the session
 * already fresh, /dashboard's render never has to write cookies (which Next 15 forbids).
 *
 * Cost discipline (≤18% MRR): anonymous requests carry no auth cookie and have nothing to
 * refresh, so we skip the Auth round-trip entirely instead of calling getUser() on every
 * (mostly anonymous, SEO-driven) page view. Logged-in requests always refresh.
 *
 * The `setAll` reassigns `res` to a fresh NextResponse and re-applies the cookies — the
 * documented @supabase/ssr middleware pattern — so the rotated cookies survive on the
 * response we return. The second `headers` argument carries the no-store cache headers that
 * MUST ride with an auth-cookie response (else a CDN could serve one user's token to another).
 */
export async function updateSession(
  req: NextRequest,
  createClient: CreateMiddlewareClient = defaultCreateClient,
  timeoutMs: number = AUTH_REFRESH_TIMEOUT_MS,
): Promise<NextResponse> {
  if (!hasSupabaseAuthCookie(req)) return NextResponse.next({ request: req });

  let res = NextResponse.next({ request: req });
  const supabase = createClient({
    getAll: () => req.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
      res = NextResponse.next({ request: req });
      cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      if (headers) for (const [key, value] of Object.entries(headers)) res.headers.set(key, value);
    },
  });

  // Validate the token with the Auth server; on rotation this triggers setAll (above) to write the
  // new session onto `res`. CRITICAL: this is the only network I/O in middleware and it runs for
  // every logged-in request across an all-pages matcher. auth-js rethrows any non-AuthError
  // (network / timeout / Auth 5xx), and a middleware throw is an un-catchable 500 with no
  // global-error fallback — so an unguarded call would turn a single Supabase blip into a
  // site-wide outage for every logged-in user. Degrade instead: on failure or slowness, serve the
  // page with the existing (possibly stale) cookies — the next request retries the refresh and the
  // render-time adapter still tolerates a missing rotation. Bounded by a timeout so a hung Auth
  // endpoint can't stall Edge TTFB.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // getUser() is INSIDE the try so even a synchronous throw is contained (auth-js is async today,
    // so it only ever rejects — but this makes the guard total: middleware must never throw).
    const refresh = supabase.auth.getUser();
    refresh.catch(() => {}); // keep a late rejection (after the timeout already won the race) handled
    await Promise.race([
      refresh,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('auth-refresh-timeout')), timeoutMs);
      }),
    ]);
  } catch {
    // Auth unreachable or too slow — return the response unchanged rather than 500ing.
  } finally {
    if (timer) clearTimeout(timer);
  }

  return res;
}
