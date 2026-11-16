import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_NAMESPACE,
  captureUuid,
  paymentEvents,
  plannedCaptures,
  uuidV5,
  type PaymentEventInput,
} from './payment-events';
import { FREE_START, next, type EntitlementEvent, type EntitlementSnapshot } from './state-machine';
import type { MirrorRow } from './subscription-mirror';
import { PAYMENT_PATHS, type PathEvent } from './payment-paths.fixture';

/**
 * The payment events one decided Stripe event plans (CC-41 D3). Transitions come from the machine;
 * every expected event, uuid and time is written out here. The uuid vectors were computed outside
 * this code, with Python's `uuid.uuid5`.
 */

const ACCOUNT = '5b3c1f7e-2c4a-4b8e-9d0f-1a2b3c4d5e6f';
const OWNER = '0e6b8f2a-3c1d-4f5e-9a7b-2c8d1e0f3a4b';
const AT = new Date('2099-01-01T00:00:00.000Z');
const CREATED = AT.getTime() / 1000;
const DAY = 86_400_000;

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  previous?: Record<string, unknown>,
  id = 'evt_1',
): Stripe.Event {
  return {
    id,
    object: 'event',
    created: CREATED,
    type,
    data: { object, ...(previous ? { previous_attributes: previous } : {}) },
  } as unknown as Stripe.Event;
}

function mirror(plan: 'pro' | 'agency', interval: 'month' | 'year' = 'month'): MirrorRow {
  return {
    id: 'sub_1',
    status: 'active',
    plan,
    interval,
    seat_quantity: 0,
    extra_site_quantity: 0,
    current_period_end: null,
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    price_ids: [],
  };
}

function input(
  before: EntitlementSnapshot,
  event: EntitlementEvent,
  stripe: Stripe.Event,
  row: MirrorRow | null = mirror('pro'),
): PaymentEventInput {
  return { stripe, event, before, transition: next(before, event), mirror: row };
}

const checkout = (plan: 'pro' | 'agency' = 'pro', subscriptionId = 'sub_1'): EntitlementEvent => ({
  type: 'checkout_completed',
  at: AT,
  plan,
  subscriptionId,
  subscriptionStatus: 'active',
  extras: { seats: 0, sites: 0 },
});

const session = (amount: unknown = 1900, currency: unknown = 'usd') =>
  stripeEvent('checkout.session.completed', {
    object: 'checkout.session',
    amount_total: amount,
    currency,
  });

/** A snapshot paid through `sub_1`, by a checkout an hour before AT. */
function paid(plan: 'pro' | 'agency' = 'pro'): EntitlementSnapshot {
  const t = next(FREE_START, { ...checkout(plan), at: new Date(AT.getTime() - 3_600_000) });
  if (t.outcome !== 'applied') throw new Error('the checkout did not apply');
  return t.state;
}

function noCardTrial(): EntitlementSnapshot {
  const t = next(FREE_START, {
    type: 'trial_started',
    at: new Date(AT.getTime() - DAY),
    variant: 'no_card',
  });
  return t.state;
}

const updated = (
  plan: 'pro' | 'agency',
  cancelAtPeriodEnd = false,
  subscriptionId = 'sub_1',
): EntitlementEvent => ({
  type: 'subscription_updated',
  at: AT,
  subscriptionId,
  status: 'active',
  plan,
  cancelAtPeriodEnd,
  extras: { seats: 0, sites: 0 },
});

const subscriptionObject = (cancelAtPeriodEnd: boolean) => ({
  object: 'subscription',
  id: 'sub_1',
  cancel_at_period_end: cancelAtPeriodEnd,
});

describe('uuidV5', () => {
  it("matches RFC 9562's reference implementation on known vectors", () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
    expect(uuidV5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'https://crawlmouse.com/pricing')).toBe(
      'db4ec947-714c-5e88-8180-9a9bc04efd06',
    );
  });

  it('refuses a namespace that is not a UUID', () => {
    expect(() => uuidV5('not-a-uuid', 'x')).toThrow('not a UUID: not-a-uuid');
  });
});

describe('captureUuid', () => {
  it('is fixed by the Stripe event id and the event name, under the namespace', () => {
    expect(CAPTURE_NAMESPACE).toBe('a4bda8a7-2118-43f0-925a-f29e7e0415b9');
    expect(captureUuid('evt_1', 'subscription_started')).toBe(
      'f81a0237-f9f2-55b2-8a80-e46dd9bad046',
    );
    expect(captureUuid('evt_2', 'subscription_started')).toBe(
      'd1f53397-e3ca-57bd-9dc3-11f94d6ceeff',
    );
    expect(captureUuid('evt_1', 'subscription_ended')).toBe('8678a7b1-24f8-59c6-88fd-421c00a04028');
  });
});

