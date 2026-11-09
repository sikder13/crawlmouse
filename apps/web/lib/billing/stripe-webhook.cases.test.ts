import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyEntitlementTransition } from './state-machine-apply';
import { payloads, stripeEvent, type FakeSubscription } from './stripe.fake';
import {
  WEBHOOK_CASES,
  type CaseRole,
  type Setup,
  type WebhookCase,
} from './webhook-cases.fixture';
import { webhookWorld, type WebhookWorld } from './webhook-db.pglite';
import { pgliteEntitlementStore } from '../../__tests__/v2/_lib/door-pglite';

vi.mock('server-only', () => ({}));

/**
 * The event × state table (./webhook-cases.fixture.ts), end to end: each case sets an account up
 * by delivering signed events to the handler, delivers one more, and reads the account row from
 * PGlite with every migration applied, the outcome, and the cancellations and founder alerts that
 * one delivery sent to the Stripe fake's sinks.
 */

// 2099-01-01T00:00:00Z: after any wall clock this runs at, so history stays in order.
const BASE = 4_070_908_800;
const DAY = 86_400;

let world: WebhookWorld;
beforeAll(async () => {
  world = await webhookWorld();
}, 120_000);
afterAll(async () => {
  await world?.db.close();
});

let n = 0;
const next = (prefix: string) => `${prefix}_case${++n}`;

interface Account {
  id: string;
  customer: string;
  current: string | null;
}

function subscription(
  customer: string,
  status: FakeSubscription['status'],
  plan: FakeSubscription['plan'],
  at: number,
): FakeSubscription {
  return world.stripe.put({
    id: next('sub'),
    customer,
    status,
    plan,
    interval: 'month',
    seats: 0,
    sites: 0,
    trialEnd: status === 'trialing' ? at + 14 * DAY : null,
    periodEnd: at + 30 * DAY,
    cancelAtPeriodEnd: false,
  });
}

async function deliver(type: string, object: Record<string, unknown>, created: number) {
  return world.deliver(stripeEvent(type, object, { id: next('evt'), created }));
}

async function checkout(a: Account, sub: string, created: number) {
  return deliver(
    'checkout.session.completed',
    payloads.checkout({
      session: next('cs'),
      accountId: a.id,
      customer: a.customer,
      subscription: sub,
      created: created - 60,
    }),
    created,
  );
}

async function setUp(from: Setup): Promise<Account> {
  const customer = next('cus');
  const a: Account = { id: await world.account(customer), customer, current: null };
  const paid = async (plan: 'pro' | 'agency', status: 'active' | 'trialing' = 'active') => {
    const sub = subscription(customer, status, plan, BASE + 100);
    expect((await checkout(a, sub.id, BASE + 100)).outcome).toBe('applied');
    a.current = sub.id;
  };
  const then = async (status: FakeSubscription['status']) => {
    world.stripe.update(a.current!, { status });
    const r = await deliver(
      'customer.subscription.updated',
      payloads.subscription(world.stripe.get(a.current!)),
      BASE + 200,
    );
    expect(r.outcome).toBe('applied');
  };
  switch (from) {
    case 'free':
      break;
    case 'pro_trial_no_card': {
      const t = await applyEntitlementTransition(pgliteEntitlementStore(world.db), a.id, {
        type: 'trial_started',
        at: new Date((BASE + 100) * 1000),
        variant: 'no_card',
      });
      expect(t.transition.outcome).toBe('applied');
      break;
    }
    case 'pro':
      await paid('pro');
      break;
    case 'agency':
      await paid('agency');
      break;
    case 'agency_trial':
      await paid('agency', 'trialing');
      break;
    case 'past_due':
      await paid('pro');
      await then('past_due');
      break;
    case 'free_kept':
      await paid('pro');
      await then('unpaid');
      break;
    case 'free_disputed': {
      await paid('pro');
      const charge = next('ch');
      world.stripe.charges.set(charge, customer);
      const r = await deliver(
        'charge.dispute.created',
        payloads.dispute({ id: next('dp'), charge }),
        BASE + 200,
      );
      expect(r.outcome).toBe('applied');
      break;
    }
  }
  return a;
}

/** Delivers the case's event; `other` is the subscription it made for an `other` case. */
async function run(k: WebhookCase, a: Account) {
  const at = BASE + 1000;
  const { type, subscription: which, status, plan } = k.stripe;
  if (type === 'charge.dispute.created') {
    const charge = next('ch');
    world.stripe.charges.set(charge, a.customer);
    return {
      outcome: await deliver(type, payloads.dispute({ id: next('dp'), charge }), at),
      other: null,
    };
  }
  let subId: string;
  if (which === 'current') {
    subId = a.current!;
    world.stripe.update(subId, {
      status: status!,
      trialEnd: status === 'trialing' ? at + 14 * DAY : world.stripe.get(subId).trialEnd,
    });
  } else {
    subId = subscription(a.customer, status!, plan!, at).id;
  }
  const other = which === 'other' ? subId : null;
  switch (type) {
    case 'checkout.session.completed':
      return { outcome: await checkout(a, subId, at), other };
    case 'invoice.payment_failed':
      return {
        outcome: await deliver(
          type,
          payloads.invoice({ id: next('in'), customer: a.customer, subscription: subId }),
          at,
        ),
        other,
      };
    default:
      return {
        outcome: await deliver(type, payloads.subscription(world.stripe.get(subId)), at),
        other,
      };
  }
}

describe('the event × state table, through the handler, on the real schema', () => {
  it('has one case per row and names each once', () => {
    expect(new Set(WEBHOOK_CASES.map((k) => k.name)).size).toBe(WEBHOOK_CASES.length);
    expect(WEBHOOK_CASES.length).toBe(89);
  });

  it.each(WEBHOOK_CASES.map((k) => [k.name, k] as const))('%s', async (_name, k) => {
    const a = await setUp(k.from);
    const cancelled = world.stripe.cancelled.length;
    const alerted = world.stripe.alerts.length;
    const { outcome, other } = await run(k, a);
    expect(outcome).toMatchObject({ outcome: k.expect.outcome, accountId: a.id });
    const { rows } = await world.db.query<{ state: string; tier: string }>(
      `select state, tier from public.accounts where id = $1`,
      [a.id],
    );
    expect(rows[0]).toEqual({ state: k.expect.state, tier: k.expect.tier });
    // The machine's reason for an ignored case, the webhook's for a recorded one, none if unstated.
    expect((outcome as { reason: string | null }).reason).toBe(k.expect.reason ?? null);
    // What this delivery sent to Stripe: each cancellation by its subscription's role, each alert.
    const role = (id: string): CaseRole | string =>
      id === a.current ? 'current' : id === other ? 'other' : id;
    expect(world.stripe.cancelled.slice(cancelled).map((x) => role(x.subscriptionId))).toEqual(
      k.expect.cancels,
    );
    expect(world.stripe.alerts.slice(alerted).map((x) => x.reason)).toEqual(k.expect.alerts);
  });
});
