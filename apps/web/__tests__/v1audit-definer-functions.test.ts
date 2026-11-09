import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyAllMigrations, asRole, freshDb } from './helpers/pglite-migrations';
import { ROWS, insertRow, seedWorld, signUp, type World } from './helpers/v2-check-tables';

/**
 * The four SECURITY DEFINER functions `authenticated` may execute (CC-V1AUDIT D10): is_member,
 * member_role, is_member_for_site, usage_counts. Each must decide on the caller's own seat
 * (auth.uid(), status 'active', live account) before it reads anything, so a definer function
 * never answers a question about an account for someone who holds no seat on it.
 *
 * The callers vary what the check keys on: the user (a seat on a different account), the seat's
 * status (removed, invited), the account's liveness (deleted_at), and for is_member_for_site the
 * site (another account's site, a site outside a scoped seat, a staging site of a covered site).
 *
 * "Nothing" per function: is_member → false; member_role → null; is_member_for_site → false;
 * usage_counts → zero rows. anon has no EXECUTE on any of them (permission denied).
 *
 * Mutation harness: V1AUDIT_DEFINER_MUTATE=<name> replaces one function, after the migrations,
 * with a body that skips its membership check (or, for `throw`, raises unconditionally).
 */

vi.setConfig({ testTimeout: 120_000 });

const MUTATIONS: Record<string, string> = {
  throw: `
    create or replace function public.is_member(p_account uuid) returns boolean
    language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp
    as $$ begin raise exception 'MUTATION HARNESS LIVE'; end; $$;`,
  is_member: `
    create or replace function public.is_member(p_account uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public, pg_temp
    as $$ select exists (select 1 from public.seats s join public.accounts a on a.id = s.account_id
                          where s.account_id = p_account and s.status = 'active' and a.deleted_at is null); $$;`,
  member_role: `
    create or replace function public.member_role(p_account uuid) returns text
    language sql stable security definer set search_path = pg_catalog, public, pg_temp
    as $$ select s.role from public.seats s join public.accounts a on a.id = s.account_id
           where s.account_id = p_account and s.status = 'active' and a.deleted_at is null limit 1; $$;`,
  is_member_for_site: `
    create or replace function public.is_member_for_site(p_site uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public, pg_temp
    as $$ select exists (select 1 from public.sites st join public.accounts a on a.id = st.account_id
                          join public.seats s on s.account_id = st.account_id
                          where st.id = p_site and s.status = 'active' and a.deleted_at is null
                            and (s.client_scope_all or exists (select 1 from public.seat_sites ss
                                  where ss.seat_id = s.id and ss.site_id in (st.id, st.staging_of_site_id)))); $$;`,
  usage_counts: `
    create or replace function public.usage_counts(p_account uuid)
    returns table (month date, kind text, result text, billable boolean, events bigint)
    language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp
    as $$ begin
      return query select date_trunc('month', u.occurred_at at time zone 'UTC')::date, u.kind, u.result,
                          u.billable, count(*) from public.usage_events u where u.account_id = p_account
                    group by 1, 2, 3, 4 order by 1, 2, 3, 4;
    end; $$;`,
};

let db: PGlite;
let A: World;
let B: World;
/** A user whose only seat on A is removed, one whose seat on A is still an invitation. */
let removedUser: string;
let invitedUser: string;
/** A world whose account is deleted (deleted_at set); its owner seat stays active. */
let D: World;
/** A staging site of A.site1 and one of A.site2, on account A. */
let stagingOf1: string;
let stagingOf2: string;

beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
  A = await seedWorld(db, 'A');
  B = await seedWorld(db, 'B');
  D = await seedWorld(db, 'D');
  await db.query(`update public.accounts set deleted_at = now() where id = $1`, [D.accountId]);

  removedUser = await signUp(db, 'removed-a@example.com');
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at, removed_at)
     values ($1, $2, 'removed-a@example.com', 'account_manager', 'removed', now(), now())`,
    [A.accountId, removedUser],
  );
  invitedUser = await signUp(db, 'invited-a@example.com');
  await db.query(
    `insert into public.seats (account_id, user_id, invited_email, role, status)
     values ($1, $2, 'invited-a@example.com', 'account_manager', 'invited')`,
    [A.accountId, invitedUser],
  );

  stagingOf1 = randomUUID();
  stagingOf2 = randomUUID();
  for (const [id, of, host] of [
    [stagingOf1, A.site1, 'staging-one.example'],
    [stagingOf2, A.site2, 'staging-two.example'],
  ] as const) {
    await insertRow(db, 'sites', {
      ...ROWS.sites(id, A.accountId, host),
      staging_of_site_id: of,
    });
  }

  const mutation = process.env.V1AUDIT_DEFINER_MUTATE;
  if (mutation) {
    const sql = MUTATIONS[mutation];
    if (!sql) throw new Error(`unknown V1AUDIT_DEFINER_MUTATE=${mutation}`);
    await db.exec(sql);
  }
}, 240_000);

async function call<T>(user: string | null, sql: string, args: unknown[]): Promise<T[]> {
  const role = user === null ? 'anon' : 'authenticated';
  return asRole(db, role, user, async (tx) => (await tx.query<T>(sql, args)).rows);
}

const isMember = async (user: string, account: string) =>
  (await call<{ v: boolean }>(user, `select public.is_member($1) as v`, [account]))[0]!.v;
const memberRole = async (user: string, account: string) =>
  (await call<{ v: string | null }>(user, `select public.member_role($1) as v`, [account]))[0]!.v;
const forSite = async (user: string, site: string) =>
  (await call<{ v: boolean }>(user, `select public.is_member_for_site($1) as v`, [site]))[0]!.v;
const usage = async (user: string, account: string) =>
  call<{ kind: string; events: number }>(
    user,
    `select kind, events::int as events from public.usage_counts($1)`,
    [account],
  );

describe('is_member(p_account): true only for the caller’s own active seat on a live account', () => {
  it('a member of A is a member of A', async () => {
    expect(await isMember(A.ownerId, A.accountId)).toBe(true);
    expect(await isMember(A.scopedUserId, A.accountId)).toBe(true);
  });

  it('a signed-in caller with no active seat on A gets false', async () => {
    expect(await isMember(B.ownerId, A.accountId), 'seat on a different account').toBe(false);
    expect(await isMember(A.ownerId, B.accountId), 'and the other way').toBe(false);
    expect(await isMember(removedUser, A.accountId), 'removed seat').toBe(false);
    expect(await isMember(invitedUser, A.accountId), 'invited seat').toBe(false);
    expect(await isMember(D.ownerId, D.accountId), 'active seat, deleted account').toBe(false);
    const nobody = await asRole(
      db,
      'authenticated',
      null,
      async (tx) =>
        (await tx.query<{ v: boolean }>(`select public.is_member($1) as v`, [A.accountId])).rows,
    );
    expect(nobody[0]!.v, 'authenticated role, no auth.uid()').toBe(false);
  });

  it('anon cannot execute it', async () => {
    await expect(call(null, `select public.is_member($1)`, [A.accountId])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('member_role(p_account): the caller’s own role, null for anyone without an active seat', () => {
  it('a member of A gets their own role on A', async () => {
    expect(await memberRole(A.ownerId, A.accountId)).toBe('owner');
    expect(await memberRole(A.scopedUserId, A.accountId)).toBe('developer');
  });

  it('a signed-in caller with no active seat on A gets null', async () => {
    expect(await memberRole(B.ownerId, A.accountId), 'seat on a different account').toBeNull();
    expect(await memberRole(removedUser, A.accountId), 'removed seat').toBeNull();
    expect(await memberRole(invitedUser, A.accountId), 'invited seat').toBeNull();
    expect(await memberRole(D.ownerId, D.accountId), 'deleted account').toBeNull();
  });

  it('anon cannot execute it', async () => {
    await expect(call(null, `select public.member_role($1)`, [A.accountId])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('is_member_for_site(p_site): true only when the caller’s own active seat covers the site', () => {
  it('a member of A gets true for the sites their seat covers', async () => {
    for (const s of [A.site1, A.site2, stagingOf1, stagingOf2]) {
      expect(await forSite(A.ownerId, s), `owner (client_scope_all) on ${s}`).toBe(true);
    }
    expect(await forSite(A.scopedUserId, A.site1), 'scoped seat, its site').toBe(true);
    expect(await forSite(A.scopedUserId, stagingOf1), 'staging of its site').toBe(true);
  });

  it('a signed-in caller whose seat does not cover the site gets false', async () => {
    expect(await forSite(A.scopedUserId, A.site2), 'scoped seat, other site').toBe(false);
    expect(await forSite(A.scopedUserId, stagingOf2), 'staging of the other site').toBe(false);
    expect(await forSite(A.scopedUserId, B.site1), 'site of another account').toBe(false);
    expect(await forSite(B.ownerId, A.site1), 'seat on a different account').toBe(false);
    expect(await forSite(A.ownerId, B.site1), 'owner of A on B’s site').toBe(false);
    expect(await forSite(removedUser, A.site1), 'removed seat').toBe(false);
    expect(await forSite(invitedUser, A.site1), 'invited seat').toBe(false);
    expect(await forSite(D.ownerId, D.site1), 'deleted account').toBe(false);
    expect(await forSite(A.ownerId, randomUUID()), 'no such site').toBe(false);
  });

  it('anon cannot execute it', async () => {
    await expect(call(null, `select public.is_member_for_site($1)`, [A.site1])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('usage_counts(p_account): counts for a member, zero rows for anyone else', () => {
  // seedWorld writes one billable check_finished event per site, two per account.
  it('a member of A reads A’s counts', async () => {
    for (const user of [A.ownerId, A.scopedUserId]) {
      expect(await usage(user, A.accountId)).toEqual([{ kind: 'check_finished', events: 2 }]);
    }
  });

  it('a signed-in caller with no active seat on A gets zero rows', async () => {
    expect(await usage(B.ownerId, A.accountId), 'seat on a different account').toEqual([]);
    expect(await usage(removedUser, A.accountId), 'removed seat').toEqual([]);
    expect(await usage(invitedUser, A.accountId), 'invited seat').toEqual([]);
    expect(await usage(D.ownerId, D.accountId), 'deleted account').toEqual([]);
    const server = await asRole(
      db,
      'service_role',
      null,
      async (tx) => (await tx.query(`select * from public.usage_counts($1)`, [A.accountId])).rows,
    );
    expect(server, 'no auth.uid(), service_role included').toEqual([]);
  });

  it('anon cannot execute it', async () => {
    await expect(
      call(null, `select * from public.usage_counts($1)`, [A.accountId]),
    ).rejects.toThrow(/permission denied/);
  });
});
