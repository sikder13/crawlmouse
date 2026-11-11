/**
 * Test support for the site routes and store: supabase-js clients over a migrated PGlite, through the
 * PostgREST stand-in (`__tests__/helpers/postgrest-pglite.ts`), plus the two calls it does not model
 * that these paths make: `.single()` (the pipeline store's site read) and `auth.getUser()` (the
 * session client). `single()` answers as supabase-js does: the one row, or PGRST116 for none. And
 * the rows the route tests start from, written as postgres.
 */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { postgrestOver, type Call } from '../../../__tests__/helpers/postgrest-pglite';
import { personalAccount, signUp } from '../../../__tests__/helpers/v2-check-tables';
import { GATES } from '../../entitlement-v2';

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

export interface Person {
  id: string;
  email: string;
  accountId: string;
  seatId: string;
}

/** A signed-up user with their personal (Free) account and its owner seat. */
export async function person(db: PGlite, tag: string): Promise<Person> {
  const email = `${tag}-${randomUUID().slice(0, 8)}@example.com`;
  const id = await signUp(db, email);
  return { id, email, ...(await personalAccount(db, id)) };
}

/** An active seat for `p` on `accountId`; scoped to `sites` when given. */
export async function addSeat(
  db: PGlite,
  accountId: string,
  p: Pick<Person, 'id' | 'email'>,
  role: 'account_manager' | 'developer',
  sites?: string[],
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.seats (id, account_id, user_id, invited_email, role, status, accepted_at, client_scope_all)
     values ($1, $2, $3, $4, $5, 'active', now(), $6)`,
    [id, accountId, p.id, p.email, role, sites === undefined],
  );
  for (const site of sites ?? []) {
    await db.query(
      `insert into public.seat_sites (seat_id, site_id, account_id) values ($1, $2, $3)`,
      [id, site, accountId],
    );
  }
  return id;
}

/** Moves an account onto a paid plan, with the plan's limits stored as billing writes them. */
export async function makePaid(
  db: PGlite,
  accountId: string,
  tier: 'pro' | 'agency',
): Promise<void> {
  const g = GATES[tier];
  await db.query(
    `update public.accounts set state = $2, tier = $2, site_limit = $3, seat_limit = $4,
       competitor_limit = $5, current_subscription_id = $6,
       state_history = state_history || jsonb_build_array(jsonb_build_object('state', $2::text, 'since', now()::text))
     where id = $1`,
    [accountId, tier, g.sites, g.seats, g.competitorsPerSite, `sub_${randomUUID().slice(0, 8)}`],
  );
}

/** A kept site of the account, written as postgres. */
export async function keptSite(
  db: PGlite,
  accountId: string,
  columns: Partial<Record<'staging_of_site_id' | 'paused_reason' | 'removed_at', string>> = {},
): Promise<{ id: string; host: string }> {
  const id = randomUUID();
  const host = `${id.slice(0, 8)}.example`;
  await db.query(
    `insert into public.sites (id, account_id, host, staging_of_site_id, paused_reason, removed_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      accountId,
      host,
      columns.staging_of_site_id ?? null,
      columns.paused_reason ?? null,
      columns.removed_at ?? null,
    ],
  );
  return { id, host };
}
