import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCatalog } from './catalog.fake';
import { stripeSubscription, type FakeSubscription } from './stripe.fake';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), flush: vi.fn(async () => true) }));
const admin = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../supabase/admin', () => ({
  supabaseAdmin: () => {
    admin.calls++;
    throw new Error('supabaseAdmin() is not called in this test');
  },
}));
vi.mock('./stripe-catalog', () => ({ accountCatalog: () => fakeCatalog() }));

import * as Sentry from '@sentry/nextjs';
import {
  REPORT_CAP,
  accountReconcileFromEnv,
  keyLivemode,
  productionReconcileDeps,
  reconcileAccounts,
  type Drift,
  type ReconcileAccount,
  type ReconcileDeps,
} from './reconcile-v2';

/** The v2 reconcile against in-memory readers: what it reports, and that it writes nothing. */

const NOW = new Date('2099-01-01T00:00:00Z');

function stripeSub(id: string, change: Partial<FakeSubscription> = {}): Stripe.Subscription {
  return stripeSubscription({
    id,
    customer: 'cus_r',
    status: 'active',
    plan: 'pro',
    interval: 'month',
    seats: 0,
    sites: 0,
    trialEnd: null,
    periodEnd: 4_100_000_000,
    cancelAtPeriodEnd: false,
    ...change,
  });
}

interface World {
  accounts: ReconcileAccount[];
  mirrors: Record<string, { id: string; status: string }[]>;
  stripe: Record<string, Stripe.Subscription[] | null>;
  unsent: { id: string; accountId: string | null }[];
}

function deps(world: World) {
  const reports: [string | null, Drift[]][] = [];
  const withheld: number[] = [];
  const d: ReconcileDeps = {
    async *accounts() {
      for (let i = 0; i < world.accounts.length; i += 2) yield world.accounts.slice(i, i + 2);
    },
    async mirrors(ids) {
      return new Map(ids.map((id) => [id, world.mirrors[id] ?? []]));
    },
    async unsent(before) {
      expect(before).toEqual(new Date(NOW.getTime() - 3_600_000));
      return world.unsent;
    },
    async listSubscriptions(customer) {
      return Object.hasOwn(world.stripe, customer) ? (world.stripe[customer] ?? null) : [];
    },
    catalog: fakeCatalog(),
    report: (accountId, drifts) => reports.push([accountId, drifts]),
    withheld: (n) => withheld.push(n),
    now: NOW,
  };
  return { d, reports, withheld };
}

const acct = (id: string, change: Partial<ReconcileAccount> = {}): ReconcileAccount => ({
  id,
  state: 'pro',
  tier: 'pro',
  currentSubscriptionId: `sub_${id}`,
  stripeCustomerId: `cus_${id}`,
  ...change,
});

