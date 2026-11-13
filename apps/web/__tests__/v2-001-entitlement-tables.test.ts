import { randomUUID } from 'node:crypto';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { TimestampSchema } from '@crawlmouse/types/v2';
import { beforeAll, describe, expect, it } from 'vitest';
import { GATES } from '../lib/entitlement-v2';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';

/**
 * Migration 001 of the v2 build (ARCH-2 §6.1): the entitlement tables, the membership helpers and
 * the extended `handle_new_user`. Everything here runs the real migration files on PGlite and reads
 * the result from the catalog or by acting as a client role; nothing reads the SQL text.
 *
 * What it covers: apply, re-apply and revert; the grant and policy posture of the five new tables and
 * the new functions; reads and writes attempted as `anon` and as `authenticated`; the sign-up
 * trigger; the table CHECKs. What it does not cover: production's catalog after the owner applies the
 * migration. That is the runbook's post-apply check, run against `ezspnfeyzwsisymytssm`.
 */

const MIGRATION = '20261101000001_v2_001_entitlement_tables.sql';
const ROLLBACK = '20261101000001_v2_001_entitlement_tables.revert.sql';

const NEW_TABLES = ['accounts', 'subscriptions', 'seats', 'agency_brands', 'trial_ledger'] as const;

/**
 * The posture each new table must have, written out by hand. SELECT is granted to `authenticated`
 * per column, never on the whole table, so a column added later stays hidden until it is granted.
 * `columnsWithout` lists the columns `authenticated` may NOT select; `'none'` means no grant at all.
 */
const POSTURE: Record<
  (typeof NEW_TABLES)[number],
  { policies: string[]; authenticatedSelect: 'none' | { columnsWithout: string[] } }
> = {
  accounts: {
    policies: ['accounts_member_read'],
    // 027b's deletion mark is read by the membership functions and the purge, never by a client.
    authenticatedSelect: {
      columnsWithout: [
        'stripe_customer_id',
        'deletion_confirmed_at',
        'purge_after',
        // CC-29: the agency trial's open Checkout and its consent time, read by the service role only.
        'agency_checkout_url',
        'agency_checkout_at',
        'agency_checkout_interval',
        'agency_trial_consent_at',
        // CC-33: our own test and staff accounts, read by the service role only.
        'internal',
      ],
    },
  },
  subscriptions: {
    policies: ['subscriptions_member_read'],
    authenticatedSelect: { columnsWithout: [] },
  },
  seats: {
    policies: ['seats_member_read'],
    // 031 adds the invitation's expiry and number, which no client reads either.
    authenticatedSelect: {
      columnsWithout: ['invite_token_hash', 'invite_expires_at', 'invite_seq'],
    },
  },
  agency_brands: {
    policies: ['agency_brands_member_read'],
    authenticatedSelect: { columnsWithout: [] },
  },
  trial_ledger: { policies: [], authenticatedSelect: 'none' },
};

const EXECUTE = (grantee: string) => ({ grantee, privileges: 'X' });
const FUNCTION_ACL: Record<string, { grantee: string; privileges: string }[]> = {
  is_member: [EXECUTE('postgres'), EXECUTE('authenticated'), EXECUTE('service_role')],
  member_role: [EXECUTE('postgres'), EXECUTE('authenticated'), EXECUTE('service_role')],
  apply_entitlement_transition: [EXECUTE('postgres'), EXECUTE('service_role')],
  assert_entitlement_version: [EXECUTE('postgres'), EXECUTE('service_role')],
};

// ─── Catalog readers ───────────────────────────────────────────────────────────────────────────────

interface AclItem {
  grantee: string;
  privileges: string;
}

function aclItems(acl: string | null): AclItem[] {
  return (acl ?? '')
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const [grantee = '', rest = ''] = item.split('=');
      return { grantee, privileges: rest.split('/')[0] ?? '' };
    });
}

/**
 * The posture rule for one new table, returning its violations so the negative controls below can
 * show it fires for the right reason. Grantees are an allowlist: anything not named is a violation.
 */
