/**
 * Test support for the site routes and store: supabase-js clients over a migrated PGlite, through the
 * PostgREST stand-in (`__tests__/helpers/postgrest-pglite.ts`), plus the two calls it does not model
 * that these paths make: `.single()` (the pipeline store's site read) and `auth.getUser()` (the
 * session client). `single()` answers as supabase-js does: the one row, or PGRST116 for none.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { postgrestOver, type Call } from '../../../__tests__/helpers/postgrest-pglite';

type Answer = { data: unknown; error: unknown };

/** A builder chain with `single()`: `maybeSingle()`, and an error where it found no row. */
function withSingle<T extends object>(chain: T): T {
  let single = false;
  const proxy: T = new Proxy(chain, {
    get(target, prop, receiver) {
      if (prop === 'single') {
        return () => {
          single = true;
          (target as { maybeSingle(): unknown }).maybeSingle();
          return proxy;
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      if (prop === 'then') {
        return (resolve: (v: Answer) => unknown, reject?: (e: unknown) => unknown) =>
          (value as (r: (v: Answer) => unknown, j?: (e: unknown) => unknown) => unknown).call(
            target,
            (a: Answer) =>
              resolve(
                single && a.error === null && a.data === null
                  ? {
                      data: null,
                      error: { code: 'PGRST116', message: 'no rows', details: null, hint: null },
                    }
                  : a,
              ),
            reject,
          );
      }
      return (...args: unknown[]) => {
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        return out === target ? proxy : withSingle(out as object);
      };
    },
  });
  return proxy;
}

/** The service-role client, as `supabaseAdmin()` gives it. */
export function adminOver(db: PGlite, log?: Call[][]): SupabaseClient {
  const client = postgrestOver(db, log ? { log } : {});
  return {
    from: (table: string) => withSingle(client.from(table)),
    rpc: client.rpc.bind(client),
  } as unknown as SupabaseClient;
}

/** A signed-in caller's client, as `supabaseServer()` gives it; `user: null` is signed out. */
export function sessionOver(
  db: PGlite,
  user: { id: string; email: string } | null,
  log?: Call[][],
): SupabaseClient {
  const client = user
    ? postgrestOver(db, { as: { userId: user.id }, ...(log ? { log } : {}) })
    : postgrestOver(db, log ? { log } : {});
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: string) => {
      if (!user) throw new Error('a signed-out session reads nothing');
      return withSingle(client.from(table));
    },
    rpc: (fn: string, args?: Record<string, unknown>) => {
      if (!user) throw new Error('a signed-out session calls nothing');
      return client.rpc(fn, args);
    },
  } as unknown as SupabaseClient;
}
