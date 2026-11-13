import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryLedger, memoryTransport, type MemoryTransport } from '../lib/v2/mail/memory';
import { MailRetry } from '../lib/v2/mail/send';
import type { OutgoingMail } from '../lib/v2/mail/types';
import { sweep, type FounderDeps } from '../lib/v2/ops/founder';
import { supabaseFounderStore, type FounderStore } from '../lib/v2/ops/founder-store';
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
  await applyAllMigrations(db);
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
  it('lists users created since the time and not announced, oldest first, bounded', async () => {
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
    await ledgerRow(`founder_event:signup:${c.userId}`, 'sent', 1);
    expect(await store.unannouncedUsers('2030-01-01T00:00:00.000Z', 10, 0)).toEqual([
      { userId: b.userId, accountId: b.accountId, createdAt: '2030-01-01T00:00:01.000Z' },
      { userId: a.userId, accountId: a.accountId, createdAt: '2030-01-01T00:00:03.000Z' },
    ]);
    expect(await store.unannouncedUsers('2030-01-01T00:00:00.000Z', 1, 0)).toHaveLength(1);
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

const FOUNDER = ['qzx-founder', 'inbox.example'].join('@');

/** A transport that throws on its first send and records the rest. */
function throwsOnce(): MemoryTransport {
  const inner = memoryTransport();
  let thrown = false;
  return {
    sent: inner.sent,
    async send(m: OutgoingMail) {
      if (!thrown) {
        thrown = true;
        throw new Error('network');
      }
      return inner.send(m);
    },
  };
}

/** The sweep over this store, the in-memory mail ledger and `transport`, at `now`. */
function sweepDeps(
  now: () => Date,
  transport: MemoryTransport,
  confirmed: (userId: string) => boolean = () => true,
): FounderDeps {
  return {
    mail: {
      ledger: memoryLedger(),
      transport,
      pepper: 'p'.repeat(40),
      now,
      log: () => undefined,
    },
    store,
    latestInvoice: async () => null,
    confirmed: async (u) => confirmed(u),
    to: FOUNDER,
    now,
    log: () => undefined,
  };
}

const ledgerRow = (key: string, status: string, attempts: number) =>
  db.query(
    `insert into public.email_sends (idempotency_key, kind, address_hash, status, attempts, claimed_at,
                                     sent_at, updated_at)
     values ($1, 'alert', $2, $3, $4, now(), case when $3 = 'sent' then now() end, now())`,
    [key, randomUUID().replace(/-/g, '').padEnd(64, '0'), status, attempts],
  );

describe('a sign-up whose mail failed (review C1)', () => {
  it('is offered again until its ledger key is sent: a send that threw is mailed once on the retry', async () => {
    // A window of its own, in 2033.
    const { userId } = await person('2033-03-01T10:00:00Z');
    const now = () => new Date('2033-03-01T12:00:00.000Z');
    const transport = throwsOnce();
    const d = sweepDeps(now, transport);
    await expect(sweep(d)).rejects.toThrow(MailRetry);
    expect(await sweep(d)).toMatchObject({ signups: { sent: 1 } });
    expect(await sweep(d)).toMatchObject({ signups: { done: 1 } });
    expect(transport.sent.map((m) => m.idempotencyKey)).toEqual([
      `founder_event:signup:${userId}`,
    ]);
  });

  it('reads the mail ledger: re-offers a `send` notice whose key is unsent and can still be tried', async () => {
    const since = '2034-01-01T00:00:00.000Z';
    const now = new Date('2034-01-02T00:00:00Z');
    const users: Record<string, string> = {};
    for (const [name, at] of [
      ['noLedger', '2034-01-01T00:00:01Z'],
      ['failedOnce', '2034-01-01T00:00:02Z'],
      ['sent', '2034-01-01T00:00:03Z'],
      ['exhausted', '2034-01-01T00:00:04Z'],
      ['suppressed', '2034-01-01T00:00:05Z'],
      ['held', '2034-01-01T00:00:06Z'],
      ['skipped', '2034-01-01T00:00:07Z'],
    ] as const) {
      const { userId, accountId } = await person(at);
      users[name] = userId;
      await store.claim({
        key: `signup:${userId}`,
        kind: 'signup',
        accountId,
        internal: false,
        occurredAt: at,
        facts: {},
        now,
        // `held`: the hour's bound is already full for it; `skipped`: unconfigured.
        limit: name === 'held' ? 1 : 1000,
        configured: name !== 'skipped',
      });
    }
    await ledgerRow(`founder_event:signup:${users.failedOnce}`, 'failed', 1);
    await ledgerRow(`founder_event:signup:${users.sent}`, 'sent', 1);
    await ledgerRow(`founder_event:signup:${users.exhausted}`, 'failed', 3);
    await ledgerRow(`founder_event:signup:${users.suppressed}`, 'suppressed', 0);
    expect((await store.unannouncedUsers(since, 50, 0)).map((u) => u.userId)).toEqual([
      users.noLedger,
      users.failedOnce,
    ]);
  });
});

describe('the sign-up rotation (review C8)', () => {
  it('takes p_limit users a run from position (turn × limit) mod n, oldest first, wrapping', async () => {
    const since = '2035-01-01T00:00:00.000Z';
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await person(`2035-01-01T00:00:0${i}Z`)).userId);
    const at = async (turn: number) =>
      (await store.unannouncedUsers(since, 2, turn)).map((u) => ids.indexOf(u.userId));
    expect(await at(0)).toEqual([0, 1]);
    expect(await at(1)).toEqual([2, 3]);
    expect(await at(2)).toEqual([4, 0]);
    expect(await at(3)).toEqual([1, 2]);
    // n = 5 and 2 × 5 = 10 ≡ 0: turn 5 starts where turn 0 did.
    expect(await at(5)).toEqual([0, 1]);
    await expect(store.unannouncedUsers(since, 2, -1)).rejects.toThrow(/founder_signups_unannounced/);
  });

  it('a confirmed user behind more than a run’s worth of unconfirmed ones is announced on the next run', async () => {
    // 201 unconfirmed users created before one confirmed one: oldest first, a run of 200 never
    // reached it. The run whose turn × 200 ≡ 0 (mod 202) starts at the oldest; the next one starts
    // at position 200, where the confirmed user is.
    const turn = 6_880_928; // ≡ 0 (mod 202): 2035-06-01T02:40:00Z
    const now = new Date(turn * 300_000);
    for (let i = 0; i < 201; i++)
      await person(new Date(now.getTime() - 86_400_000 + i * 1000).toISOString());
    const { userId: confirmedUser } = await person(
      new Date(now.getTime() - 3_600_000).toISOString(),
    );
    const transport = memoryTransport();
    let clock = now;
    const d = sweepDeps(() => clock, transport, (u) => u === confirmedUser);
    expect((await sweep(d)).signups).toEqual({ unconfirmed: 200 });
    clock = new Date(now.getTime() + 300_000);
    expect((await sweep(d)).signups).toEqual({ unconfirmed: 199, sent: 1 });
    expect(transport.sent.map((m) => m.idempotencyKey)).toEqual([
      `founder_event:signup:${confirmedUser}`,
    ]);
  }, 120_000);
});