async function tablePostureViolations(
  db: PGlite,
  table: (typeof NEW_TABLES)[number],
): Promise<string[]> {
  const expected = POSTURE[table];
  const bad: string[] = [];
  const { rows } = await db.query<{ rls: boolean; acl: string | null }>(
    `select c.relrowsecurity as rls, c.relacl::text as acl
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  const rel = rows[0];
  if (!rel) return [`${table}: not found`];
  if (!rel.rls) bad.push(`${table}: RLS is disabled`);

  for (const item of aclItems(rel.acl)) {
    if (item.grantee === '') bad.push(`${table}: PUBLIC holds ${item.privileges}`);
    else if (item.grantee === 'authenticated') {
      bad.push(`${table}: authenticated holds table privileges ${item.privileges}`);
    } else if (!['postgres', 'service_role'].includes(item.grantee)) {
      bad.push(`${table}: ${item.grantee} holds ${item.privileges}`);
    }
  }
  const cols = await db.query<{ col: string; acl: string | null }>(
    `select a.attname as col, a.attacl::text as acl
       from pg_attribute a join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped`,
    [table],
  );
  for (const { col, acl } of cols.rows) {
    const items = aclItems(acl);
    for (const item of items) {
      if (item.grantee !== 'authenticated')
        bad.push(`${table}.${col}: ${item.grantee || 'PUBLIC'} holds ${item.privileges}`);
      else if (item.privileges !== 'r')
        bad.push(`${table}.${col}: authenticated holds ${item.privileges}`);
    }
    const shouldRead =
      typeof expected.authenticatedSelect === 'object' &&
      !expected.authenticatedSelect.columnsWithout.includes(col);
    const reads = items.some((i) => i.grantee === 'authenticated');
    if (shouldRead && !reads) bad.push(`${table}.${col}: authenticated cannot select it`);
    if (!shouldRead && reads) bad.push(`${table}.${col}: authenticated can select it`);
  }

  const policies = await db.query<{ name: string; cmd: string; roles: string }>(
    `select policyname as name, cmd, roles::text as roles from pg_policies
      where schemaname = 'public' and tablename = $1 order by policyname`,
    [table],
  );
  const names = policies.rows.map((p) => p.name);
  if (JSON.stringify(names) !== JSON.stringify(expected.policies)) {
    bad.push(
      `${table}: policies are [${names.join(', ')}], expected [${expected.policies.join(', ')}]`,
    );
  }
  for (const p of policies.rows) {
    if (p.cmd !== 'SELECT') bad.push(`${table}: policy ${p.name} is for ${p.cmd}`);
    if (p.roles !== '{authenticated}') bad.push(`${table}: policy ${p.name} applies to ${p.roles}`);
  }
  return bad;
}

/**
 * Every routine in `public` a client role can execute: the runbook's name-free post-apply query, with
 * one difference. PGlite installs pgcrypto's functions into `public`, where Supabase keeps extensions
 * in their own schema, so routines owned by an extension are left out here and only here.
 */
async function clientExecutable(
  db: PGlite,
): Promise<{ name: string; anon: boolean; authed: boolean }[]> {
  const { rows } = await db.query<{ name: string; anon: boolean; authed: boolean }>(`
    select p.proname as name,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     order by p.proname`);
  return rows;
}

// ─── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

/** Sign up through the platform path: an `auth.users` insert, which fires `handle_new_user`. */
async function signUp(db: PGlite, email: string): Promise<string> {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return id;
}

async function defaultAccount(db: PGlite, userId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select default_account_id as id from public.users where id = $1`,
    [userId],
  );
  return rows[0]!.id;
}

/** The SQLSTATE a statement fails with, or `ok`. */
async function sqlState(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (err) {
    return (err as { code?: string }).code ?? `no code: ${String(err)}`;
  }
}

/** The SQLSTATE and message a statement fails with, or `ok`: for refusals that share a SQLSTATE. */
async function sqlFailure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'ok';
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return `${e.code ?? 'no code'} ${e.message ?? String(err)}`;
  }
}

const DENIED = '42501';
const CHECK_VIOLATION = '23514';

interface World {
  db: PGlite;
  alice: string;
  bob: string;
  dave: string;
  aliceAccount: string;
  bobAccount: string;
  agency: string;
}

/**
 * Alice and Bob each sign up and get a personal account. Alice also owns an agency account on which
 * Bob is an active developer and Dave's seat was removed. Every new table gets one row per account,
 * written as the superuser, which is how the service role writes them.
 */
async function buildWorld(): Promise<World> {
  const db = await freshDb();
  await applyAllMigrations(db);
  const alice = await signUp(db, 'alice@example.com');
  const bob = await signUp(db, 'bob@example.com');
  const dave = await signUp(db, 'dave@example.com');
  const aliceAccount = await defaultAccount(db, alice);
  const bobAccount = await defaultAccount(db, bob);

  const { rows } = await db.query<{ id: string }>(
    `insert into public.accounts (kind, name, state, tier, seat_limit, site_limit, competitor_limit,
                                  current_subscription_id, state_history)
     values ('agency', 'Alice Agency', 'agency', 'agency', 5, 25, 3, 'sub_agency',
             '[{"state":"agency","since":"2026-11-01T00:00:00.000Z"}]'::jsonb)
     returning id`,
  );
  const agency = rows[0]!.id;
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at, removed_at) values
       ($1, $2, 'alice@example.com', 'owner', 'active', now(), null),
       ($1, $3, 'bob@example.com', 'developer', 'active', now(), null),
       ($1, $4, 'dave@example.com', 'developer', 'removed', now(), now()),
       ($1, null, 'erin@example.com', 'account_manager', 'invited', null, null)`,
    [agency, alice, bob, dave],
  );
  for (const [account, n] of [
    [aliceAccount, 1],
    [bobAccount, 2],
    [agency, 3],
  ] as const) {
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval) values ($1, $2, 'active', 'pro', 'month')`,
      [`sub_test_${n}`, account],
    );
    await db.query(
      `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind) values ('email', $1, $2, 'pro')`,
      [String(n).repeat(64), account],
    );
  }
  await db.query(
    `insert into public.agency_brands (account_id, agency_name) values ($1, 'Alice Agency')`,
    [agency],
  );
  await db.query(`update public.accounts set stripe_customer_id = 'cus_' || left(id::text, 8)`);
  // 031's seats_invite_token: a hash is held by an invited seat, with an expiry.
  await db.query(
    `update public.seats set invite_token_hash = repeat('a', 64), invite_expires_at = now()
      where status = 'invited'`,
  );
  return { db, alice, bob, dave, aliceAccount, bobAccount, agency };
}

