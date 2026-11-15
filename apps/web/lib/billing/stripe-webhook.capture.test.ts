import type Stripe from 'stripe';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCatalog } from './catalog.fake';
import { payloads, stripeEvent, type FakeSubscription } from './stripe.fake';
import { applyStripeEvent } from './stripe-webhook';
import {
  pgliteWebhookDb,
  postgrestWebhookDb,
  webhookWorld,
  type WebhookPort,
  type WebhookWorld,
} from './webhook-db.pglite';

vi.mock('server-only', () => ({}));

/**
 * The payment events the v2 webhook plans (CC-41 D3), against PGlite with every migration and the
 * Stripe fake: stored in the ledger with the rest of the plan, keyed to the account owner's
 * `users.id`, and sent once per Stripe event. Which decision plans which event is
 * ./payment-events.test.ts's; this file shows the wiring. The owner's id is read from `users`, not
 * from `seats`, which the code reads.
 *
 * Every test runs through both ports, as ./stripe-webhook.test.ts's do.
 */

// 2099-01-01T00:00:00Z: after any wall clock this runs at.
const BASE = 4_070_908_800;
const DAY = 86_400;

const PORTS: readonly WebhookPort[] = ['postgrest', 'pglite'];
let port: WebhookPort;
let w: WebhookWorld;
beforeEach(async () => {
  w = await webhookWorld({ port });
}, 120_000);
afterEach(async () => {
  await w?.db.close();
});

let n = 0;
const id = (prefix: string) => `${prefix}_c${++n}`;

function sub(customer: string, change: Partial<FakeSubscription> = {}): FakeSubscription {
  return w.stripe.put({
    id: id('sub'),
    customer,
    status: 'active',
    plan: 'pro',
    interval: 'month',
    seats: 0,
    sites: 0,
    trialEnd: null,
    periodEnd: BASE + 30 * DAY,
    cancelAtPeriodEnd: false,
    ...change,
  });
}

function checkoutEvent(accountId: string, customer: string, subscription: string, created: number) {
  return stripeEvent(
    'checkout.session.completed',
    {
      ...payloads.checkout({
        session: id('cs'),
        accountId,
        customer,
        subscription,
        created: created - 60,
      }),
      amount_total: 1900,
      currency: 'usd',
    },
    { id: id('evt'), created },
  );
}

async function owner(accountId: string): Promise<string> {
  const { rows } = await w.db.query<{ id: string }>(
    `select id from public.users where default_account_id = $1`,
    [accountId],
  );
  return rows[0]!.id;
}

async function storedCaptures(eventId: string) {
  const { rows } = await w.db.query<{ effects: { kind: string }[] }>(
    `select effects from public.stripe_events where id = $1`,
    [eventId],
  );
  return rows[0]!.effects.filter((x) => x.kind === 'capture');
}

async function paidAccount() {
  const customer = id('cus');
  const accountId = await w.account(customer);
  const current = sub(customer);
  const e = checkoutEvent(accountId, customer, current.id, BASE + 100);
  expect((await w.deliver(e)).outcome).toBe('applied');
  return { accountId, customer, current, checkout: e };
}