describe('paymentEvents: subscription_started', () => {
  it('a checkout that applies: the plan, the mirror’s interval, and the session’s amount and currency', () => {
    expect(
      paymentEvents(input(FREE_START, checkout(), session(1900, 'usd'), mirror('pro', 'year'))),
    ).toEqual([
      {
        event: 'subscription_started',
        properties: {
          plan: 'pro',
          interval: 'year',
          trial: false,
          amount_cents: 1900,
          currency: 'usd',
        },
      },
    ]);
  });

  it.each<[string, unknown, unknown]>([
    ['no amount or currency', null, null],
    ['a fractional amount and an upper-case currency', 19.5, 'USD'],
    ['a negative amount and a currency too long', -1, 'usdx'],
  ])('a session with %s carries nulls for them', (_, amount, currency) => {
    expect(paymentEvents(input(FREE_START, checkout(), session(amount, currency)))).toEqual([
      {
        event: 'subscription_started',
        properties: {
          plan: 'pro',
          interval: 'month',
          trial: false,
          amount_cents: null,
          currency: null,
        },
      },
    ]);
  });

  it('a checkout the machine ignores plans nothing', () => {
    expect(paymentEvents(input(paid(), checkout(), session()))).toEqual([]);
  });

  it('a checkout that converts a no-card trial: started, then trial_converted', () => {
    expect(paymentEvents(input(noCardTrial(), checkout(), session(1900, 'usd')))).toEqual([
      {
        event: 'subscription_started',
        properties: {
          plan: 'pro',
          interval: 'month',
          trial: false,
          amount_cents: 1900,
          currency: 'usd',
        },
      },
      { event: 'trial_converted', properties: { plan: 'pro', via: 'checkout' } },
    ]);
  });

  it('an Agency trial whose subscription turns active converts: trial_converted, no plan_changed', () => {
    const started = next(FREE_START, {
      type: 'agency_trial_started',
      at: new Date(AT.getTime() - 14 * DAY),
      trialEnd: new Date(AT.getTime() - DAY),
      subscriptionId: 'sub_1',
      subscriptionStatus: 'trialing',
    });
    if (started.outcome !== 'applied') throw new Error('the trial did not start');
    expect(started.state.state).toBe('agency_trial');
    const stripe = stripeEvent('customer.subscription.updated', subscriptionObject(false), {
      status: 'trialing',
    });
    expect(
      paymentEvents(input(started.state, updated('agency'), stripe, mirror('agency'))),
    ).toEqual([{ event: 'trial_converted', properties: { plan: 'agency', via: 'subscription' } }]);
    // A paid account's update that changes nothing converts nothing.
    expect(
      paymentEvents(input(paid('agency'), updated('agency'), stripe, mirror('agency'))),
    ).toEqual([]);
  });

  it('an Agency trial that starts: trial true, the amount the session charged now', () => {
    const e: EntitlementEvent = {
      type: 'agency_trial_started',
      at: AT,
      trialEnd: new Date(AT.getTime() + 14 * DAY),
      subscriptionId: 'sub_1',
      subscriptionStatus: 'trialing',
    };
    expect(paymentEvents(input(FREE_START, e, session(0, 'eur'), mirror('agency')))).toEqual([
      {
        event: 'subscription_started',
        properties: {
          plan: 'agency',
          interval: 'month',
          trial: true,
          amount_cents: 0,
          currency: 'eur',
        },
      },
    ]);
    const used = { ...FREE_START, trialUsedAt: new Date(AT.getTime() - DAY) };
    expect(paymentEvents(input(used, e, session(0, 'eur'), mirror('agency')))).toEqual([]);
  });

  it('a card-required Pro trial that starts, from an event that is not a session: no amount', () => {
    const e: EntitlementEvent = {
      type: 'trial_started',
      at: AT,
      variant: 'card_required',
      trialEnd: new Date(AT.getTime() + 14 * DAY),
      subscriptionId: 'sub_1',
      subscriptionStatus: 'trialing',
    };
    const stripe = stripeEvent('customer.subscription.created', {
      amount_total: 1900,
      currency: 'usd',
    });
    expect(paymentEvents(input(FREE_START, e, stripe))).toEqual([
      {
        event: 'subscription_started',
        properties: {
          plan: 'pro',
          interval: 'month',
          trial: true,
          amount_cents: null,
          currency: null,
        },
      },
    ]);
  });

  it('a no-card trial that starts plans nothing', () => {
    const e: EntitlementEvent = { type: 'trial_started', at: AT, variant: 'no_card' };
    expect(paymentEvents(input(FREE_START, e, session(), null))).toEqual([]);
  });

  it('a checkout without a mirror row plans no start', () => {
    expect(paymentEvents(input(FREE_START, checkout(), session(), null))).toEqual([]);
  });
});