/** The `account_id` (or `id`) values a role can see in one table. */
async function visibleAccounts(
  db: PGlite,
  role: 'anon' | 'authenticated',
  userId: string | null,
  table: (typeof NEW_TABLES)[number],
): Promise<string[]> {
  const key = table === 'accounts' ? 'id' : 'account_id';
  return asRole(db, role, userId, async (tx: Transaction) => {
    const { rows } = await tx.query<{ a: string }>(
      `select distinct ${key}::text as a from public.${table} order by 1`,
    );
    return rows.map((r) => r.a);
  });
}

// ─── Apply, re-apply, revert ───────────────────────────────────────────────────────────────────────

describe('migration 001 applies, re-applies and reverts', () => {
  const before001 = (f: string) => f < MIGRATION;
  // Later migrations build on 001 (003 replaces apply_entitlement_transition and references
  // accounts), so re-applying or reverting 001 is tested on the catalog 001 itself produces.
  const through001 = (f: string) => f <= MIGRATION;

  it('re-applying it changes nothing in the catalog', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through001);
    const once = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION));
    expect(await catalogSnapshot(db)).toEqual(once);
  }, 120_000);

  it('the revert returns the catalog to the state before 001, handle_new_user body included', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, before001);
    const before = await catalogSnapshot(db);
    await db.exec(readMigration(MIGRATION));
    expect(await catalogSnapshot(db)).not.toEqual(before); // anti-vacuity: 001 did change something
    await db.exec(readRollback(ROLLBACK));
    const after = await catalogSnapshot(db);
    for (const section of Object.keys(before))
      expect(after[section], section).toEqual(before[section]);
  }, 120_000);

  it('the revert runs twice without error, and 001 re-applies after it to the same catalog', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through001);
    const applied = await catalogSnapshot(db);
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readRollback(ROLLBACK));
    await db.exec(readMigration(MIGRATION));
    expect(await catalogSnapshot(db)).toEqual(applied);
  }, 120_000);

  it('a v1 sign-up still works after the revert, and creates no account', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, undefined, through001);
    await db.exec(readRollback(ROLLBACK));
    const id = await signUp(db, 'after-revert@example.com');
    const { rows } = await db.query<{ email: string; pro_until: string | null }>(
      `select email, pro_until from public.users where id = $1`,
      [id],
    );
    expect(rows).toEqual([{ email: 'after-revert@example.com', pro_until: null }]);
  }, 120_000);
});

// ─── Catalog posture ───────────────────────────────────────────────────────────────────────────────

describe('migration 001 catalog posture', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
  }, 120_000);

  for (const table of NEW_TABLES) {
    it(`${table}: RLS on, the listed policies only, grants only to the allowlisted roles`, async () => {
      expect(await tablePostureViolations(db, table)).toEqual([]);
    });
  }

  it('the new functions are SECURITY DEFINER, pin search_path and hold exactly the listed ACL', async () => {
    const { rows } = await db.query<{
      name: string;
      definer: boolean;
      config: string[];
      acl: string;
    }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config, p.proacl::text as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1) order by p.proname`,
      [Object.keys(FUNCTION_ACL)],
    );
    expect(rows.map((r) => r.name)).toEqual(Object.keys(FUNCTION_ACL).sort());
    for (const row of rows) {
      expect(row.definer, row.name).toBe(true);
      // 001 wrote public, pg_catalog; 20261108000002 (CC-SEC) moved pg_catalog first and pg_temp last.
      expect(row.config, row.name).toEqual(['search_path=pg_catalog, public, pg_temp']);
      expect(aclItems(row.acl), row.name).toEqual(expect.arrayContaining(FUNCTION_ACL[row.name]!));
      expect(aclItems(row.acl), row.name).toHaveLength(FUNCTION_ACL[row.name]!.length);
    }
  });

  it('handle_new_user stays callable by no client role', async () => {
    const { rows } = await db.query<{ acl: string }>(
      `select p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_new_user'`,
    );
    const grantees = aclItems(rows[0]!.acl).map((i) => i.grantee);
    expect(grantees.filter((g) => !['postgres', 'service_role'].includes(g))).toEqual([]);
  });

  it('the client-executable routines in public are exactly the membership helpers, is_operator and usage_counts, for authenticated only', async () => {
    // is_member_for_site arrives with migration 003, usage_counts with 006b, is_member_for_fix with
    // 20261112000001, member_covers_all and seat_may with 20261114000002, and is_operator with
    // 20261115000001; this suite applies every migration.
    expect(await clientExecutable(db)).toEqual([
      { name: 'is_member', anon: false, authed: true },
      { name: 'is_member_for_fix', anon: false, authed: true },
      { name: 'is_member_for_site', anon: false, authed: true },
      { name: 'is_operator', anon: false, authed: true },
      { name: 'member_covers_all', anon: false, authed: true },
      { name: 'member_role', anon: false, authed: true },
      { name: 'seat_may', anon: false, authed: true },
      { name: 'usage_counts', anon: false, authed: true },
    ]);
  });
});

/**
 * Negative controls for the table rule: each case breaks the posture one way and asserts the rule
 * names it, so an edit that quietly stops checking something fails here. The last case shows the rule
 * is not always red.
 */