describe('reconcileAccounts', () => {
  it('an account that agrees with Stripe reports nothing', async () => {
    const { d, reports } = deps({
      accounts: [acct('a')],
      mirrors: { a: [{ id: 'sub_a', status: 'active' }] },
      stripe: { cus_a: [stripeSub('sub_a')] },
      unsent: [],
    });
    expect(await reconcileAccounts(d)).toEqual({
      checked: 1,
      drifted: 0,
      reported: 0,
      withheld: 0,
      kinds: {},
    });
    expect(reports).toEqual([]);
  });

  it('reports each kind of drift against the account it is about', async () => {
    const { d, reports } = deps({
      accounts: [
        acct('missing'),
        acct('mirror'),
        acct('gone'),
        acct('ended'),
        acct('tier', { state: 'agency', tier: 'agency' }),
        acct('double'),
        acct('free', { state: 'free', tier: 'free', currentSubscriptionId: null }),
      ],
      mirrors: {
        mirror: [
          { id: 'sub_mirror', status: 'past_due' },
          { id: 'sub_unlisted', status: 'active' },
        ],
      },
      stripe: {
        cus_missing: null,
        cus_mirror: [stripeSub('sub_mirror')],
        cus_gone: [],
        cus_ended: [stripeSub('sub_ended', { status: 'canceled' })],
        cus_tier: [stripeSub('sub_tier')],
        cus_double: [stripeSub('sub_double'), stripeSub('sub_second', { status: 'trialing' })],
        cus_free: [
          stripeSub('sub_foreign', { priceIds: ['price_not_ours'] }),
          stripeSub('sub_old', { status: 'canceled' }),
        ],
      },
      unsent: [{ id: 'evt_stuck', accountId: 'double' }],
    });
    const r = await reconcileAccounts(d);
    expect(reports).toEqual([
      ['missing', [{ kind: 'customer_missing', ref: 'cus_missing' }]],
      [
        'mirror',
        [
          { kind: 'mirror_status', ref: 'sub_mirror' },
          { kind: 'mirror_status', ref: 'sub_unlisted' },
        ],
      ],
      ['gone', [{ kind: 'followed_missing', ref: 'sub_gone' }]],
      ['ended', [{ kind: 'followed_ended', ref: 'sub_ended' }]],
      ['tier', [{ kind: 'tier_mismatch', ref: 'sub_tier' }]],
      [
        'double',
        [
          { kind: 'double_billing', ref: 'sub_second' },
          { kind: 'effects_unsent', ref: 'evt_stuck' },
        ],
      ],
    ]);
    expect(r).toEqual({
      checked: 7,
      drifted: 6,
      reported: 6,
      withheld: 0,
      kinds: {
        customer_missing: 1,
        mirror_status: 2,
        followed_missing: 1,
        followed_ended: 1,
        tier_mismatch: 1,
        double_billing: 1,
        effects_unsent: 1,
      },
    });
  });

  it('counts a live subscription whose metadata names the account as its own, whatever its price', async () => {
    // A checkout our route opened, on a price the listing no longer holds: it charges this account.
    const named = {
      ...stripeSub('sub_named', { priceIds: ['price_retired'] }),
      metadata: { account_id: 'free' },
    };
    const other = {
      ...stripeSub('sub_other', { priceIds: ['price_retired'] }),
      metadata: { account_id: 'x' },
    };
    const { d, reports } = deps({
      accounts: [acct('free', { state: 'free', tier: 'free', currentSubscriptionId: null })],
      mirrors: {},
      stripe: { cus_free: [named as Stripe.Subscription, other as Stripe.Subscription] },
      unsent: [],
    });
    await reconcileAccounts(d);
    expect(reports).toEqual([['free', [{ kind: 'double_billing', ref: 'sub_named' }]]]);
  });

  it(`reports at most ${REPORT_CAP} accounts and counts the rest`, async () => {
    const accounts = Array.from({ length: REPORT_CAP + 3 }, (_, i) => acct(`x${i}`));
    const { d, reports, withheld } = deps({ accounts, mirrors: {}, stripe: {}, unsent: [] });
    const r = await reconcileAccounts(d);
    expect(reports).toHaveLength(50);
    expect(withheld).toEqual([3]);
    expect(r).toMatchObject({ checked: 53, drifted: 53, reported: 50, withheld: 3 });
  });
});

