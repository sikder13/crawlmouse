import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { next, type EntitlementEvent } from '../lib/billing/state-machine';
import {
  snapshotFromRow,
  toTransitionParams,
  type AccountRow,
} from '../lib/billing/state-machine-apply';
import { catalogSnapshot } from './helpers/catalog-snapshot';
import {
  applyAllMigrations,
  asRole,
  freshDb,
  readMigration,
  readRollback,
} from './helpers/pglite-migrations';
import { before, through } from './helpers/v2-check-tables';
import { accountOf, doorDb, signUp } from './v2/_lib/door-pglite';

/**
 * Migration 20261110000001 (CC-03 D4, D5, D13): the stripe_events decision columns and
 * `apply_stripe_event(p)`, against PGlite with every migration applied in order.
 *
 * PGlite has one backend, so two calls never overlap here: each case shows a call's sequential
 * outcome. The races, with two real transactions, are scripts/db/stripe-event-race.test.ts.
 */

const MIGRATION = '20261110000001_v2_billing_rpc.sql';
const ROLLBACK = '20261110000001_v2_billing_rpc.revert.sql';
const CHECKS_DIR = resolve(__dirname, '../../../infra/supabase/checks');

const T = Date.parse('2099-03-01T00:00:00.000Z');
const at = (seconds: number) => new Date(T + seconds * 1000);
const iso = (seconds: number) => at(seconds).toISOString();