describe('the table-posture rule catches a hostile change', () => {
  const hostile = async (sql: string, table: (typeof NEW_TABLES)[number]): Promise<string> => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(sql);
    return (await tablePostureViolations(db, table)).join(' | ');
  };

  it('catches: a table grant to anon', async () => {
    expect(await hostile(`grant select on public.trial_ledger to anon;`, 'trial_ledger')).toMatch(
      /anon holds r/,
    );
  }, 120_000);

  it('catches: a grant to PUBLIC', async () => {
    expect(
      await hostile(`grant select on public.subscriptions to public;`, 'subscriptions'),
    ).toMatch(/PUBLIC holds r/);
  }, 120_000);

  it('catches: authenticated given a write privilege', async () => {
    expect(await hostile(`grant update on public.seats to authenticated;`, 'seats')).toMatch(
      /authenticated holds/,
    );
  }, 120_000);

  it('catches: a hidden column granted back', async () => {
    expect(
      await hostile(
        `grant select (stripe_customer_id) on public.accounts to authenticated;`,
        'accounts',
      ),
    ).toMatch(/accounts\.stripe_customer_id: authenticated can select it/);
  }, 120_000);

  it('catches: RLS switched off', async () => {
    expect(
      await hostile(
        `alter table public.agency_brands disable row level security;`,
        'agency_brands',
      ),
    ).toMatch(/RLS is disabled/);
  }, 120_000);

  it('catches: an extra permissive policy', async () => {
    expect(
      await hostile(
        `create policy p_open on public.trial_ledger for select to authenticated using (true);`,
        'trial_ledger',
      ),
    ).toMatch(/policies are \[p_open\]/);
  }, 120_000);

  it('catches: the member-read policy dropped', async () => {
    expect(
      await hostile(`drop policy accounts_member_read on public.accounts;`, 'accounts'),
    ).toMatch(/policies are \[\], expected \[accounts_member_read\]/);
  }, 120_000);

  it('catches: the revoke narrowed to PUBLIC, which leaves production default grants in place', async () => {
    const db = await freshDb();
    await applyAllMigrations(db, (sql) =>
      sql.replace(/from public, anon, authenticated;/g, 'from public;'),
    );
    const all = (await Promise.all(NEW_TABLES.map((t) => tablePostureViolations(db, t))))
      .flat()
      .join(' | ');
    expect(all).toMatch(/anon holds/);
  }, 120_000);

  it('does NOT fire on a grant to an unrelated table', async () => {
    const db = await freshDb();
    await applyAllMigrations(db);
    await db.exec(`grant select on public.audits to anon;`);
    for (const table of NEW_TABLES) expect(await tablePostureViolations(db, table)).toEqual([]);
  }, 120_000);
});

// ─── Reads and writes as a client ──────────────────────────────────────────────────────────────────

