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
import {
  insertRow,
  personalAccount,
  prepareMeasurement,
  ROWS,
  signUp,
} from '../../../__tests__/helpers/v2-check-tables';
import { GATES } from '../../entitlement-v2';
import { fixture } from '../fixtures';

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

/**
 * The time of the next entry of an account's `state_history`, as SQL over the row being updated:
 * now, or a millisecond after the last entry when the clock has not moved since it was written
 * (two statements in one millisecond, or in one transaction). The account schema refuses a history
 * that does not move forward.
 */
export const NEXT_SINCE = `greatest(now(), (state_history -> -1 ->> 'since')::timestamptz + interval '1 millisecond')::text`;

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
       state_history = state_history || jsonb_build_array(jsonb_build_object('state', $2::text, 'since', ${NEXT_SINCE}))
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

/** One client site of `scopeWorld`, with the id of each row seeded for it. */
export interface ClientSite {
  id: string;
  host: string;
  check: string;
  fix: string;
  fixEvent: string;
  change: string;
  report: string;
  rule: string;
  alertEvent: string;
  /** The public link's slug and the client report page's. */
  slugs: [string, string];
}

export interface ScopeWorld {
  accountId: string;
  owner: Person;
  /** An unscoped account manager. */
  manager: Person;
  /** A developer whose seat covers site1 only. */
  developer: Person;
  developerSeat: string;
  /** Held an unscoped account manager seat, since removed. */
  removed: Person;
  /** The owner of another account. */
  stranger: Person;
  /** A second unscoped account manager, for a test that removes a seat. */
  leaver: Person;
  leaverSeat: string;
  /** A developer seat scoped to site2, invited and not accepted: site2's `seat_sites` row. */
  invitedSeat: string;
  site1: ClientSite;
  site2: ClientSite;
}

const BAD_SITE = fixture('bad-site');
const FIXTURE_CHECK = BAD_SITE.checks.find((c) => c.status === 'finished')!;
const FIXTURE_FIX = BAD_SITE.fixes.find((f) => f.packet !== null)!;
// As test-support/fix-world.ts does: the measured columns of a check, and a fix's effect and packet,
// take a fixture's values, which the contract's schemas parse.
const MEASURED = [
  'grade_version',
  'tested_at',
  'coverage',
  'technical_seo',
  'ai_readability',
  'structure',
  'without_js',
  'content',
  'signals',
  'crawlers',
  'stack',
  'competitors',
] as const;

async function clientSite(db: PGlite, accountId: string, n: number): Promise<ClientSite> {
  const site = await keptSite(db, accountId);
  const ids = {
    check: randomUUID(),
    fix: randomUUID(),
    fixEvent: randomUUID(),
    change: randomUUID(),
    report: randomUUID(),
    rule: randomUUID(),
    alertEvent: randomUUID(),
  };
  const slugs: [string, string] = [`link-${site.id}`, `client-${site.id}`];
  await insertRow(db, 'checks', {
    ...ROWS.checks(ids.check, site.id),
    ...Object.fromEntries(MEASURED.map((k) => [k, FIXTURE_CHECK[k]])),
  });
  await insertRow(db, 'site_fixes', {
    ...ROWS.site_fixes(ids.fix, site.id, ids.check, n),
    status: 'reopened',
    effect: FIXTURE_FIX.effect,
    packet: FIXTURE_FIX.packet,
  });
  await insertRow(db, 'fix_events', {
    ...ROWS.fix_events(ids.fixEvent, ids.fix, ids.check),
    kind: 'reopened',
  });
  await insertRow(db, 'changes', ROWS.changes(ids.change, site.id, ids.check));
  await insertRow(db, 'reports', {
    ...ROWS.reports(ids.report, accountId, site.id, ids.check),
    kind: 'public_link',
    format: 'html',
    public_slug: slugs[0],
  });
  await insertRow(db, 'report_schedules', {
    ...ROWS.report_schedules(site.id, accountId),
    page_slug: slugs[1],
  });
  await insertRow(db, 'alert_rules', ROWS.alert_rules(ids.rule, accountId, site.id));
  await insertRow(
    db,
    'alert_events',
    ROWS.alert_events(ids.alertEvent, ids.rule, site.id, ids.check),
  );
  return { ...site, ...ids, slugs };
}

/**
 * An Agency account with two client sites, each with a finished check, a fix and its event, a
 * change, a public link, a client report schedule, a site alert rule and an alert event; and the
 * people of `ScopeWorld`. Call it on a database the migrations were applied to.
 */
export async function scopeWorld(db: PGlite): Promise<ScopeWorld> {
  await prepareMeasurement(db);
  const owner = await person(db, 'owner');
  const accountId = owner.accountId;
  await makePaid(db, accountId, 'agency');
  const site1 = await clientSite(db, accountId, 7001);
  const site2 = await clientSite(db, accountId, 7002);
  const [manager, developer, removed, stranger, leaver] = [
    await person(db, 'manager'),
    await person(db, 'developer'),
    await person(db, 'removed'),
    await person(db, 'stranger'),
    await person(db, 'leaver'),
  ];
  await addSeat(db, accountId, manager, 'account_manager');
  const developerSeat = await addSeat(db, accountId, developer, 'developer', [site1.id]);
  const gone = await addSeat(db, accountId, removed, 'account_manager');
  await removeSeat(db, gone);
  const leaverSeat = await addSeat(db, accountId, leaver, 'account_manager');
  const invitedSeat = randomUUID();
  await db.query(
    `insert into public.seats (id, account_id, invited_email, role, status, client_scope_all)
     values ($1, $2, $3, 'developer', 'invited', false)`,
    [invitedSeat, accountId, `invited-${invitedSeat}@example.com`],
  );
  await insertRow(db, 'seat_sites', ROWS.seat_sites(invitedSeat, site2.id, accountId));
  return {
    accountId,
    owner,
    manager,
    developer,
    developerSeat,
    removed,
    stranger,
    leaver,
    leaverSeat,
    invitedSeat,
    site1,
    site2,
  };
}

/** Removes a seat, as the owner removing a person leaves it. */
export async function removeSeat(db: PGlite, seatId: string): Promise<void> {
  await db.query(`update public.seats set status = 'removed', removed_at = now() where id = $1`, [
    seatId,
  ]);
}