describe('the production readers write nothing', () => {
  it('reads accounts, mirrors and the ledger, lists Stripe, and calls no write', async () => {
    const calls: string[] = [];
    const builder = (table: string, rows: unknown[]) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'not', 'is', 'order', 'range', 'in', 'lt', 'eq']) {
        chain[m] = (...args: unknown[]) => {
          calls.push(`${table}.${m}(${JSON.stringify(args)})`);
          return chain;
        };
      }
      for (const m of ['insert', 'update', 'upsert', 'delete']) {
        chain[m] = () => {
          throw new Error(`${table}.${m} called`);
        };
      }
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return chain;
    };
    const sb = {
      from: (table: string) =>
        builder(
          table,
          table === 'accounts'
            ? [
                {
                  id: 'a',
                  state: 'pro',
                  tier: 'pro',
                  current_subscription_id: 'sub_a',
                  stripe_customer_id: 'cus_a',
                },
              ]
            : table === 'subscriptions'
              ? [{ id: 'sub_a', account_id: 'a', status: 'active' }]
              : [],
        ),
      rpc: () => {
        throw new Error('rpc called');
      },
    };
    const stripe = {
      subscriptions: {
        list: (params: unknown) => {
          calls.push(`stripe.subscriptions.list(${JSON.stringify(params)})`);
          return (async function* () {
            yield stripeSub('sub_a');
          })();
        },
      },
    };
    const r = await reconcileAccounts({
      ...productionReconcileDeps(sb as never, stripe as never, fakeCatalog(), NOW),
    });
    expect(r).toMatchObject({ checked: 1, drifted: 0 });
    expect(calls).toContain(
      'stripe.subscriptions.list({"customer":"cus_a","status":"all","limit":100})',
    );
    expect(calls.filter((c) => c.startsWith('stripe_events.')).join(' ')).toContain(
      `stripe_events.lt(["received_at","${new Date(NOW.getTime() - 3_600_000).toISOString()}"])`,
    );
  });

  it('a customer Stripe does not know is reported, any other Stripe error propagates', async () => {
    const list = (code: string) => () =>
      (async function* () {
        yield* [];
        throw Object.assign(new Error('Stripe error'), { code });
      })();
    const sb = { from: () => ({}) };
    const missing = productionReconcileDeps(
      sb as never,
      { subscriptions: { list: list('resource_missing') } } as never,
      fakeCatalog(),
      NOW,
    );
    expect(await missing.listSubscriptions('cus_x')).toBeNull();
    const limited = productionReconcileDeps(
      sb as never,
      { subscriptions: { list: list('rate_limit') } } as never,
      fakeCatalog(),
      NOW,
    );
    await expect(limited.listSubscriptions('cus_x')).rejects.toThrow('Stripe error');
  });

  it('report sends one Sentry warning per account, with kinds and ids only', () => {
    const d = productionReconcileDeps({} as never, {} as never, fakeCatalog(), NOW);
    vi.mocked(Sentry.captureMessage).mockClear();
    d.report('a', [{ kind: 'double_billing', ref: 'sub_2' }]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('reconcile.drift', {
      level: 'warning',
      tags: { signal: 'reconcile-drift' },
      extra: { accountId: 'a', drifts: ['double_billing:sub_2'] },
    });
  });
});

describe('the key’s mode', () => {
  it.each([
    ['sk_live_x', true],
    ['rk_live_x', true],
    ['sk_test_x', false],
    ['rk_test_x', false],
  ])('%s is live: %s', (key, live) => {
    expect(keyLivemode(key)).toBe(live);
  });

  it('anything else throws without repeating the key', () => {
    expect(() => keyLivemode('pk_live_abc123')).toThrow(
      'STRIPE_ACCOUNT_SECRET_KEY is not a Stripe secret or restricted key',
    );
    expect(() => keyLivemode('pk_live_abc123')).not.toThrow(/abc123/);
  });
});

describe('accountReconcileFromEnv', () => {
  beforeEach(() => {
    admin.calls = 0;
  });

  it('is null with V2_BILLING unset', () => {
    expect(accountReconcileFromEnv({ STRIPE_ACCOUNT_SECRET_KEY: 'sk_test_x' })).toBeNull();
  });

  it('refuses to run, before any read, when the key is live and the mode is test', async () => {
    const run = accountReconcileFromEnv({
      V2_BILLING: '1',
      STRIPE_ACCOUNT_SECRET_KEY: 'sk_live_x',
    });
    await expect(run!()).rejects.toThrow(/refuses to run/);
    expect(admin.calls).toBe(0);
  });

  it('refuses to run when the key is test and the mode is live', async () => {
    const run = accountReconcileFromEnv({
      V2_BILLING: '1',
      STRIPE_ACCOUNT_SECRET_KEY: 'rk_test_x',
      STRIPE_ACCOUNT_LIVEMODE: 'true',
    });
    await expect(run!()).rejects.toThrow(/refuses to run/);
    expect(admin.calls).toBe(0);
  });

  it('refuses to run without a key', async () => {
    const run = accountReconcileFromEnv({ V2_BILLING: '1' });
    await expect(run!()).rejects.toThrow('STRIPE_ACCOUNT_SECRET_KEY is not set');
  });

  it('with the modes agreeing it goes on to read', async () => {
    const run = accountReconcileFromEnv({
      V2_BILLING: '1',
      STRIPE_ACCOUNT_SECRET_KEY: 'rk_test_x',
    });
    await expect(run!()).rejects.toThrow('supabaseAdmin() is not called in this test');
    expect(admin.calls).toBe(1);
  });
});