describe('migration 001 RLS, acting as anon and as authenticated', () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  }, 120_000);

  for (const table of NEW_TABLES) {
    it(`anon cannot select from ${table}`, async () => {
      expect(await sqlState(() => visibleAccounts(w.db, 'anon', null, table))).toBe(DENIED);
    });
  }

  for (const table of ['accounts', 'subscriptions', 'seats', 'agency_brands'] as const) {
    it(`authenticated sees in ${table} only the accounts it holds an active seat on`, async () => {
      const expectedFor = (accounts: string[]) =>
        accounts.filter((a) => table !== 'agency_brands' || a === w.agency).sort();
      expect(await visibleAccounts(w.db, 'authenticated', w.alice, table)).toEqual(
        expectedFor([w.aliceAccount, w.agency]),
      );
      expect(await visibleAccounts(w.db, 'authenticated', w.bob, table)).toEqual(
        expectedFor([w.bobAccount, w.agency]),
      );
      // Dave's agency seat is removed: he sees his own personal account and nothing of the agency's.
      expect(await visibleAccounts(w.db, 'authenticated', w.dave, table)).not.toContain(w.agency);
      // A JWT whose subject holds no seat sees nothing.
      expect(await visibleAccounts(w.db, 'authenticated', randomUUID(), table)).toEqual([]);
    });
  }

  it('authenticated cannot select from trial_ledger at all', async () => {
    expect(
      await sqlState(() => visibleAccounts(w.db, 'authenticated', w.alice, 'trial_ledger')),
    ).toBe(DENIED);
  });

  it('authenticated cannot select the hidden columns, even on its own account', async () => {
    const read = (sql: string) => () =>
      asRole(w.db, 'authenticated', w.alice, (tx) => tx.query(sql));
    expect(await sqlState(read(`select stripe_customer_id from public.accounts`))).toBe(DENIED);
    expect(await sqlState(read(`select invite_token_hash from public.seats`))).toBe(DENIED);
    expect(await sqlState(read(`select id, state, tier from public.accounts`))).toBe('ok');
  });

  it('a member of a soft-deleted account no longer reads it', async () => {
    await w.db.query(`update public.accounts set deleted_at = now() where id = $1`, [w.bobAccount]);
    try {
      expect(await visibleAccounts(w.db, 'authenticated', w.bob, 'accounts')).toEqual([w.agency]);
    } finally {
      await w.db.query(`update public.accounts set deleted_at = null where id = $1`, [
        w.bobAccount,
      ]);
    }
  });

  const WRITES: [label: string, sql: (x: World) => string][] = [
    [
      'insert an account',
      () => `insert into public.accounts (kind, state, tier, seat_limit, site_limit, state_history)
       values ('personal','pro','pro',2,5,'[{"state":"pro","since":"2026-11-01T00:00:00Z"}]')`,
    ],
    [
      'upgrade another account',
      (x) => `update public.accounts set state = 'pro', tier = 'pro' where id = '${x.bobAccount}'`,
    ],
    [
      'upgrade its own account',
      (x) =>
        `update public.accounts set state = 'pro', tier = 'pro' where id = '${x.aliceAccount}'`,
    ],
    ['delete an account', (x) => `delete from public.accounts where id = '${x.bobAccount}'`],
    [
      'give itself a seat on another account',
      (x) =>
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ('${x.bobAccount}', '${x.alice}', 'alice@example.com', 'owner', 'active', now())`,
    ],
    [
      'promote its own seat',
      (x) => `update public.seats set role = 'owner' where user_id = '${x.bob}'`,
    ],
    ['remove a seat', (x) => `delete from public.seats where user_id = '${x.bob}'`],
    [
      'insert a subscription',
      (x) =>
        `insert into public.subscriptions (id, account_id, status, plan, interval) values ('sub_x', '${x.aliceAccount}', 'active', 'agency', 'year')`,
    ],
    [
      'extend a subscription',
      (x) =>
        `update public.subscriptions set status = 'active' where account_id = '${x.aliceAccount}'`,
    ],
    ['delete a subscription', () => `delete from public.subscriptions`],
    [
      'write a brand',
      (x) => `update public.agency_brands set agency_name = 'x' where account_id = '${x.agency}'`,
    ],
    [
      'insert a brand',
      (x) =>
        `insert into public.agency_brands (account_id, agency_name) values ('${x.bobAccount}', 'x')`,
    ],
    ['clear the trial ledger', () => `delete from public.trial_ledger`],
    [
      'write the trial ledger',
      (x) =>
        `insert into public.trial_ledger (kind, value_hash, account_id, trial_kind) values ('email', repeat('f', 64), '${x.aliceAccount}', 'pro')`,
    ],
    [
      'point its default account elsewhere',
      (x) =>
        `update public.users set default_account_id = '${x.bobAccount}' where id = '${x.alice}'`,
    ],
    [
      'call the transition RPC',
      (x) =>
        `select public.apply_entitlement_transition('${x.aliceAccount}', 0, 'pro', 'pro', null, null,
           null, null, now(), null, 2, 5, 1, now(), 'sub_x', now())`,
    ],
    [
      'call the version check',
      (x) => `select public.assert_entitlement_version('${x.aliceAccount}', 0)`,
    ],
  ];

  for (const [label, sql] of WRITES) {
    it(`authenticated cannot ${label}`, async () => {
      expect(
        await sqlState(() => asRole(w.db, 'authenticated', w.alice, (tx) => tx.query(sql(w)))),
      ).toBe(DENIED);
    });
    it(`anon cannot ${label}`, async () => {
      expect(await sqlState(() => asRole(w.db, 'anon', null, (tx) => tx.query(sql(w))))).toBe(
        DENIED,
      );
    });
  }

  it('service_role can call the transition RPC through its grant', async () => {
    const version = await asRole(w.db, 'service_role', null, async (tx) => {
      const { rows } = await tx.query<{ v: number }>(
        `select public.apply_entitlement_transition('${w.bobAccount}', 0, 'pro', 'pro', null, null,
           null, null, null, null, 2, 5, 1, now(), 'sub_x', now()) as v`,
      );
      return rows[0]!.v;
    });
    expect(version).toBe(1);
  });

  it('anon cannot call the membership helpers', async () => {
    const call = (fn: string) => () =>
      asRole(w.db, 'anon', null, (tx) => tx.query(`select public.${fn}('${w.agency}')`));
    expect(await sqlState(call('is_member'))).toBe(DENIED);
    expect(await sqlState(call('member_role'))).toBe(DENIED);
  });

  it('the membership helpers answer for the caller only', async () => {
    const ask = (user: string, fn: string) =>
      asRole(w.db, 'authenticated', user, async (tx) => {
        const { rows } = await tx.query<{ v: unknown }>(`select public.${fn}('${w.agency}') as v`);
        return rows[0]!.v;
      });
    expect(await ask(w.alice, 'is_member')).toBe(true);
    expect(await ask(w.alice, 'member_role')).toBe('owner');
    expect(await ask(w.bob, 'member_role')).toBe('developer');
    expect(await ask(w.dave, 'is_member')).toBe(false);
    expect(await ask(w.dave, 'member_role')).toBe(null);
  });

  it('users_self_read still returns only the caller’s own row, now with its default account', async () => {
    // After 20261106000002 (P2) a signed-in user may read only id, pro_until and stripe_customer_id
    // of users, so the default account is read as the owner.
    const rows = await asRole(
      w.db,
      'authenticated',
      w.alice,
      async (tx) => (await tx.query<{ id: string }>(`select id from public.users`)).rows,
    );
    expect(rows).toEqual([{ id: w.alice }]);
    const own = await w.db.query<{ default_account_id: string }>(
      `select default_account_id from public.users where id = $1`,
      [w.alice],
    );
    expect(own.rows).toEqual([{ default_account_id: w.aliceAccount }]);
  });
});

// ─── The sign-up trigger ───────────────────────────────────────────────────────────────────────────

describe('handle_new_user: user → account → seat → default account', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
  }, 120_000);

  it('creates the users row exactly as v1 does', async () => {
    const id = await signUp(db, 'v1-shape@example.com');
    const { rows } = await db.query(
      `select email, pro_until, stripe_customer_id from public.users where id = $1`,
      [id],
    );
    expect(rows).toEqual([
      { email: 'v1-shape@example.com', pro_until: null, stripe_customer_id: null },
    ]);
  });

  it('creates one personal Free account with Free limits, no trial, and a one-entry history', async () => {
    const id = await signUp(db, 'new@example.com');
    const { rows } = await db.query<Record<string, unknown>>(
      `select a.* from public.accounts a join public.seats s on s.account_id = a.id where s.user_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    const a = rows[0]!;
    expect({
      kind: a.kind,
      state: a.state,
      tier: a.tier,
      seat_limit: a.seat_limit,
      site_limit: a.site_limit,
      competitor_limit: a.competitor_limit,
      trial_variant: a.trial_variant,
      trial_ends_at: a.trial_ends_at,
      trial_used_at: a.trial_used_at,
      past_due_tier: a.past_due_tier,
      timezone: a.timezone,
    }).toEqual({
      kind: 'personal',
      state: 'free',
      tier: 'free',
      seat_limit: GATES.free.seats,
      site_limit: GATES.free.sites,
      competitor_limit: GATES.free.competitorsPerSite,
      trial_variant: null,
      trial_ends_at: null,
      trial_used_at: null,
      past_due_tier: null,
      timezone: 'UTC',
    });
    const history = a.state_history as { state: string; since: string }[];
    expect(history).toHaveLength(1);
    expect(history[0]!.state).toBe('free');
    expect(TimestampSchema.safeParse(history[0]!.since).success).toBe(true);
  });

  it('creates the active owner seat and points the default account at it', async () => {
    const id = await signUp(db, 'owner@example.com');
    const { rows } = await db.query<Record<string, unknown>>(
      `select s.role, s.status, s.invited_email, s.accepted_at is not null as accepted,
              u.default_account_id = s.account_id as is_default
         from public.seats s join public.users u on u.id = s.user_id where s.user_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        role: 'owner',
        status: 'active',
        invited_email: 'owner@example.com',
        accepted: true,
        is_default: true,
      },
    ]);
  });

  it('starts Free even when the email is already in the trial ledger (the ledger rule itself is CC-04)', async () => {
    await db.query(
      `insert into public.trial_ledger (kind, value_hash, trial_kind) values ('email', encode(digest('ledger@example.com', 'sha256'), 'hex'), 'pro')`,
    );
    const id = await signUp(db, 'ledger@example.com');
    const { rows } = await db.query(
      `select a.state, a.trial_used_at from public.accounts a join public.users u on u.default_account_id = a.id where u.id = $1`,
      [id],
    );
    expect(rows).toEqual([{ state: 'free', trial_used_at: null }]);
  });

  it('gives a users row that predates the account model an account, and never a second one', async () => {
    const id = randomUUID();
    // public.users references auth.users (B-F2), so the legacy row is written in the same statement
    // as its auth row: the sign-up trigger fires at the statement's end and finds it already there.
    await db.query(
      `with a as (insert into auth.users (id, email) values ($1, 'legacy@example.com') returning id)
       insert into public.users (id, email) select id, 'legacy@example.com' from a`,
      [id],
    );
    const count = async () =>
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.seats where user_id = $1`,
          [id],
        )
      ).rows[0]!.n;
    expect(await count()).toBe(1);
    // A second platform insert for the same id cannot happen (auth.users PK), so re-run the trigger
    // body directly through a fresh auth row and check the guard on default_account_id holds.
    // Replica mode skips the users_id_auth_fkey cascade, so public.users and its account stay.
    await db.exec(`set session_replication_role = replica`);
    await db.query(`delete from auth.users where id = $1`, [id]);
    await db.exec(`set session_replication_role = origin`);
    await db.query(`insert into auth.users (id, email) values ($1, 'legacy@example.com')`, [id]);
    expect(await count()).toBe(1);
  });

  it('is atomic: when the account cannot be created, the sign-up fails and leaves no users row', async () => {
    const isolated = await freshDb();
    await applyAllMigrations(isolated);
    await isolated.exec(
      `alter table public.accounts add constraint refuse_all check (false) not valid;`,
    );
    const id = randomUUID();
    expect(
      await sqlState(() =>
        isolated.query(`insert into auth.users (id, email) values ($1, 'x@example.com')`, [id]),
      ),
    ).toBe(CHECK_VIOLATION);
    const { rows } = await isolated.query(`select 1 from public.users where id = $1`, [id]);
    expect(rows).toEqual([]);
  }, 120_000);
});

