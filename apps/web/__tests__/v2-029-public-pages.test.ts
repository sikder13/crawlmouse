import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { postgrestOver } from './helpers/postgrest-pglite';
import { personalAccount, signUp } from './helpers/v2-check-tables';
import { agencyCheckouts } from '../app/api/agency-trial/_lib/checkouts';
import { readUsedAgencyTrial } from '../lib/v2/pricing/used-trial';
import { supabaseMailStore } from '../lib/v2/mail/store';

/**
 * Migration 20261114000001 (CC-29): start_agency_trial_account, contact_requests and one public report
 * per check, on PGlite with every migration applied. PGlite has one backend, so calls here run one
 * after the other; two submits racing in real transactions are scripts/db/agency-trial-race.test.ts.
 */

const MIGRATION = '20261114000001_v2_029_public_pages.sql';
const ROLLBACK = '20261114000001_v2_029_public_pages.revert.sql';
const ROLLBACK_028 = '20261113000001_v2_028_monitoring.revert.sql';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db);
}, 300_000);
afterAll(async () => {
  await db?.close();
});

type Answer = { outcome: string; account_id?: string; site_id?: string };

const start = (userId: string, host = 'client.example', name = 'Summit Digital') =>
  asRole(db, 'service_role', null, async (tx) => {
    const { rows } = await tx.query<{ r: Answer }>(
      'select public.start_agency_trial_account($1, $2, $3) as r',
      [userId, name, host],
    );
    return rows[0]!.r;
  });

const person = () => signUp(db, `agency-${randomUUID()}@example.com`);

async function accountRow(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    'select kind, name, state, tier, seat_limit, site_limit from public.accounts where id = $1',
    [id],
  );
  return rows[0];
}

async function sitesOf(accountId: string) {
  const { rows } = await db.query<{ host: string }>(
    'select host from public.sites where account_id = $1 and removed_at is null',
    [accountId],
  );
  return rows.map((r) => r.host);
}