describe.each(PORTS)('through the %s port', (p) => {
  beforeAll(() => {
    port = p;
  });

  it("a checkout stores and sends subscription_started, keyed to the owner, with the session's amount", async () => {
    const { accountId, checkout } = await paidAccount();
    const expected = {
      kind: 'capture',
      uuid: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      event: 'subscription_started',
      distinctId: await owner(accountId),
      accountId,
      timestamp: new Date((BASE + 100) * 1000).toISOString(),
      properties: {
        plan: 'pro',
        interval: 'month',
        trial: false,
        amount_cents: 1900,
        currency: 'usd',
      },
    };
    expect(await storedCaptures(checkout.id)).toEqual([expected]);
    expect(w.stripe.captured).toEqual([expected]);
  });

  it('the same Stripe event delivered again sends nothing more', async () => {
    const { checkout } = await paidAccount();
    expect(w.stripe.captured).toHaveLength(1);
    expect(await w.deliver(checkout)).toEqual({ outcome: 'duplicate' });
    expect(w.stripe.captured).toHaveLength(1);
  });

  it('a crash between the decision and the stamp resends the stored plan: a byte-identical capture', async () => {
    const { checkout } = await paidAccount();
    // What a crash after the decision leaves: decided, not processed.
    await w.db.query(`update public.stripe_events set processed_at = null where id = $1`, [
      checkout.id,
    ]);
    expect(await w.deliver(checkout, { now: new Date((BASE + 2 * DAY) * 1000) })).toEqual({
      outcome: 'resumed',
    });
    expect(w.stripe.captured).toHaveLength(2);
    expect(JSON.stringify(w.stripe.captured[1])).toBe(JSON.stringify(w.stripe.captured[0]));
  });

  it('a failed effect before the captures sends none; the retry sends each once', async () => {
    const customer = id('cus');
    const accountId = await w.account(customer);
    const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
    const broken = {
      ...w.stripe.sinks(),
      send: async () => Promise.reject(new Error('Inngest is down')),
    };
    await expect(w.deliver(e, { sinks: broken })).rejects.toThrow('Inngest is down');
    expect(w.stripe.captured).toEqual([]);
    expect(await w.deliver(e)).toEqual({ outcome: 'resumed' });
    expect(w.stripe.captured.map((c) => c.event)).toEqual(['subscription_started']);
  });

  it('a scheduled cancellation, a failed payment and the deletion, from the raw events', async () => {
    const { accountId, customer, current } = await paidAccount();
    w.stripe.update(current.id, { cancelAtPeriodEnd: true });
    const scheduled = stripeEvent(
      'customer.subscription.updated',
      payloads.subscription(w.stripe.get(current.id)),
      { id: id('evt'), created: BASE + DAY },
    );
    (scheduled.data as Stripe.Event.Data).previous_attributes = { cancel_at_period_end: false };
    expect((await w.deliver(scheduled)).outcome).toBe('ignored');

    w.stripe.update(current.id, { status: 'past_due' });
    const failed = stripeEvent(
      'invoice.payment_failed',
      {
        ...payloads.invoice({ id: id('in'), customer, subscription: current.id }),
        attempt_count: 1,
      },
      { id: id('evt'), created: BASE + 2 * DAY },
    );
    expect((await w.deliver(failed)).outcome).toBe('applied');

    w.stripe.update(current.id, { status: 'canceled' });
    const deleted = stripeEvent(
      'customer.subscription.deleted',
      payloads.subscription(w.stripe.get(current.id)),
      { id: id('evt'), created: BASE + 3 * DAY },
    );
    expect((await w.deliver(deleted)).outcome).toBe('applied');

    const by = await owner(accountId);
    expect(
      w.stripe.captured.map((c) => [c.event, c.properties, c.distinctId, c.timestamp]),
    ).toEqual([
      ['subscription_started', expect.anything(), by, expect.any(String)],
      [
        'subscription_canceled',
        { plan: 'pro', at_period_end: true },
        by,
        new Date((BASE + DAY) * 1000).toISOString(),
      ],
      [
        'payment_failed',
        { plan: 'pro', attempt: 1 },
        by,
        new Date((BASE + 2 * DAY) * 1000).toISOString(),
      ],
      ['subscription_ended', { plan: 'pro' }, by, new Date((BASE + 3 * DAY) * 1000).toISOString()],
    ]);
  });

  it('an account with no active owner plans no capture, and the decision still applies, reported', async () => {
    const customer = id('cus');
    const accountId = await w.account(customer);
    await w.db.query(
      `update public.seats set status = 'removed', removed_at = now()
        where account_id = $1 and role = 'owner'`,
      [accountId],
    );
    // An active seat that is not the owner's does not stand in for one.
    await w.db.query(
      `insert into auth.users (id, email) values ('3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b', 'am@example.com')`,
    );
    await w.db.query(
      `insert into public.seats (account_id, user_id, invited_email, role, status, accepted_at)
       values ($1, '3f1d2c4b-5a6e-4f70-8a9b-0c1d2e3f4a5b', 'am@example.com', 'account_manager', 'active', now())`,
      [accountId],
    );
    const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
    expect(await w.deliver(e)).toEqual({ outcome: 'applied', accountId, reason: null });
    expect(await storedCaptures(e.id)).toEqual([]);
    expect(w.stripe.captured).toEqual([]);
    expect(w.reports).toEqual([
      {
        level: 'warning',
        message: 'billing.webhook.capture_without_owner',
        detail: { events: 'subscription_started' },
        eventId: e.id,
        type: 'checkout.session.completed',
        accountId,
      },
    ]);
  });

  it('an owner lookup that fails plans no capture: the decision applies, reported as an error', async () => {
    const customer = id('cus');
    const accountId = await w.account(customer);
    const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
    const db = (p === 'pglite' ? pgliteWebhookDb : postgrestWebhookDb)(w.db);
    const reports: unknown[] = [];
    const outcome = await applyStripeEvent(
      e,
      {
        db: { ...db, ownerUserId: async () => Promise.reject(new Error('seats unreadable')) },
        stripe: w.stripe,
        catalog: fakeCatalog(),
        sinks: w.stripe.sinks(),
        livemode: false,
      },
      { now: () => new Date((BASE + 160) * 1000), report: (r) => reports.push(r) },
    );
    expect(outcome).toEqual({ outcome: 'applied', accountId, reason: null });
    expect(w.stripe.captured).toEqual([]);
    expect(reports).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'billing.webhook.capture_unplanned',
        detail: { reason: 'seats unreadable' },
      }),
    ]);
  });
});
