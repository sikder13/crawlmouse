import type { CookieMethodsServer, CookieOptions } from '@supabase/ssr';

/**
 * The minimal slice of Next 15's awaited `cookies()` store the Supabase server client needs.
 * Declared structurally so this module imports no `next/headers` and stays unit-testable in
 * the suite's node environment.
 */
export interface WritableCookieStore {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): void;
}

/**
 * Cookie adapter for `@supabase/ssr`'s `createServerClient` (used by Server Components and Route
 * Handlers via Next's `cookies()` store).
 *
 * `@supabase/ssr` calls `setAll(cookies, headers)` where `headers` are the no-store cache headers
 * that must accompany an auth-cookie response. This adapter writes through the `cookies()` store,
 * which has no handle to set response headers, so it cannot apply them and does not pretend to:
 * those headers are owned by whoever owns the response — middleware (updateSession) applies them
 * when it rotates a session, and session-minting route handlers (e.g. /login/verify) apply them via
 * applyNoStore(). On Vercel, Set-Cookie responses are not edge-cached, so this is defense-in-depth.
 */
export function cookieMethodsFor(store: WritableCookieStore): CookieMethodsServer {
  return {
    getAll: () => store.getAll(),
    setAll: (cookiesToSet) => {
      try {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      } catch {
        // Reached when this adapter runs during a Server Component RENDER, where Next 15 forbids
        // cookie writes (`cookieStore.set` throws). Swallow it: the rotated session is persisted on
        // the next navigation by middleware (a write-allowed context). In a Route Handler (also
        // write-allowed) the writes succeed and this catch is never hit.
      }
    },
  };
}
