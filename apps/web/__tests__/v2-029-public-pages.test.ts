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

/**
 * Migration 20261114000001 (CC-29): start_agency_trial_account, contact_requests and one public report
 * per check, on PGlite with every migration applied. PGlite has one backend, so calls here run one
 * after the other; two submits racing in real transactions are scripts/db/agency-trial-race.test.ts.
 */

const MIGRATION = '20261114000001_v2_029_public_pages.sql';
const ROLLBACK = '20261114000001_v2_029_public_pages.revert.sql';

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
      await applyAllMigrations(own);
      const present = async () =>
        (
          await own.query<{ n: number }>(
            `select (select count(*) from pg_proc where proname = 'start_agency_trial_account')
                  + (select count(*) from pg_tables where tablename = 'contact_requests')
                  + (select count(*) from pg_indexes where indexname = 'public_reports_check_uq')
                  + (select count(*) from information_schema.columns
                      where table_name = 'accounts'
                        and column_name in ('agency_checkout_url', 'agency_checkout_at',
                                            'agency_checkout_interval',
                                            'agency_trial_consent_at')) as n`,
          )
        ).rows[0]!.n;
      expect(Number(await present())).toBe(7);
      await own.exec(readRollback(ROLLBACK));
      await own.exec(readRollback(ROLLBACK));
      expect(Number(await present())).toBe(0);
      await own.exec(readMigration(MIGRATION));
      await own.exec(readMigration(MIGRATION));
      expect(Number(await present())).toBe(7);
    } finally {
      await own.close();
    }
  }, 300_000);
});