describe('paymentEvents: plan_changed', () => {
  const update = stripeEvent('customer.subscription.updated', subscriptionObject(false));

  it.each([
    ['pro', 'agency'],
    ['agency', 'pro'],
  ] as const)('an update from %s to %s', (from, to) => {
    expect(paymentEvents(input(paid(from), updated(to), update, mirror(to)))).toEqual([
      { event: 'plan_changed', properties: { from, to } },
    ]);
  });

  it('an update that keeps the tier, or restores one from Free, plans none', () => {
    const extras = { ...updated('agency'), extras: { seats: 1, sites: 0 } };
    expect(paymentEvents(input(paid('agency'), extras, update, mirror('agency')))).toEqual([]);
    const unpaid = next(paid('pro'), {
      type: 'subscription_updated',
      at: new Date(AT.getTime() - 60_000),
      subscriptionId: 'sub_1',
      status: 'unpaid',
      plan: 'pro',
      cancelAtPeriodEnd: false,
      extras: { seats: 0, sites: 0 },
    }).state;
    expect(unpaid.tier).toBe('free');
    expect(paymentEvents(input(unpaid, updated('agency'), update, mirror('agency')))).toEqual([]);
  });
});

describe('paymentEvents: subscription_canceled at the period end', () => {
  const scheduling = (previous: Record<string, unknown> | undefined, now: boolean) =>
    stripeEvent('customer.subscription.updated', subscriptionObject(now), previous);

  it('an update of the followed subscription turning cancel_at_period_end on', () => {
    expect(
      paymentEvents(
        input(paid(), updated('pro', true), scheduling({ cancel_at_period_end: false }, true)),
      ),
    ).toEqual([
      { event: 'subscription_canceled', properties: { plan: 'pro', at_period_end: true } },
    ]);
  });

  it.each<[string, Record<string, unknown> | undefined, boolean]>([
    ['no previous attributes', undefined, true],
    ['cancel_at_period_end not among the previous attributes', { status: 'past_due' }, true],
    ['it already on', { cancel_at_period_end: true }, true],
    ['it turned off', { cancel_at_period_end: true }, false],
    ['a previous false the object does not bear out', { cancel_at_period_end: false }, false],
  ])('none with %s', (_, previous, now) => {
    expect(paymentEvents(input(paid(), updated('pro', now), scheduling(previous, now)))).toEqual(
      [],
    );
  });

  it('none for a subscription the account does not follow', () => {
    const other = updated('pro', true, 'sub_other');
    expect(
      paymentEvents(input(paid(), other, scheduling({ cancel_at_period_end: false }, true))),
    ).toEqual([]);
  });
});

describe('paymentEvents: the subscription deleted', () => {
  const deleted = (subscriptionId = 'sub_1'): EntitlementEvent => ({
    type: 'subscription_deleted',
    at: AT,
    subscriptionId,
  });
  const stripe = (cancelAtPeriodEnd: boolean) =>
    stripeEvent('customer.subscription.deleted', subscriptionObject(cancelAtPeriodEnd));

  it('with no end-of-period cancellation set: canceled at once, then ended', () => {
    expect(
      paymentEvents(input(paid('agency'), deleted(), stripe(false), mirror('agency'))),
    ).toEqual([
      { event: 'subscription_canceled', properties: { plan: 'agency', at_period_end: false } },
      { event: 'subscription_ended', properties: { plan: 'agency' } },
    ]);
  });

  it('after an end-of-period cancellation: ended only', () => {
    expect(paymentEvents(input(paid(), deleted(), stripe(true)))).toEqual([
      { event: 'subscription_ended', properties: { plan: 'pro' } },
    ]);
  });

  it('of a subscription the account does not follow: nothing', () => {
    expect(paymentEvents(input(paid(), deleted('sub_other'), stripe(false)))).toEqual([]);
  });
});