describe('start_agency_trial_account', () => {
  it('creates a second account, kind agency on Free, owned by the person, with the first site', async () => {
    const userId = await person();
    const personal = await personalAccount(db, userId);
    const answer = await start(userId);
    expect(answer.outcome).toBe('created');
    expect(answer.account_id).not.toBe(personal.accountId);
    expect(await accountRow(answer.account_id!)).toEqual({
      kind: 'agency',
      name: 'Summit Digital',
      state: 'free',
      tier: 'free',
      seat_limit: 1,
      site_limit: 1,
    });
    const { rows } = await db.query<{ role: string; status: string }>(
      'select role, status from public.seats where account_id = $1 and user_id = $2',
      [answer.account_id, userId],
    );
    expect(rows).toEqual([{ role: 'owner', status: 'active' }]);
    expect(await sitesOf(answer.account_id!)).toEqual(['client.example']);
    const { rows: consent } = await db.query<{ at: Date | null }>(
      'select agency_trial_consent_at as at from public.accounts where id = $1',
      [answer.account_id],
    );
    expect(consent[0]!.at).toBeInstanceOf(Date);
    const { rows: users } = await db.query<{ default_account_id: string }>(
      'select default_account_id from public.users where id = $1',
      [userId],
    );
    expect(users[0]!.default_account_id).toBe(personal.accountId);
  });

  it('a second submit returns the same account, holding one site: the one named last', async () => {
    const userId = await person();
    const first = await start(userId, 'one.example');
    const again = await start(userId, 'two.example');
    expect(again).toEqual({ ...first, outcome: 'existing' });
    expect(await sitesOf(first.account_id!)).toEqual(['two.example']);
  });

  it('refuses a person whose agency trial was used', async () => {
    const userId = await person();
    const { account_id } = await start(userId);
    await db.query(`update public.accounts set trial_used_at = now() where id = $1`, [account_id]);
    expect(await start(userId)).toEqual({ outcome: 'trial_used' });
  });

  it('refuses a malformed host or name, and an unknown person', async () => {
    const userId = await person();
    for (const [host, name] of [
      ['Client.Example', 'x'],
      ['localhost', 'x'],
      ['a.example/x', 'x'],
      ['a.example', ''],
      ['a.example', 'x'.repeat(121)],
    ])
      await expect(start(userId, host, name)).rejects.toThrow(/not what the route sends/);
    await expect(start(randomUUID())).rejects.toThrow(/no user/);
  });

  it.each(['anon', 'authenticated'] as const)('%s may not execute it', async (role) => {
    const userId = await person();
    await expect(
      asRole(db, role, userId, (tx) =>
        tx.query('select public.start_agency_trial_account($1, $2, $3)', [
          userId,
          'x',
          'a.example',
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(['agency_checkout_url', 'agency_checkout_interval', 'agency_trial_consent_at'])(
    'authenticated cannot read accounts.%s',
    async (column) => {
      const userId = await person();
      await expect(
        asRole(db, 'authenticated', userId, (tx) =>
          tx.query(`select ${column} from public.accounts`),
        ),
      ).rejects.toThrow(/permission denied/);
    },
  );
});

// Correctness B3 / security N3: the stored Checkout carries its interval, so the route reuses it only
// for a submit on the same interval.
describe('the stored agency Checkout', () => {
  const URL = 'https://checkout.stripe.com/c/pay/cs_test_1';

  it('the route’s port stores the URL, the time and the interval, and reads them back', async () => {
    const userId = await person();
    const { account_id } = await start(userId);
    const port = agencyCheckouts(postgrestOver(db) as never);
    expect(await port.open(account_id!)).toBeNull();
    const at = new Date('2026-11-12T12:00:00.000Z');
    for (const interval of ['year', 'month'] as const) {
      await port.store(account_id!, { url: URL, at, interval });
      expect(await port.open(account_id!)).toEqual({ url: URL, at, interval });
    }
  });

  it('accounts.agency_checkout_interval holds month, year or nothing', async () => {
    const userId = await person();
    const { account_id } = await start(userId);
    for (const ok of ['month', 'year', null]) {
      await db.query('update public.accounts set agency_checkout_interval = $2 where id = $1', [
        account_id,
        ok,
      ]);
    }
    await expect(
      db.query(`update public.accounts set agency_checkout_interval = 'week' where id = $1`, [
        account_id,
      ]),
    ).rejects.toThrow(/accounts_agency_checkout_interval_check/);
  });
});

// Correctness N5: the Agency trial page and Pricing read a used trial by the function's own rule,
// a deleted account included. Each attribute the rule keys on is varied, alone and together, and
// the read must say "used" exactly when the function answers trial_used.
describe('readUsedAgencyTrial agrees with start_agency_trial_account', () => {
  const cases: {
    kind: 'agency' | 'personal';
    used: boolean;
    deleted: boolean;
    role: 'owner' | 'account_manager';
    removed: boolean;
  }[] = [];
  for (const kind of ['agency', 'personal'] as const)
    for (const used of [false, true])
      for (const deleted of [false, true])
        for (const role of ['owner', 'account_manager'] as const)
          for (const removed of [false, true]) cases.push({ kind, used, deleted, role, removed });

  it.each(cases)('%j', async (c) => {
    const userId = await person();
    const account =
      c.kind === 'agency'
        ? (await start(userId)).account_id!
        : (await personalAccount(db, userId)).accountId;
    await db.query(
      `update public.accounts
          set trial_used_at = case when $2 then now() - interval '3 days' end,
              deleted_at = case when $3 then now() end
        where id = $1`,
      [account, c.used, c.deleted],
    );
    await db.query(
      `update public.seats
          set role = $3,
              status = case when $4 then 'removed' else 'active' end,
              removed_at = case when $4 then now() end
        where account_id = $1 and user_id = $2`,
      [account, userId, c.role, c.removed],
    );
    const read = await readUsedAgencyTrial(postgrestOver(db) as never, userId);
    const answer = await start(userId, 'other.example');
    expect(read !== null).toBe(answer.outcome === 'trial_used');
    if (read !== null) expect(read).toMatchObject({ accountId: account, deleted: c.deleted });
  });

  it('the sweep reaches both answers, a deleted account among the used', () => {
    const counted = cases.filter(
      (c) => c.kind === 'agency' && c.used && c.role === 'owner' && !c.removed,
    );
    expect(counted.map((c) => c.deleted)).toEqual([false, true]);
  });
});

// Correctness N-r2-1: the function stops a person starting a second trial once one is used, but not
// holding two used agency accounts (a second owner seat on another agency account, or an account
// made before either trial was used). The read then names the live one, whichever was used first, so
// Pricing can offer its paid plan rather than "used on an account since deleted".
describe('readUsedAgencyTrial with two used agency accounts', () => {
  async function agencyAccount(userId: string, usedDaysAgo: number, deleted: boolean) {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.accounts
         (kind, state, tier, seat_limit, site_limit, state_history, trial_used_at, deleted_at)
       values ('agency', 'free', 'free', 5, 25,
               '[{"state":"free","since":"2026-01-01T00:00:00.000Z"}]',
               now() - make_interval(days => $1), case when $2 then now() end)
       returning id`,
      [usedDaysAgo, deleted],
    );
    await db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, $2, 'owner@example.com', 'owner', 'active', now())`,
      [rows[0]!.id, userId],
    );
    return rows[0]!.id;
  }

  it.each([
    ['the deleted one used first', 9, 3],
    ['the deleted one used last', 3, 9],
  ])('a live and a deleted one, %s: the live one', async (_, deletedAgo, liveAgo) => {
    const userId = await person();
    const deleted = await agencyAccount(userId, deletedAgo, true);
    const live = await agencyAccount(userId, liveAgo, false);
    expect(deleted).not.toBe(live);
    const read = await readUsedAgencyTrial(postgrestOver(db) as never, userId);
    expect(read).toMatchObject({ accountId: live, deleted: false });
    expect((await start(userId, 'other.example')).outcome).toBe('trial_used');
  });

  it('two deleted ones: the one used first, still used', async () => {
    const userId = await person();
    const first = await agencyAccount(userId, 9, true);
    await agencyAccount(userId, 3, true);
    const read = await readUsedAgencyTrial(postgrestOver(db) as never, userId);
    expect(read).toMatchObject({ accountId: first, deleted: true });
  });
});

describe('contact_requests', () => {
  it.each(['anon', 'authenticated'] as const)('%s can neither read nor write it', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query('select * from public.contact_requests')),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asRole(db, role, null, (tx) =>
        tx.query(`insert into public.contact_requests (email) values ('a@b.example')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('contact_requests: the mail store reads, marks and deletes them (CC-29, rulings Q38)', () => {
  const store = () => supabaseMailStore(postgrestOver(db));
  const DAY = 86_400_000;
  const NOW = new Date('2026-12-01T12:00:00.000Z');

  const request = async (sentAt: Date | null, note: string | null = 'A note.') => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.contact_requests (email, sites, note, sent_at)
       values ($1, 40, $2, $3) returning id`,
      [`buyer-${randomUUID()}@agency.example`, note, sentAt?.toISOString() ?? null],
    );
    return rows[0]!.id;
  };
  const exists = async (id: string) =>
    (await db.query('select 1 from public.contact_requests where id = $1', [id])).rows.length === 1;

  it('reads a request by id, and null for none', async () => {
    const id = await request(null, null);
    expect(await store().contactRequest(id)).toMatchObject({
      sites: 40,
      note: null,
      sentAt: null,
    });
    expect((await store().contactRequest(id))!.email).toMatch(/^buyer-.*@agency\.example$/);
    expect(await store().contactRequest(randomUUID())).toBeNull();
  });

  it('marks a request sent once: a second mark leaves the first time', async () => {
    const id = await request(null);
    await store().markContactSent(id, NOW);
    await store().markContactSent(id, new Date(NOW.getTime() + DAY));
    expect((await store().contactRequest(id))!.sentAt).toBe(NOW.toISOString());
  });

  // A sent row goes 30 days after sent_at, an unsent one 30 days after created_at: the line is strict,
  // so a row exactly 30 days old is kept and one a millisecond older is deleted.
  it('deletes each request 30 days after it was sent, or after it was made when it was not', async () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms);
    const made = async (createdAt: Date, sentAt: Date | null) => {
      const id = await request(sentAt);
      await db.query(`update public.contact_requests set created_at = $2 where id = $1`, [
        id,
        createdAt.toISOString(),
      ]);
      return id;
    };
    const rows = {
      sentPast: await made(ago(31 * DAY), ago(30 * DAY + 1)),
      sentEdge: await made(ago(31 * DAY), ago(30 * DAY)),
      sentRecentMadeLongAgo: await made(ago(400 * DAY), ago(29 * DAY)),
      unsentPast: await made(ago(30 * DAY + 1), null),
      unsentEdge: await made(ago(30 * DAY), null),
      unsentRecent: await made(ago(29 * DAY), null),
    };
    const deleted = await store().purgeContacts(NOW);
    expect(deleted).toBeGreaterThanOrEqual(2);
    const kept = Object.fromEntries(
      await Promise.all(Object.entries(rows).map(async ([k, id]) => [k, await exists(id)])),
    );
    expect(kept).toEqual({
      sentPast: false,
      sentEdge: true,
      sentRecentMadeLongAgo: true,
      unsentPast: false,
      unsentEdge: true,
      unsentRecent: true,
    });
    expect(await store().purgeContacts(NOW)).toBe(0);
  });

  it.each(['anon', 'authenticated'] as const)('%s cannot run the deletion', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query('select public.purge_contact_requests(now())')),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('email_sends: the agency_plus_contact kind', () => {
  const claim = (key: string, kind: string) =>
    asRole(db, 'service_role', null, async (tx) => {
      const { rows } = await tx.query<{ r: { outcome: string } }>(
        'select public.claim_email_send($1, $2, $3, null, now()) as r',
        [key, kind, 'a'.repeat(64)],
      );
      return rows[0]!.r;
    });

  it('the ledger takes the kind, and still refuses one it does not name', async () => {
    expect(await claim(`agency_plus_contact:${randomUUID()}`, 'agency_plus_contact')).toEqual({
      outcome: 'go',
      attempt: 1,
    });
    await expect(claim(`x:${randomUUID()}`, 'agency_plus_other')).rejects.toThrow(
      /email_sends_kind_check/,
    );
  });

  it('a suppression does not stop it', async () => {
    const { rows } = await db.query<{ s: boolean }>(
      `select public.email_kind_suppressible('agency_plus_contact') as s`,
    );
    expect(rows[0]!.s).toBe(false);
  });
});

describe('public_reports_check_uq', () => {
  it('holds one report per check, and any number with no check', async () => {
    const { rows } = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'public_reports_check_uq'`,
    );
    expect(rows[0]!.indexdef).toMatch(
      /UNIQUE INDEX .* \(check_id\) WHERE \(check_id IS NOT NULL\)/,
    );
  });
});

describe('the rollback', () => {
  it('removes what the migration adds, twice over, and the migration applies again', async () => {
    const own = await freshDb();
    try {
      const kindCheck = async () =>
        (
          await own.query<{ def: string }>(
            `select pg_get_constraintdef(oid) as def from pg_constraint
              where conrelid = 'public.email_sends'::regclass and conname = 'email_sends_kind_check'`,
          )
        ).rows.map((r) => r.def);
      // CC-28's check as it stands before this migration, to hold the rollback's restore to.
      await applyAllMigrations(own, undefined, (f) => f < MIGRATION);
      const before = await kindCheck();
      expect(before).toHaveLength(1);
      expect(before[0]).not.toContain('agency_plus_contact');
      await applyAllMigrations(own, undefined, (f) => f >= MIGRATION);
      const present = async () =>
        (
          await own.query<{ n: number }>(
            `select (select count(*) from pg_proc where proname = 'start_agency_trial_account')
                  + (select count(*) from pg_proc where proname = 'purge_contact_requests')
                  + (select count(*) from pg_constraint
                      where conname = 'email_sends_kind_check'
                        and pg_get_constraintdef(oid) like '%agency_plus_contact%')
                  + (select count(*) from pg_tables where tablename = 'contact_requests')
                  + (select count(*) from pg_indexes where indexname = 'public_reports_check_uq')
                  + (select count(*) from information_schema.columns
                      where table_name = 'accounts'
                        and column_name in ('agency_checkout_url', 'agency_checkout_at',
                                            'agency_checkout_interval',
                                            'agency_trial_consent_at')) as n`,
          )
        ).rows[0]!.n;
      expect(Number(await present())).toBe(9);
      await own.query(
        `insert into public.email_sends (idempotency_key, kind, address_hash, status, attempts,
                                         claimed_at, updated_at)
         values ('agency_plus_contact:r', 'agency_plus_contact', $1, 'sending', 1, now(), now())`,
        ['b'.repeat(64)],
      );
      await own.exec(readRollback(ROLLBACK));
      await own.exec(readRollback(ROLLBACK));
      expect(Number(await present())).toBe(0);
      // CC-28's check is back exactly as it was before this migration, and the only one in force.
      expect(await kindCheck()).toEqual(before);
      await own.exec(readMigration(MIGRATION));
      await own.exec(readMigration(MIGRATION));
      expect(Number(await present())).toBe(9);
    } finally {
      await own.close();
    }
  }, 300_000);

  // db-rollback-prod.yml runs one file at a time, so the owner can revert 028 first.
  it('runs, twice over, after 028 has been reverted', async () => {
    const own = await freshDb();
    try {
      await applyAllMigrations(own);
      await own.exec(readRollback(ROLLBACK_028));
      await own.exec(readRollback(ROLLBACK));
      await own.exec(readRollback(ROLLBACK));
      const { rows } = await own.query<{
        sends: string | null;
        contacts: string | null;
        n: number;
      }>(
        `select pg_catalog.to_regclass('public.email_sends')::text as sends,
                pg_catalog.to_regclass('public.contact_requests')::text as contacts,
                (select count(*) from pg_proc
                  where proname in ('purge_contact_requests', 'start_agency_trial_account'))::int as n`,
      );
      expect(rows[0]).toEqual({ sends: null, contacts: null, n: 0 });
    } finally {
      await own.close();
    }
  }, 300_000);
});