// ─── Table CHECKs ──────────────────────────────────────────────────────────────────────────────────

describe('accounts CHECKs hold the entitlement invariants in the database', () => {
  let db: PGlite;
  let account: string;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    account = await defaultAccount(db, await signUp(db, 'checks@example.com'));
  }, 120_000);

  const update = (set: string) => () =>
    db.query(`update public.accounts set ${set} where id = $1`, [account]);

  it('rejects a tier that does not match the state', async () => {
    expect(await sqlState(update(`tier = 'pro'`))).toBe(CHECK_VIOLATION);
  });

  it('rejects a trial state without trial_ends_at, and trial_ends_at outside a trial', async () => {
    expect(await sqlState(update(`trial_ends_at = now()`))).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(
        update(`state = 'pro_trial', tier = 'pro', trial_variant = 'no_card', trial_used_at = now(),
                state_history = state_history || '[{"state":"pro_trial","since":"2099-01-01T00:00:00.000Z"}]'`),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('rejects past_due without its tier and clock', async () => {
    expect(
      await sqlState(
        update(`state = 'past_due', tier = 'pro',
                state_history = state_history || '[{"state":"past_due","since":"2099-01-01T00:00:00.000Z"}]'`),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  /**
   * Each case below breaks one CHECK and satisfies the others, and its control makes the same write
   * with the missing field supplied, inside a transaction that is rolled back. Without the control,
   * a write rejected by a different CHECK would pass for this one.
   */
  const accepted = async (set: string): Promise<string> =>
    sqlState(() =>
      db.transaction(async (tx) => {
        await tx.query(`update public.accounts set ${set} where id = $1`, [account]);
        await tx.rollback();
      }),
    );
  const pastDue = `state = 'past_due', tier = 'pro', past_due_tier = 'pro', current_subscription_id = 'sub_x',
    state_history = state_history || '[{"state":"past_due","since":"2099-01-01T00:00:00.000Z"}]'`;
  const proTrial = `state = 'pro_trial', tier = 'pro', trial_ends_at = now(), trial_used_at = now(),
    state_history = state_history || '[{"state":"pro_trial","since":"2099-01-01T00:00:00.000Z"}]'`;
  const agencyTrial = `state = 'agency_trial', tier = 'agency', trial_ends_at = now(), current_subscription_id = 'sub_x',
    state_history = state_history || '[{"state":"agency_trial","since":"2099-01-01T00:00:00.000Z"}]'`;

  it('accounts_past_due: rejects past_due without past_due_since', async () => {
    expect(await sqlState(update(pastDue))).toBe(CHECK_VIOLATION);
    expect(await accepted(`${pastDue}, past_due_since = now()`)).toBe('ok');
  });

  it('accounts_past_due: rejects past_due_since outside past_due', async () => {
    expect(await sqlState(update(`past_due_since = now()`))).toBe(CHECK_VIOLATION);
    expect(await accepted(`past_due_since = null`)).toBe('ok');
  });

  it('accounts_trial_fields: rejects a Pro trial without a variant', async () => {
    expect(await sqlState(update(proTrial))).toBe(CHECK_VIOLATION);
    expect(await accepted(`${proTrial}, trial_variant = 'no_card'`)).toBe('ok');
  });

  it('accounts_trial_fields: rejects a trial without trial_used_at', async () => {
    expect(await sqlState(update(agencyTrial))).toBe(CHECK_VIOLATION);
    expect(await accepted(`${agencyTrial}, trial_used_at = now()`)).toBe('ok');
  });

  it('rejects a history whose last entry is not the current state', async () => {
    expect(
      await sqlFailure(
        update(
          `state_history = state_history || '[{"state":"pro","since":"2099-01-01T00:00:00.000Z"}]'`,
        ),
      ),
    ).toMatch(/^23514 .*accounts_state_history/);
  });

  it('accounts_tier_matches_state: rejects a past_due tier that is not past_due_tier', async () => {
    const pastDueAs = (
      tier: string,
    ) => `state = 'past_due', tier = '${tier}', past_due_tier = 'agency',
      past_due_since = now(), current_subscription_id = 'sub_x',
      state_history = state_history || '[{"state":"past_due","since":"2099-01-01T00:00:00.000Z"}]'`;
    expect(await sqlState(update(pastDueAs('pro')))).toBe(CHECK_VIOLATION);
    expect(await accepted(pastDueAs('agency'))).toBe('ok');
  });

  it('accounts_subscription: a paid state follows a subscription, a no-card trial follows none', async () => {
    const pro = `state = 'pro', tier = 'pro',
      state_history = state_history || '[{"state":"pro","since":"2099-01-01T00:00:00.000Z"}]'`;
    expect(await sqlState(update(pro))).toBe(CHECK_VIOLATION);
    expect(await accepted(`${pro}, current_subscription_id = 'sub_x'`)).toBe('ok');
    const noCard = `${proTrial}, trial_variant = 'no_card'`;
    expect(await sqlState(update(`${noCard}, current_subscription_id = 'sub_x'`))).toBe(
      CHECK_VIOLATION,
    );
    expect(await accepted(noCard)).toBe('ok');
  });

  it('accepts 200 history entries and rejects 201', async () => {
    // The first entry is kept: changing it is the trigger's to refuse, tested below.
    const entries = (n: number) =>
      `jsonb_build_array(state_history -> 0) || (select jsonb_agg(jsonb_build_object('state', 'free', 'since',
          to_char(timestamptz '2099-01-01' + g * interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by g)
        from generate_series(1, ${n - 1}) g)`;
    expect(await accepted(`state_history = ${entries(200)}`)).toBe('ok');
    expect(await sqlState(update(`state_history = ${entries(201)}`))).toBe(CHECK_VIOLATION);
  });

  it('refuses an update whose new row changes the first history entry; appending stays allowed', async () => {
    const free = `'[{"state":"free","since":"2099-01-01T00:00:00.000Z"}]'`;
    const REFUSED = /^23514 .*may not change the first state_history entry/;
    // Dropping the first entry, or rewriting it, is refused.
    expect(await sqlFailure(update(`state_history = (state_history - 0) || ${free}`))).toMatch(
      REFUSED,
    );
    expect(
      await sqlFailure(
        update(
          `state_history = jsonb_set(state_history, '{0,since}', '"2000-01-01T00:00:00.000Z"')`,
        ),
      ),
    ).toMatch(REFUSED);
    // Control: appending keeps the first entry and is accepted.
    expect(await accepted(`state_history = state_history || ${free}`)).toBe('ok');
    // The service role is held to it too.
    expect(
      await sqlFailure(() =>
        asRole(db, 'service_role', null, (tx) =>
          tx.query(
            `update public.accounts set state_history = (state_history - 0) || ${free} where id = $1`,
            [account],
          ),
        ),
      ),
    ).toMatch(REFUSED);
  });

  it('refuses a first-entry change made by an earlier BEFORE trigger, on an update that names another column', async () => {
    // "a_" sorts before "accounts_", so this trigger runs first; the update does not name state_history.
    await db.exec(`
      create function pg_temp.rewrite_first() returns trigger language plpgsql as $fn$
      begin
        new.state_history := jsonb_set(new.state_history, '{0,since}', '"2000-01-01T00:00:00.000Z"');
        return new;
      end $fn$;
      create trigger a_rewrite_first before update on public.accounts
        for each row execute function pg_temp.rewrite_first();`);
    try {
      expect(await sqlFailure(update(`name = 'renamed'`))).toMatch(
        /^23514 .*may not change the first state_history entry/,
      );
    } finally {
      await db.exec(`drop trigger a_rewrite_first on public.accounts;`);
    }
    // Control: without the rewriting trigger, the same update is accepted.
    expect(await accepted(`name = 'renamed'`)).toBe('ok');
  });
});

describe('the other new tables hold their CHECKs, each broken on its own', () => {
  let db: PGlite;
  let account: string;
  let user: string;
  beforeAll(async () => {
    db = await freshDb();
    await applyAllMigrations(db);
    user = await signUp(db, 'tables@example.com');
    account = await defaultAccount(db, user);
  }, 120_000);

  /** Runs the insert, then rolls it back, so each case starts from the same rows. */
  const tryInsert = (sql: string, params: unknown[] = []) =>
    sqlState(() =>
      db.transaction(async (tx) => {
        await tx.query(sql, params);
        await tx.rollback();
      }),
    );
  const brand = (columns: string, values: string) =>
    tryInsert(
      `insert into public.agency_brands (account_id, agency_name, ${columns}) values ($1, 'A', ${values})`,
      [account],
    );

  it('agency_brands_dns: a portal domain carries its DNS result', async () => {
    expect(await brand('portal_domain', `'audits.example.com'`)).toBe(CHECK_VIOLATION);
    expect(await brand('portal_domain, portal_cname_found', `'audits.example.com', false`)).toBe(
      'ok',
    );
  });

  it('agency_brands_email_auth: a sender carries its SPF and DKIM results', async () => {
    expect(await brand('sender_from, postal_address', `'r@example.com', '1 Main St'`)).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await brand(
        'sender_from, postal_address, spf_passes, dkim_passes',
        `'r@example.com', '1 Main St', false, false`,
      ),
    ).toBe('ok');
  });

  it('agency_brands_postal: a sender needs a postal address', async () => {
    expect(
      await brand('sender_from, spf_passes, dkim_passes', `'r@example.com', false, false`),
    ).toBe(CHECK_VIOLATION);
  });

  it('subscriptions_extras_agency_only: Pro carries no extras', async () => {
    const sub = (plan: string) =>
      tryInsert(
        `insert into public.subscriptions (id, account_id, status, plan, interval, seat_quantity)
         values ('sub_t', $1, 'active', $2, 'month', 1)`,
        [account, plan],
      );
    expect(await sub('pro')).toBe(CHECK_VIOLATION);
    expect(await sub('agency')).toBe('ok');
  });

  it('seats_removed_at: a removed seat records when, and only a removed seat does', async () => {
    const seat = (status: string, removedAt: string) =>
      tryInsert(
        `insert into public.seats (account_id, invited_email, role, status, removed_at)
         values ($1, 'x@example.com', 'developer', $2, ${removedAt})`,
        [account, status],
      );
    expect(await seat('removed', 'null')).toBe(CHECK_VIOLATION);
    expect(await seat('invited', 'now()')).toBe(CHECK_VIOLATION);
    expect(await seat('removed', 'now()')).toBe('ok');
  });

  it('seats_active_is_accepted: an active seat has a user and an acceptance time', async () => {
    const active = (acceptedAt: string) =>
      tryInsert(
        `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
         values ($1, $2, 'y@example.com', 'developer', 'active', ${acceptedAt})`,
        [account, user],
      );
    expect(await active('null')).toBe(CHECK_VIOLATION);
  });
});