let db: PGlite;
beforeAll(async () => {
  db = await doorDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

let seq = 0;
const eventId = () => `evt_rpc${++seq}_${randomUUID().replace(/-/g, '')}`;
const subId = () => `sub_rpc${++seq}`;
const customerId = () => `cus_rpc${++seq}`;

async function freshAccount(d: PGlite = db): Promise<string> {
  const userId = await signUp(d, `rpc-${randomUUID()}@example.com`);
  return (await accountOf(d, userId)).id;
}

async function ledger(d: PGlite, id: string, type = 'customer.subscription.updated') {
  await d.query(`insert into public.stripe_events (id, type, livemode) values ($1, $2, false)`, [
    id,
    type,
  ]);
}

async function accountRow(
  d: PGlite,
  id: string,
): Promise<AccountRow & { stripe_customer_id: string | null }> {
  return (
    await d.query<AccountRow & { stripe_customer_id: string | null }>(
      `select * from public.accounts where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function eventRow(d: PGlite, id: string) {
  return (
    await d.query<{
      account_id: string | null;
      handled: boolean | null;
      handled_reason: string | null;
      effects: unknown;
      processed_at: Date | null;
    }>(
      `select account_id, handled, handled_reason, effects, processed_at from public.stripe_events where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function subRow(d: PGlite, id: string) {
  return (
    await d.query<{
      account_id: string;
      status: string;
      plan: string;
      last_event_created: Date | null;
      last_event_id: string | null;
      price_ids: string[];
    }>(`select * from public.subscriptions where id = $1`, [id])
  ).rows[0];
}

interface Mirror {
  id: string;
  status: string;
  plan: string;
  interval: string;
  seat_quantity: number;
  extra_site_quantity: number;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  price_ids: string[];
}

const mirror = (id: string, status = 'active', plan = 'pro'): Mirror => ({
  id,
  status,
  plan,
  interval: 'month',
  seat_quantity: 0,
  extra_site_quantity: 0,
  current_period_end: iso(30 * 86_400),
  trial_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  ended_at: null,
  price_ids: [`price_crawlmouse_${plan}_monthly`],
});

interface P {
  event_id: string;
  event_created: string;
  account_id: string | null;
  customer_id: string | null;
  subscription: { id: string; gated: boolean; mirror: Mirror | null } | null;
  transition: Record<string, unknown> | null;
  expected_version: number | null;
  handled: boolean;
  handled_reason: string | null;
  effects: unknown[];
}

const recordOnly = (event: string, account: string | null, seconds = 0): P => ({
  event_id: event,
  event_created: iso(seconds),
  account_id: account,
  customer_id: null,
  subscription: null,
  transition: null,
  expected_version: null,
  handled: false,
  handled_reason: 'recorded for the test',
  effects: [],
});

/** next() on the account as stored, through toTransitionParams: what webhook-db.ts sends. */
async function transitionFor(d: PGlite, account: string, e: EntitlementEvent) {
  const stored = snapshotFromRow(await accountRow(d, account));
  const t = next(stored.snapshot, e);
  return {
    version: stored.version,
    transition: t,
    params: { ...toTransitionParams(account, stored.version, t.state, e.at) },
  };
}

/** `o` without `key`, for a case that leaves a key out. */
function without<O extends object>(o: O, key: keyof O): Partial<O> {
  const copy: Partial<O> = { ...o };
  delete copy[key];
  return copy;
}

type Result = {
  decided: boolean;
  handled: boolean | null;
  reason: string | null;
  effects: unknown[];
  version: number | null;
};

async function call(d: PGlite, p: unknown): Promise<Result> {
  const { rows } = await asRole(d, 'service_role', null, (tx) =>
    tx.query<{ r: Result }>(`select public.apply_stripe_event($1::jsonb) as r`, [
      JSON.stringify(p),
    ]),
  );
  return rows[0]!.r;
}

const SEND = {
  kind: 'send',
  id: 'entitlement.changed:x:evt',
  name: 'entitlement.changed',
  data: { accountId: 'x', from: 'free', to: 'pro' },
};

/** A Pro checkout through the RPC: the account follows `sub` from `seconds`. */
async function proCheckout(d: PGlite, account: string, sub: string, seconds: number) {
  const id = eventId();
  await ledger(d, id, 'checkout.session.completed');
  const { params } = await transitionFor(d, account, {
    type: 'checkout_completed',
    at: at(seconds),
    plan: 'pro',
    subscriptionId: sub,
    subscriptionStatus: 'active',
    extras: { seats: 0, sites: 0 },
  });
  return call(d, {
    ...recordOnly(id, account, seconds),
    subscription: { id: sub, gated: false, mirror: mirror(sub) },
    transition: params,
    handled: true,
    handled_reason: null,
    effects: [SEND],
  });
}

// ─── Grants and posture ────────────────────────────────────────────────────────────────────────────

describe('grants: only service_role may call apply_stripe_event', () => {
  it.each(['anon', 'authenticated'] as const)('%s may not execute it', async (role) => {
    await expect(
      asRole(db, role, null, (tx) => tx.query(`select public.apply_stripe_event('{}'::jsonb)`)),
    ).rejects.toThrow(/permission denied for function apply_stripe_event/);
  });

  it('service_role gets past the grant to the validation', async () => {
    await expect(call(db, {})).rejects.toMatchObject({ code: '22023' });
  });

  it('is SECURITY DEFINER, owned by postgres, with search_path pg_catalog, public, pg_temp and a lock timeout', async () => {
    const { rows } = await db.query<{ definer: boolean; config: string[]; owner: string }>(
      `select p.prosecdef as definer, p.proconfig as config, pg_get_userbyid(p.proowner) as owner
         from pg_proc p where p.oid = 'public.apply_stripe_event(jsonb)'::regprocedure`,
    );
    expect(rows).toEqual([
      {
        definer: true,
        config: ['search_path=pg_catalog, public, pg_temp', 'lock_timeout=5s'],
        owner: 'postgres',
      },
    ]);
  });

  it.each(['06-client-functions.sql', '08-v1-client-grants.sql'])(
    'check %s finds nothing',
    async (file) => {
      const { rows } = await db.query(readFileSync(join(CHECKS_DIR, file), 'utf8'));
      expect(rows).toEqual([]);
    },
  );

  it('refuses to run under repeatable read', async () => {
    const id = eventId();
    await ledger(db, id);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set transaction isolation level repeatable read`);
        await tx.exec(`set local role service_role`);
        await tx.query(`select public.apply_stripe_event($1::jsonb)`, [
          JSON.stringify(recordOnly(id, null)),
        ]);
      }),
    ).rejects.toMatchObject({ code: '0A000' });
  });
});

describe('stripe_events.effects holds an array or nothing', () => {
  it('refuses an object', async () => {
    const id = eventId();
    await ledger(db, id);
    await expect(
      db.query(`update public.stripe_events set effects = '{}'::jsonb where id = $1`, [id]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'stripe_events_effects_array' });
  });
});

// ─── Validation ────────────────────────────────────────────────────────────────────────────────────

describe('a malformed p raises 22023 before any lock', () => {
  const account = randomUUID();
  // The ledger row of `evt_missing` does not exist: a call that got past validation would raise P0002.
  const base = (): P => ({ ...recordOnly('evt_missing', account), handled_reason: 'r' });
  const cases: [string, (p: P) => unknown][] = [
    ['not an object', () => []],
    ['a key missing', (p) => without(p, 'effects')],
    ['an extra key', (p) => ({ ...p, extra: 1 })],
    ['an event id that is not evt_', (p) => ({ ...p, event_id: 'x' })],
    ['event_created not ISO 8601', (p) => ({ ...p, event_created: 'now' })],
    ['account_id not a uuid', (p) => ({ ...p, account_id: 'nope' })],
    ['customer_id not cus_', (p) => ({ ...p, customer_id: 'acct_1' })],
    ['effects not an array', (p) => ({ ...p, effects: {} })],
    ['handled not a boolean', (p) => ({ ...p, handled: 'false' })],
    ['handled with a reason', (p) => ({ ...p, handled: true })],
    ['not handled without a reason', (p) => ({ ...p, handled_reason: null })],
    [
      'handled with neither transition nor version',
      (p) => ({ ...p, handled: true, handled_reason: null }),
    ],
    ['an expected version that is not an integer', (p) => ({ ...p, expected_version: 1.5 })],
    [
      'a subscription without an account',
      (p) => ({ ...p, account_id: null, subscription: { id: 'sub_1', gated: true, mirror: null } }),
    ],
    ['a binding without an account', (p) => ({ ...p, account_id: null, customer_id: 'cus_1' })],
    [
      'a subscription id that is not sub_',
      (p) => ({ ...p, subscription: { id: 'si_1', gated: true, mirror: null } }),
    ],
    [
      'a subscription with an extra key',
      (p) => ({ ...p, subscription: { id: 'sub_1', gated: true, mirror: null, x: 1 } }),
    ],
    [
      'a mirror of another subscription',
      (p) => ({ ...p, subscription: { id: 'sub_1', gated: true, mirror: mirror('sub_2') } }),
    ],
    [
      'a mirror with a date that is not ISO 8601',
      (p) => ({
        ...p,
        subscription: {
          id: 'sub_1',
          gated: true,
          mirror: { ...mirror('sub_1'), ended_at: 'infinity' },
        },
      }),
    ],
    [
      'a mirror with a price that is not a string',
      (p) => ({
        ...p,
        subscription: { id: 'sub_1', gated: true, mirror: { ...mirror('sub_1'), price_ids: [1] } },
      }),
    ],
    [
      'a transition and an expected version',
      (p) => ({ ...p, handled: true, handled_reason: null, transition: {}, expected_version: 0 }),
    ],
    ['a transition that is not handled', (p) => ({ ...p, transition: {} })],
  ];
  it.each(cases)('%s', async (_name, mutate) => {
    await expect(call(db, mutate(base()))).rejects.toMatchObject({ code: '22023' });
  });

  it('a transition for another account, or with a value of the wrong type', async () => {
    const id = await freshAccount();
    const { params } = await transitionFor(db, id, {
      type: 'checkout_completed',
      at: at(0),
      plan: 'pro',
      subscriptionId: 'sub_shape',
      subscriptionStatus: 'active',
      extras: { seats: 0, sites: 0 },
    });
    const p = (transition: unknown) => ({
      ...recordOnly('evt_missing', id),
      handled: true,
      handled_reason: null,
      transition,
    });
    await expect(call(db, p(params))).rejects.toMatchObject({ code: 'P0002' }); // the valid one passes
    await expect(call(db, p({ ...params, p_account_id: randomUUID() }))).rejects.toMatchObject({
      code: '22023',
    });
    await expect(call(db, p({ ...params, p_at: 'epoch' }))).rejects.toMatchObject({
      code: '22023',
    });
    await expect(call(db, p({ ...params, p_seat_limit: '2' }))).rejects.toMatchObject({
      code: '22023',
    });
    await expect(call(db, p(without(params, 'p_changed_at')))).rejects.toMatchObject({
      code: '22023',
    });
  });
});

// ─── The branches ──────────────────────────────────────────────────────────────────────────────────

describe('the ledger row', () => {
  it('must exist: P0002', async () => {
    await expect(call(db, recordOnly('evt_never_begun', null))).rejects.toMatchObject({
      code: 'P0002',
    });
  });

  it('a record-only call writes the decision and nothing else, and answers version null without an account', async () => {
    const id = eventId();
    await ledger(db, id, 'invoice.paid');
    const effects = [
      { kind: 'alert', reason: 'dispute', accountId: null, subscriptionId: null, source: id },
    ];
    const r = await call(db, { ...recordOnly(id, null), handled_reason: 'no account', effects });
    expect(r).toEqual({
      decided: false,
      handled: false,
      reason: 'no account',
      effects,
      version: null,
    });
    expect(await eventRow(db, id)).toEqual({
      account_id: null,
      handled: false,
      handled_reason: 'no account',
      effects,
      processed_at: null,
    });
  });

  it('a record-only call for an account does not read its version', async () => {
    const account = await freshAccount();
    const before = await accountRow(db, account);
    const id = eventId();
    await ledger(db, id);
    const r = await call(db, recordOnly(id, account));
    expect(r.version).toBe(0);
    expect(await accountRow(db, account)).toEqual(before);
    expect((await eventRow(db, id)).account_id).toBe(account);
  });

  it('already decided: answers what was recorded and writes nothing, whatever the second call carries', async () => {
    const account = await freshAccount();
    const sub = subId();
    const first = await proCheckout(db, account, sub, 10);
    expect(first).toMatchObject({ decided: false, handled: true, version: 1, effects: [SEND] });
    const id = (await subRow(db, sub))!.last_event_id!;
    const accountBefore = await accountRow(db, account);
    const again = await call(db, {
      ...recordOnly(id, account, 20),
      subscription: { id: sub, gated: true, mirror: mirror(sub, 'canceled') },
      expected_version: 1,
      handled: true,
      handled_reason: null,
      effects: [],
    });
    expect(again).toEqual({
      decided: true,
      handled: true,
      reason: null,
      effects: [SEND],
      version: 1,
    });
    expect(await accountRow(db, account)).toEqual(accountBefore);
    expect((await subRow(db, sub))!.status).toBe('active');
  });

  it('a processed row with no decision (as v1 leaves one) answers decided, with no effects', async () => {
    const id = eventId();
    await ledger(db, id);
    await db.query(`update public.stripe_events set processed_at = now() where id = $1`, [id]);
    expect(await call(db, recordOnly(id, null))).toEqual({
      decided: true,
      handled: null,
      reason: null,
      effects: [],
      version: null,
    });
    expect((await eventRow(db, id)).handled).toBeNull();
  });
});

describe('the commit and confirm paths', () => {
  it('commit: the transition, the mirror created, the mark, the decision, the new version', async () => {
    const account = await freshAccount();
    const sub = subId();
    const r = await proCheckout(db, account, sub, 10);
    expect(r).toEqual({ decided: false, handled: true, reason: null, effects: [SEND], version: 1 });
    const a = await accountRow(db, account);
    expect([a.state, a.tier, a.current_subscription_id, a.entitlement_version]).toEqual([
      'pro',
      'pro',
      sub,
      1,
    ]);
    const s = (await subRow(db, sub))!;
    expect([s.account_id, s.status, s.plan, s.price_ids]).toEqual([
      account,
      'active',
      'pro',
      ['price_crawlmouse_pro_monthly'],
    ]);
    expect(s.last_event_created!.toISOString()).toBe(iso(10));
  });

  it('commit at a stale version raises 40001 and writes nothing: no mirror, no decision', async () => {
    const account = await freshAccount();
    const sub = subId();
    const id = eventId();
    await ledger(db, id);
    const { params } = await transitionFor(db, account, {
      type: 'checkout_completed',
      at: at(5),
      plan: 'pro',
      subscriptionId: sub,
      subscriptionStatus: 'active',
      extras: { seats: 0, sites: 0 },
    });
    await expect(
      call(db, {
        ...recordOnly(id, account, 5),
        subscription: { id: sub, gated: false, mirror: mirror(sub) },
        transition: { ...params, p_expected_version: 7 },
        handled: true,
        handled_reason: null,
      }),
    ).rejects.toMatchObject({ code: '40001' });
    expect(await subRow(db, sub)).toBeUndefined();
    expect((await eventRow(db, id)).handled).toBeNull();
  });

  it('confirm: the version is checked; a match records the decision and leaves the account', async () => {
    const account = await freshAccount();
    const before = await accountRow(db, account);
    const id = eventId();
    await ledger(db, id);
    const r = await call(db, {
      ...recordOnly(id, account),
      expected_version: 0,
      handled_reason: 'not the current subscription',
    });
    expect(r).toMatchObject({ decided: false, handled: false, version: 0 });
    expect(await accountRow(db, account)).toEqual(before);
  });

  it('confirm at a stale version raises 40001 and records nothing', async () => {
    const account = await freshAccount();
    const id = eventId();
    await ledger(db, id);
    await expect(
      call(db, { ...recordOnly(id, account), expected_version: 3, handled_reason: 'x' }),
    ).rejects.toMatchObject({ code: '40001' });
    expect((await eventRow(db, id)).handled).toBeNull();
  });

  it('an account that does not exist: P0002', async () => {
    const id = eventId();
    await ledger(db, id);
    await expect(
      call(db, { ...recordOnly(id, randomUUID()), expected_version: 0 }),
    ).rejects.toMatchObject({ code: 'P0002' });
  });
});

describe('the out-of-order guard', () => {
  /** An account on Pro following `sub` from a checkout at 10 s, with the mirror marked at `mark`. */
  async function following(markSeconds: number) {
    const account = await freshAccount();
    const sub = subId();
    await proCheckout(db, account, sub, 10);
    await db.query(`update public.subscriptions set last_event_created = $2 where id = $1`, [
      sub,
      at(markSeconds),
    ]);
    return { account, sub };
  }

  async function pastDue(account: string, sub: string, seconds: number, gated = true) {
    const id = eventId();
    await ledger(db, id);
    const { params } = await transitionFor(db, account, {
      type: 'subscription_updated',
      at: at(seconds),
      subscriptionId: sub,
      status: 'past_due',
      plan: 'pro',
      cancelAtPeriodEnd: false,
      extras: { seats: 0, sites: 0 },
    });
    const r = await call(db, {
      ...recordOnly(id, account, seconds),
      subscription: { id: sub, gated, mirror: mirror(sub, 'past_due') },
      transition: params,
      handled: true,
      handled_reason: null,
      effects: [SEND],
    });
    return { id, r };
  }

  it('a gated event strictly older than the mark writes neither mirror nor transition, and is recorded', async () => {
    const { account, sub } = await following(100);
    const accountBefore = await accountRow(db, account);
    const { id, r } = await pastDue(account, sub, 99);
    expect(r).toEqual({
      decided: false,
      handled: false,
      reason: "older than the subscription's last event",
      effects: [],
      version: 1,
    });
    expect(await accountRow(db, account)).toEqual(accountBefore);
    const s = (await subRow(db, sub))!;
    expect(s.status).toBe('active');
    expect(s.last_event_created!.toISOString()).toBe(iso(100));
    expect(await eventRow(db, id)).toMatchObject({
      handled: false,
      handled_reason: "older than the subscription's last event",
      effects: [],
    });
  });

  it('an event in the same second as the mark passes, and so does a newer one: mirror, transition, mark', async () => {
    for (const seconds of [100, 101]) {
      const { account, sub } = await following(100);
      const { id, r } = await pastDue(account, sub, seconds);
      expect(r).toMatchObject({ decided: false, handled: true, version: 2 });
      expect((await accountRow(db, account)).state).toBe('past_due');
      const s = (await subRow(db, sub))!;
      expect(s.status).toBe('past_due');
      expect(s.last_event_created!.toISOString()).toBe(iso(seconds));
      expect(s.last_event_id).toBe(id);
    }
  });

  it('an older event that is not gated passes, and the mark does not move back', async () => {
    const { account, sub } = await following(100);
    const before = (await subRow(db, sub))!.last_event_id;
    const { r } = await pastDue(account, sub, 50, false);
    expect(r).toMatchObject({ handled: true, version: 2 });
    const s = (await subRow(db, sub))!;
    expect(s.status).toBe('past_due');
    expect(s.last_event_created!.toISOString()).toBe(iso(100));
    expect(s.last_event_id).toBe(before);
  });

  it('an event without mirror data advances the mark and keeps the mirror', async () => {
    const { account, sub } = await following(100);
    const id = eventId();
    await ledger(db, id);
    await call(db, {
      ...recordOnly(id, account, 200),
      subscription: { id: sub, gated: true, mirror: null },
      handled_reason: 'superseded',
    });
    const s = (await subRow(db, sub))!;
    expect([s.status, s.last_event_created!.toISOString(), s.last_event_id]).toEqual([
      'active',
      iso(200),
      id,
    ]);
  });

  it('a subscription row of another account raises 23514', async () => {
    const { sub } = await following(100);
    const other = await freshAccount();
    const id = eventId();
    await ledger(db, id);
    await expect(
      call(db, {
        ...recordOnly(id, other, 200),
        subscription: { id: sub, gated: true, mirror: mirror(sub) },
      }),
    ).rejects.toMatchObject({ code: '23514' });
    expect((await eventRow(db, id)).handled).toBeNull();
  });
});

describe('the customer binding', () => {
  const bind = async (account: string, customer: string) => {
    const id = eventId();
    await ledger(db, id, 'checkout.session.completed');
    return call(db, {
      ...recordOnly(id, account),
      customer_id: customer,
      expected_version: (await accountRow(db, account)).entitlement_version,
      handled_reason: 'x',
    });
  };

  it('binds where the account has none, and is a no-op for the same customer', async () => {
    const account = await freshAccount();
    const customer = customerId();
    await bind(account, customer);
    expect((await accountRow(db, account)).stripe_customer_id).toBe(customer);
    await bind(account, customer);
    expect((await accountRow(db, account)).stripe_customer_id).toBe(customer);
  });

  it('another customer already on the account raises 23505 and writes nothing', async () => {
    const account = await freshAccount();
    const customer = customerId();
    await bind(account, customer);
    await expect(bind(account, customerId())).rejects.toMatchObject({ code: '23505' });
    expect((await accountRow(db, account)).stripe_customer_id).toBe(customer);
  });

  it('a customer bound to another account raises 23505 (the unique index)', async () => {
    const customer = customerId();
    await bind(await freshAccount(), customer);
    const account = await freshAccount();
    await expect(bind(account, customer)).rejects.toMatchObject({ code: '23505' });
    expect((await accountRow(db, account)).stripe_customer_id).toBeNull();
  });
});

describe("a caller's temporary objects are not used by the function", () => {
  // pg_temp is searched last, so a temp domain cannot stand in for a pg_catalog type, and a temp
  // table cannot stand in for public's (every table is written with its schema). Each case needs a
  // session that has not compiled the function yet: a fresh clone.
  it.each(['jsonb', 'text', 'timestamptz', 'int4', 'bool', 'uuid'])(
    'a temp domain named %s',
    async (type) => {
      const d = await doorDb();
      try {
        const account = await freshAccount(d);
        const id = eventId();
        await ledger(d, id);
        const r = await asRole(d, 'service_role', null, async (tx) => {
          await tx.exec(`
            create function pg_temp.ran_as(v pg_catalog.text) returns boolean language plpgsql as $f$
            begin raise exception 'RAN AS %', current_user; end; $f$;
            create domain pg_temp.${type} as pg_catalog.${type} check (pg_temp.ran_as(value::pg_catalog.text));`);
          const { rows } = await tx.query<{ r: Result }>(
            `select public.apply_stripe_event($1::pg_catalog.jsonb) as r`,
            [JSON.stringify({ ...recordOnly(id, account), expected_version: 0 })],
          );
          return rows[0]!.r;
        });
        expect(r.decided).toBe(false);
      } finally {
        await d.close();
      }
    },
  );

  it('a temp table named stripe_events', async () => {
    const d = await doorDb();
    try {
      const id = eventId();
      await ledger(d, id);
      const r = await asRole(d, 'service_role', null, async (tx) => {
        await tx.exec(`create temp table stripe_events (id text, handled boolean, handled_reason text,
                         effects jsonb, processed_at timestamptz, account_id uuid)`);
        await tx.query(`insert into pg_temp.stripe_events (id, handled) values ($1, true)`, [id]);
        const { rows } = await tx.query<{ r: Result }>(
          `select public.apply_stripe_event($1::jsonb) as r`,
          [JSON.stringify(recordOnly(id, null))],
        );
        return rows[0]!.r;
      });
      expect(r.decided).toBe(false);
      expect((await eventRow(d, id)).handled).toBe(false);
    } finally {
      await d.close();
    }
  });
});

// ─── Apply, re-apply, revert ───────────────────────────────────────────────────────────────────────

describe('the migration applies, re-applies and reverts', () => {
  it('re-applying it changes nothing in the catalog', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, through(MIGRATION));
      const once = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(once);
    } finally {
      await d.close();
    }
  }, 120_000);

  it('the revert returns the catalog to the state before it, twice, and it re-applies', async () => {
    const d = await freshDb();
    try {
      await applyAllMigrations(d, undefined, before(MIGRATION));
      const pre = await catalogSnapshot(d);
      await d.exec(readMigration(MIGRATION));
      const applied = await catalogSnapshot(d);
      expect(applied).not.toEqual(pre); // anti-vacuity
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readRollback(ROLLBACK));
      expect(await catalogSnapshot(d)).toEqual(pre);
      await d.exec(readMigration(MIGRATION));
      expect(await catalogSnapshot(d)).toEqual(applied);
    } finally {
      await d.close();
    }
  }, 120_000);
});
