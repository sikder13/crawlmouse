import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseFounderStore, type FounderStore } from '../lib/v2/ops/founder-store';
import { withInternal } from './helpers/accounts-internal';
import { applyAllMigrations, freshDb } from './helpers/pglite-migrations';
import { postgrestOver } from './helpers/postgrest-pglite';
import { personalAccount, signUp } from './helpers/v2-check-tables';

/**
 * The founder store's queries (lib/v2/ops/founder-store.ts) run against the migrated schema through
 * the PostgREST stand-in, as service_role: what each read returns, and that each RPC's answer parses.
 */

let db: PGlite;
let store: FounderStore;
beforeAll(async () => {
  db = await freshDb();
  await applyAllMigrations(db, withInternal);
  store = supabaseFounderStore(postgrestOver(db));
}, 300_000);
afterAll(async () => {
  await db?.close();
});

async function person(createdAt: string) {
  const userId = await signUp(db, `founder-${randomUUID()}@example.com`);
  await db.query('update public.users set created_at = $2 where id = $1', [userId, createdAt]);
  const { accountId } = await personalAccount(db, userId);
  return { userId, accountId };
}

describe('account', () => {
  it('reads the internal mark, the history, the subscription, the owner’s address and the first site', async () => {
    const email = `owner-${randomUUID()}@example.com`;
    const userId = await signUp(db, email);
    const { accountId } = await personalAccount(db, userId);
    await db.query('update public.accounts set internal = true where id = $1', [accountId]);
    for (const [host, created, removed] of [
      ['removed.example', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'],
      ['second.example', '2026-01-03T00:00:00Z', null],
      ['first.example', '2026-01-02T00:00:00Z', null],
    ] as const) {
      await db.query(
        'insert into public.sites (account_id, host, created_at, removed_at) values ($1, $2, $3, $4)',
        [accountId, host, created, removed],
      );
    }
    const a = await store.account(accountId);
    expect(a).toMatchObject({
      internal: true,
      subscriptionId: null,
      ownerEmail: email,
      host: 'first.example',
    });
    expect(a!.history.map((h) => h.state)).toEqual(['free']);
  });

  it('answers null for an account that does not exist, and no host for one with no site', async () => {
    expect(await store.account(randomUUID())).toBeNull();
    const { accountId } = await person('2026-05-01T00:00:00Z');
    expect((await store.account(accountId))!.host).toBeNull();
  });
});

describe('unannouncedUsers', () => {
  it('lists users created since the time with no signup notice, oldest first, bounded', async () => {
    // A window of its own, in 2030.
    const a = await person('2030-01-01T00:00:03Z');
    const b = await person('2030-01-01T00:00:01Z');
    const c = await person('2030-01-01T00:00:02Z');
    await person('2029-12-31T23:59:59Z');
    await store.claim({
      key: `signup:${c.userId}`,
      kind: 'signup',
      accountId: c.accountId,
      internal: false,
      occurredAt: '2030-01-01T00:00:02.000Z',
      facts: {},
      now: new Date('2030-01-02T00:00:00Z'),
      limit: 20,
      configured: true,
    });
    expect(await store.unannouncedUsers('2030-01-01T00:00:00.000Z', 10)).toEqual([
      { userId: b.userId, accountId: b.accountId, createdAt: '2030-01-01T00:00:01.000Z' },
      { userId: a.userId, accountId: a.accountId, createdAt: '2030-01-01T00:00:03.000Z' },
    ]);
    expect(await store.unannouncedUsers('2030-01-01T00:00:00.000Z', 1)).toHaveLength(1);
  });
});

describe('agencyAccounts and cancellations', () => {
  it('lists agency accounts created since the time, and no personal one', async () => {
    const { accountId } = await person('2031-01-01T00:00:00Z');
    const agency = randomUUID();
    await db.query(
      `insert into public.accounts (id, kind, state, tier, seat_limit, site_limit, state_history, created_at)
       values ($1, 'agency', 'free', 'free', 1, 1, jsonb_build_array(jsonb_build_object('state', 'free', 'since', '2031-03-01T00:00:00.000Z')), '2031-03-01T00:00:00Z')`,
      [agency],
    );
    await db.query("update public.accounts set created_at = '2031-03-01T00:00:00Z' where id = $1", [
      accountId,
    ]);
    expect(await store.agencyAccounts('2031-02-28T00:00:00.000Z')).toEqual([
      { accountId: agency, createdAt: '2031-03-01T00:00:00.000Z' },
    ]);
  });

  it('lists subscriptions canceled since the time', async () => {
    const { accountId } = await person('2031-04-01T00:00:00Z');
    const sub = (n: number) => `sub_founder${n}${randomUUID().slice(0, 8)}`;
    const [s1, s2] = [sub(1), sub(2)];
    await db.query(
      `insert into public.subscriptions (id, account_id, status, plan, interval, canceled_at)
       values ($1, $3, 'canceled', 'pro', 'month', '2031-04-02T00:00:00Z'),
              ($2, $3, 'active', 'pro', 'month', '2031-03-30T00:00:00Z')`,
      [s1, s2, accountId],
    );
    expect(await store.cancellations('2031-04-01T00:00:00.000Z')).toEqual([
      { subscriptionId: s1, accountId, plan: 'pro', canceledAt: '2031-04-02T00:00:00.000Z' },
    ]);
  });
});

describe('the RPCs parse', () => {
  it('claim, take and the digest counts answer in the shapes the store reads', async () => {
    const now = new Date('2032-01-01T10:00:00Z');
    const claim = (key: string) =>
      store.claim({
        key,
        kind: 'payment',
        accountId: null,
        internal: false,
        occurredAt: now.toISOString(),
        facts: { plan: 'pro', payment: 'first' },
        now,
        limit: 1,
        configured: true,
      });
    expect(await claim(`entitlement:${randomUUID()}`)).toBe('send');
    expect(await claim(`entitlement:${randomUUID()}`)).toBe('held');
    const t = await store.takeOverflow(`overflow:${randomUUID()}`, 10);
    expect(t.total).toBeGreaterThanOrEqual(1);
    expect(t.rows[t.rows.length - 1]).toEqual({
      kind: 'payment',
      accountId: null,
      internal: false,
    });
    const counts = await store.digestCounts('2032-01-01T00:00:00.000Z', '2032-01-02T00:00:00.000Z');
    expect(counts.payments_first_or_returning).toBe(2);
  });
});