describe('paymentEvents: payment_failed', () => {
  const failed = (subscriptionId = 'sub_1'): EntitlementEvent => ({
    type: 'invoice_payment_failed',
    at: AT,
    subscriptionId,
  });
  const invoice = (attempt: unknown) =>
    stripeEvent('invoice.payment_failed', { object: 'invoice', attempt_count: attempt });

  it("the subscription's plan and the invoice's attempt_count", () => {
    expect(paymentEvents(input(paid('agency'), failed(), invoice(2), mirror('agency')))).toEqual([
      { event: 'payment_failed', properties: { plan: 'agency', attempt: 2 } },
    ]);
  });

  it('again on an account already past due, which the machine changes nothing for', () => {
    const pastDue = next(paid(), { ...failed(), at: new Date(AT.getTime() - 60_000) }).state;
    expect(pastDue.state).toBe('past_due');
    expect(paymentEvents(input(pastDue, failed(), invoice(3)))).toEqual([
      { event: 'payment_failed', properties: { plan: 'pro', attempt: 3 } },
    ]);
  });

  it('no attempt_count reads as null; another subscription plans nothing', () => {
    expect(paymentEvents(input(paid(), failed(), invoice(undefined)))).toEqual([
      { event: 'payment_failed', properties: { plan: 'pro', attempt: null } },
    ]);
    expect(paymentEvents(input(paid(), failed('sub_other'), invoice(1)))).toEqual([]);
  });
});

describe('plannedCaptures', () => {
  it("keys each to the owner and the account, with the uuid of its name and the Stripe event's time", () => {
    const stripe = stripeEvent('customer.subscription.deleted', {}, undefined, 'evt_1');
    expect(
      plannedCaptures(
        [
          {
            event: 'subscription_started',
            properties: {
              plan: 'pro',
              interval: 'month',
              trial: false,
              amount_cents: 1900,
              currency: 'usd',
            },
          },
          { event: 'subscription_ended', properties: { plan: 'pro' } },
        ],
        { stripe, distinctId: OWNER, accountId: ACCOUNT },
      ),
    ).toEqual([
      {
        kind: 'capture',
        uuid: 'f81a0237-f9f2-55b2-8a80-e46dd9bad046',
        event: 'subscription_started',
        distinctId: OWNER,
        accountId: ACCOUNT,
        timestamp: '2099-01-01T00:00:00.000Z',
        properties: {
          plan: 'pro',
          interval: 'month',
          trial: false,
          amount_cents: 1900,
          currency: 'usd',
        },
      },
      {
        kind: 'capture',
        uuid: '8678a7b1-24f8-59c6-88fd-421c00a04028',
        event: 'subscription_ended',
        distinctId: OWNER,
        accountId: ACCOUNT,
        timestamp: '2099-01-01T00:00:00.000Z',
        properties: { plan: 'pro' },
      },
    ]);
  });
});

describe('the payment paths fixture is what paymentEvents sends (scripts/ops/posthog counts [cm] Paid over it)', () => {
  const reduced = (events: ReturnType<typeof paymentEvents>): PathEvent[] =>
    events
      .filter((e) => e.event === 'subscription_started' || e.event === 'trial_converted')
      .map((e) => {
        const p = e.properties as { trial?: boolean; via?: 'checkout' | 'subscription' };
        return {
          event: e.event as PathEvent['event'],
          properties: e.event === 'subscription_started' ? { trial: p.trial } : { via: p.via },
        };
      });
  const agencyStart: EntitlementEvent = {
    type: 'agency_trial_started',
    at: new Date(AT.getTime() - 14 * DAY),
    trialEnd: new Date(AT.getTime() - DAY),
    subscriptionId: 'sub_1',
    subscriptionStatus: 'trialing',
  };

  it('direct', () => {
    expect(reduced(paymentEvents(input(FREE_START, checkout(), session())))).toEqual(
      PAYMENT_PATHS.direct,
    );
  });
  it('noCardTrialPays', () => {
    expect(reduced(paymentEvents(input(noCardTrial(), checkout(), session())))).toEqual(
      PAYMENT_PATHS.noCardTrialPays,
    );
  });
  it('cardTrialStarts', () => {
    expect(
      reduced(paymentEvents(input(FREE_START, agencyStart, session(0, 'usd'), mirror('agency')))),
    ).toEqual(PAYMENT_PATHS.cardTrialStarts);
  });
  it('cardTrialPays', () => {
    const started = next(FREE_START, agencyStart);
    if (started.outcome !== 'applied') throw new Error('the trial did not start');
    const stripe = stripeEvent('customer.subscription.updated', subscriptionObject(false), {
      status: 'trialing',
    });
    expect(
      reduced(paymentEvents(input(started.state, updated('agency'), stripe, mirror('agency')))),
    ).toEqual(PAYMENT_PATHS.cardTrialPays);
  });
});
