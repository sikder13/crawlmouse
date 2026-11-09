import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from './catalog';
import { fakeCatalog } from './catalog.fake';
import type { EffectSinks } from './effects';
import { payloads, stripeEvent, type FakeSubscription } from './stripe.fake';
import { MAX_RERUNS } from './stripe-webhook';
import { webhookWorld, type WebhookPort, type WebhookWorld } from './webhook-db.pglite';

vi.mock('server-only', () => ({}));

/**
 * The v2 webhook handler against PGlite with every migration applied and a Stripe fake: the
 * ledger's answers, the out-of-order guard and the superseded rule, the unknown customer, the
 * allow-list, livemode, transient Stripe failures, `at`, the orphan cancellations, disputes,
 * conflicts and the binding. Expected values are written out here, not read from the code.
 *
 * Every test runs twice: through the port that ships, `supabaseWebhookDb` over a PostgREST stand-in
 * on the same database, and through ./webhook-db.pglite.ts's SQL port.
 */

// 2099-01-01T00:00:00Z: after any wall clock this runs at, so history stays in order.
const BASE = 4_070_908_800;
const DAY = 86_400;
const HOUR = 3_600;

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
const id = (prefix: string) => `${prefix}_t${++n}`;

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

function checkoutEvent(
  accountId: string | null,
  customer: string,
  subscription: string,
  created: number,
  extra: { sessionCreated?: number; metadataAccountId?: string | null; mode?: string } = {},
) {
  return stripeEvent(
    'checkout.session.completed',
    payloads.checkout({
      session: id('cs'),
      accountId,
      customer,
      subscription,
      created: extra.sessionCreated ?? created - 60,
      metadataAccountId: extra.metadataAccountId,
      mode: extra.mode,
    }),
    { id: id('evt'), created },
  );
}

const subscriptionEvent = (type: string, s: FakeSubscription, created: number) =>
  stripeEvent(type, payloads.subscription(s), { id: id('evt'), created });
const updated = (s: FakeSubscription, created: number) =>
  subscriptionEvent('customer.subscription.updated', s, created);
const paymentFailed = (
  customer: string,
  subscription: string | null,
  created: number,
  legacy = false,
) =>
  stripeEvent(
    'invoice.payment_failed',
    payloads.invoice({ id: id('in'), customer, subscription, legacy }),
    { id: id('evt'), created },
  );
function dispute(customer: string | null, created: number) {
  const charge = id('ch');
  w.stripe.charges.set(charge, customer);
  return stripeEvent('charge.dispute.created', payloads.dispute({ id: id('dp'), charge }), {
    id: id('evt'),
    created,
  });
}

/** A Free account bound to a new customer; on Pro through a checkout at BASE + 100 when asked. */
async function account(state: 'free' | 'pro' = 'free') {
  const customer = id('cus');
  const accountId = await w.account(customer);
  if (state === 'free') return { accountId, customer, current: null as FakeSubscription | null };
  const current = sub(customer);
  expect(
    (await w.deliver(checkoutEvent(accountId, customer, current.id, BASE + 100))).outcome,
  ).toBe('applied');
  return { accountId, customer, current };
}

async function accountRow(accountId: string) {
  return (
    await w.db.query<{
      state: string;
      tier: string;
      current_subscription_id: string | null;
      entitlement_version: number;
      stripe_customer_id: string | null;
      disputed_at: Date | null;
    }>(
      `select state, tier, current_subscription_id, entitlement_version, stripe_customer_id, disputed_at
         from public.accounts where id = $1`,
      [accountId],
    )
  ).rows[0]!;
}

async function ledgerRow(eventId: string) {
  return (
    await w.db.query<{
      account_id: string | null;
      handled: boolean | null;
      handled_reason: string | null;
      effects: unknown;
      processed_at: Date | null;
    }>(
      `select account_id, handled, handled_reason, effects, processed_at
         from public.stripe_events where id = $1`,
      [eventId],
    )
  ).rows[0];
}

async function mirrorRow(subscriptionId: string) {
  return (
    await w.db.query<{
      status: string;
      plan: string;
      cancel_at_period_end: boolean;
      last_event_id: string | null;
    }>(
      `select status, plan, cancel_at_period_end, last_event_id from public.subscriptions where id = $1`,
      [subscriptionId],
    )
  ).rows[0];
}

const brokenSinks = (sinks: EffectSinks): EffectSinks => ({
  ...sinks,
  send: async () => Promise.reject(new Error('Inngest is down')),
});

describe.each(PORTS)('through the %s port', (p) => {
  beforeAll(() => {
    port = p;
  });

  // ─── The ledger ────────────────────────────────────────────────────────────────────────────────────

  describe('the ledger', () => {
    it('a processed event delivered again changes nothing and sends nothing', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      expect(await w.deliver(e)).toEqual({ outcome: 'applied', accountId, reason: null });
      const before = await accountRow(accountId);
      expect(w.stripe.sent).toHaveLength(1);
      expect(await w.deliver(e)).toEqual({ outcome: 'duplicate' });
      expect(await accountRow(accountId)).toEqual(before);
      expect(w.stripe.sent).toHaveLength(1);
    });

    it('a decision whose effects failed to send is resumed with exactly the stored effects, nothing re-applied', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      await expect(w.deliver(e, { sinks: brokenSinks(w.stripe.sinks()) })).rejects.toThrow(
        'Inngest is down',
      );
      const changed = {
        id: `entitlement.changed:${accountId}:${e.id}`,
        name: 'entitlement.changed',
        data: { accountId, from: 'free', to: 'pro' },
      };
      expect(await ledgerRow(e.id)).toMatchObject({
        handled: true,
        handled_reason: null,
        processed_at: null,
        effects: [{ kind: 'send', ...changed }],
      });
      expect((await accountRow(accountId)).entitlement_version).toBe(1);

      expect(await w.deliver(e)).toEqual({ outcome: 'resumed' });
      expect(w.stripe.sent).toEqual([changed]);
      expect((await accountRow(accountId)).entitlement_version).toBe(1);
      expect((await ledgerRow(e.id))!.processed_at).not.toBeNull();
    });

    it('two deliveries of one event at once decide it once; the later sends what the first recorded', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      let inner: unknown = null;
      w.hooks.afterLoad = async () => {
        w.hooks.afterLoad = undefined;
        inner = await w.deliver(e);
      };
      const outer = await w.deliver(e);
      expect(inner).toEqual({ outcome: 'applied', accountId, reason: null });
      expect(outer).toEqual({ outcome: 'resumed' });
      expect((await accountRow(accountId)).entitlement_version).toBe(1);
      // Each delivery sent the one planned event; Inngest keeps one of two sends with one id.
      const changed = `entitlement.changed:${accountId}:${e.id}`;
      expect(w.stripe.sent.map((x) => x.id)).toEqual([changed, changed]);
    });

    it('an event type outside the subscription set is recorded as not subscribed', async () => {
      const e = stripeEvent(
        'product.created',
        { id: 'prod_1', object: 'product' },
        {
          id: id('evt'),
          created: BASE,
        },
      );
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId: null,
        reason: 'not subscribed',
      });
      expect(await ledgerRow(e.id)).toMatchObject({
        handled: false,
        handled_reason: 'not subscribed',
      });
    });

    it('a recorded-only type is recorded against the customer’s account', async () => {
      const { accountId, customer } = await account();
      const e = stripeEvent(
        'invoice.paid',
        { id: 'in_1', object: 'invoice', customer },
        {
          id: id('evt'),
          created: BASE,
        },
      );
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'invoice.paid is recorded, not applied',
      });
      expect((await ledgerRow(e.id))!.account_id).toBe(accountId);
    });
  });

  // ─── Order ─────────────────────────────────────────────────────────────────────────────────────────

  describe('order: the out-of-order guard and the superseded rule', () => {
    it('an older event after a newer one updates the ledger and not the mirror or the account', async () => {
      const { accountId, current } = await account('pro');
      w.stripe.update(current!.id, { status: 'past_due' });
      const newer = updated(w.stripe.get(current!.id), BASE + 300);
      expect((await w.deliver(newer)).outcome).toBe('applied');
      const accountBefore = await accountRow(accountId);
      expect(accountBefore.state).toBe('past_due');
      // Stripe changes something the mirror holds; the older event would write it.
      w.stripe.update(current!.id, { cancelAtPeriodEnd: true });
      const older = updated(w.stripe.get(current!.id), BASE + 200);
      const sent = w.stripe.sent.length;
      expect(await w.deliver(older)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: "older than the subscription's last event",
      });
      expect(await ledgerRow(older.id)).toMatchObject({
        handled: false,
        handled_reason: "older than the subscription's last event",
        effects: [],
      });
      expect(await mirrorRow(current!.id)).toMatchObject({
        cancel_at_period_end: false,
        last_event_id: newer.id,
      });
      expect(await accountRow(accountId)).toEqual(accountBefore);
      expect(w.stripe.sent).toHaveLength(sent);
    });

    it('a payment failure delivered after the customer paid is superseded: the account stays Pro', async () => {
      const { accountId, customer, current } = await account('pro');
      const failed = paymentFailed(customer, current!.id, BASE + 200);
      // Its first delivery fails before the event is decided.
      w.stripe.failReads = new Error('Stripe is unavailable');
      await expect(w.deliver(failed)).rejects.toThrow('Stripe is unavailable');
      w.stripe.failReads = null;
      expect((await ledgerRow(failed.id))!.handled).toBeNull();
      // The customer fixes the card; Stripe's retry of the failure arrives after.
      w.stripe.update(current!.id, { status: 'active' });
      expect(await w.deliver(failed)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'superseded',
      });
      expect((await accountRow(accountId)).state).toBe('pro');
    });

    it('an update whose status is no longer the subscription’s is superseded', async () => {
      const { accountId, current } = await account('pro');
      const e = updated({ ...w.stripe.get(current!.id), status: 'past_due' }, BASE + 200);
      expect(await w.deliver(e)).toEqual({ outcome: 'recorded', accountId, reason: 'superseded' });
      expect((await accountRow(accountId)).state).toBe('pro');
      expect((await mirrorRow(current!.id))!.last_event_id).toBe(e.id);
    });

    it('a past-due update read before the customer paid, written after the paid one, writes nothing', async () => {
      const { accountId, current } = await account('pro');
      w.stripe.update(current!.id, { status: 'past_due' });
      const stale = updated(w.stripe.get(current!.id), BASE + 200);
      let paid: unknown = null;
      // The stale delivery has read past_due; before it writes, the customer pays and that is processed.
      w.stripe.onNextRead = async () => {
        w.stripe.update(current!.id, { status: 'active' });
        paid = await w.deliver(updated(w.stripe.get(current!.id), BASE + 250));
      };
      expect(await w.deliver(stale)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: "older than the subscription's last event",
      });
      expect(paid).toMatchObject({ outcome: 'ignored', reason: 'no entitlement change' });
      expect((await accountRow(accountId)).state).toBe('pro');
      // The stale delivery planned entitlement.changed to past_due; what it recorded, and sent, is none.
      expect(w.stripe.sent.map((x) => x.data)).toEqual([{ accountId, from: 'free', to: 'pro' }]);
    });

    it('the invoice’s subscription is read from parent, or from the older top-level field', async () => {
      for (const legacy of [false, true]) {
        const { accountId, customer, current } = await account('pro');
        w.stripe.update(current!.id, { status: 'past_due' });
        expect(await w.deliver(paymentFailed(customer, current!.id, BASE + 200, legacy))).toEqual({
          outcome: 'applied',
          accountId,
          reason: null,
        });
        expect((await accountRow(accountId)).state).toBe('past_due');
      }
    });

    it('an invoice with no subscription is recorded', async () => {
      const { accountId, customer } = await account();
      expect(await w.deliver(paymentFailed(customer, null, BASE + 200))).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'the invoice names no subscription',
      });
    });
  });

  // ─── The customer ──────────────────────────────────────────────────────────────────────────────────

  describe('a subscription event whose customer has no account', () => {
    it('throws while the event is under an hour old, leaving the ledger row undecided', async () => {
      const s = sub('cus_nobody');
      const e = updated(s, BASE);
      await expect(w.deliver(e, { now: new Date((BASE + HOUR - 1) * 1000) })).rejects.toThrow(
        /no account for the customer/,
      );
      expect(await ledgerRow(e.id)).toMatchObject({ handled: null, processed_at: null });
    });

    it('is recorded once it is an hour old, with an error report', async () => {
      const s = sub('cus_nobody');
      const e = updated(s, BASE);
      expect(await w.deliver(e, { now: new Date((BASE + HOUR) * 1000) })).toEqual({
        outcome: 'recorded',
        accountId: null,
        reason: 'no account for customer',
      });
      expect(w.reports).toEqual([
        {
          level: 'error',
          message: 'billing.webhook.no_account',
          detail: { customerId: 'cus_nobody' },
          eventId: e.id,
          type: 'customer.subscription.updated',
          accountId: null,
        },
      ]);
    });
  });

  // ─── The allow-list ────────────────────────────────────────────────────────────────────────────────

  describe('the allow-list gates grants', () => {
    it('our checkout on a price outside it grants nothing, cancels the paid subscription and alerts', async () => {
      // Our route opened it (client_reference_id and metadata name the account), so the subscription is
      // ours whatever the listing says: a deploy that changed prices.ts while the session was open.
      const { accountId, customer } = await account();
      const s = sub(customer, { priceIds: ['price_someone_elses'] });
      const e = checkoutEvent(accountId, customer, s.id, BASE + 100);
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'price not in the allow-list',
      });
      expect(await accountRow(accountId)).toMatchObject({ state: 'free', entitlement_version: 0 });
      expect(await mirrorRow(s.id)).toBeUndefined();
      expect(w.reports.map((r) => [r.level, r.message, r.detail.priceIds])).toEqual([
        ['error', 'billing.webhook.foreign_price', 'price_someone_elses'],
      ]);
      expect(w.stripe.cancelled.map((c) => [c.subscriptionId, c.reason])).toEqual([
        [s.id, 'orphaned'],
      ]);
      expect(w.stripe.alerts.map((a) => [a.reason, a.accountId, a.subscriptionId])).toEqual([
        ['orphaned_subscription', accountId, s.id],
      ]);
      expect(w.stripe.live()).toEqual([]);
    });

    it('our checkout on a trial outside it cancels the trial, which has charged nothing, and does not alert', async () => {
      const { accountId, customer } = await account();
      const s = sub(customer, { status: 'trialing', priceIds: ['price_someone_elses'] });
      await w.deliver(checkoutEvent(accountId, customer, s.id, BASE + 100));
      expect(w.stripe.cancelled.map((c) => c.subscriptionId)).toEqual([s.id]);
      expect(w.stripe.alerts).toEqual([]);
    });

    it('extras the plan does not sell are recorded before the machine, and the subscription cancelled', async () => {
      const { accountId, customer } = await account();
      const s = sub(customer, { plan: 'agency', sites: 26 });
      expect(await w.deliver(checkoutEvent(accountId, customer, s.id, BASE + 100))).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'extras the plan does not sell',
      });
      expect(w.stripe.cancelled.map((c) => c.subscriptionId)).toEqual([s.id]);
    });

    it('a revoke applies whatever the price, with the plan the mirror holds, and warns', async () => {
      const { accountId, current } = await account('pro');
      w.stripe.update(current!.id, { status: 'canceled', priceIds: ['price_retired'] });
      expect(await w.deliver(updated(w.stripe.get(current!.id), BASE + 200))).toEqual({
        outcome: 'applied',
        accountId,
        reason: null,
      });
      expect(await accountRow(accountId)).toMatchObject({
        state: 'free',
        current_subscription_id: null,
      });
      expect(await mirrorRow(current!.id)).toMatchObject({ status: 'canceled', plan: 'pro' });
      expect(w.reports.map((r) => r.message)).toEqual(['billing.webhook.foreign_price_on_revoke']);
    });

    it('a revoke on a subscription never mirrored, with prices that are not ours, is recorded', async () => {
      const { accountId, customer } = await account();
      const s = sub(customer, { status: 'canceled', priceIds: ['price_retired'] });
      expect(await w.deliver(updated(s, BASE + 200))).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'price not in the allow-list',
      });
    });
  });

  // ─── Livemode ──────────────────────────────────────────────────────────────────────────────────────

  describe('livemode', () => {
    it('an event of the other mode is refused undecided, and processed once the mode is set right', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      expect(await w.deliver(e, { livemode: true })).toEqual({
        outcome: 'refused',
        reason: 'livemode_mismatch',
      });
      expect(await ledgerRow(e.id)).toEqual({
        account_id: null,
        handled: null,
        handled_reason: 'livemode_mismatch',
        effects: null,
        processed_at: null,
      });
      expect(await w.deliver(e, { livemode: false })).toEqual({
        outcome: 'applied',
        accountId,
        reason: null,
      });
      expect((await accountRow(accountId)).state).toBe('pro');
    });
  });

  // ─── Transient failures ────────────────────────────────────────────────────────────────────────────

  describe('a Stripe failure while normalising throws and leaves the event undecided', () => {
    it('the catalog cannot refresh', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      const failing: Catalog = {
        ...fakeCatalog(),
        planOfPrice: async () => Promise.reject(new Error('prices.list failed')),
      };
      await expect(w.deliver(e, { catalog: failing })).rejects.toThrow('prices.list failed');
      expect(await ledgerRow(e.id)).toMatchObject({ handled: null, processed_at: null });
      expect((await accountRow(accountId)).state).toBe('free');
    });

    it('the subscription cannot be retrieved', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      w.stripe.failReads = new Error('subscriptions.retrieve failed');
      await expect(w.deliver(e)).rejects.toThrow('subscriptions.retrieve failed');
      expect(await ledgerRow(e.id)).toMatchObject({ handled: null, processed_at: null });
    });
  });

  // ─── at ────────────────────────────────────────────────────────────────────────────────────────────

  describe('`at` is event.created', () => {
    it('a checkout whose session predates the last change, delivered after it, grants', async () => {
      const { accountId, current } = await account('pro');
      w.stripe.update(current!.id, { status: 'canceled' });
      await w.deliver(updated(w.stripe.get(current!.id), BASE + 200)); // last change at 200
      expect(await accountRow(accountId)).toMatchObject({ state: 'free' });
      const customer = (await accountRow(accountId)).stripe_customer_id!;
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 250, {
        sessionCreated: BASE + 150,
      });
      expect(await w.deliver(e)).toEqual({ outcome: 'applied', accountId, reason: null });
      expect((await accountRow(accountId)).state).toBe('pro');
    });
  });

  // ─── Orphans ───────────────────────────────────────────────────────────────────────────────────────

  describe('a checkout the account does not follow is cancelled', () => {
    it('two Pro tabs, both paid: the second grants, the first is cancelled with an alert', async () => {
      const { accountId, customer } = await account();
      const a = sub(customer);
      const b = sub(customer);
      await w.deliver(checkoutEvent(accountId, customer, a.id, BASE + 100));
      const second = checkoutEvent(accountId, customer, b.id, BASE + 101);
      expect(await w.deliver(second)).toEqual({ outcome: 'applied', accountId, reason: null });
      expect((await accountRow(accountId)).current_subscription_id).toBe(b.id);
      expect(w.stripe.live()).toEqual([b.id]);
      expect(w.stripe.cancelled).toEqual([
        { kind: 'cancel', subscriptionId: a.id, reason: 'orphaned', source: second.id },
      ]);
      expect(w.stripe.alerts).toEqual([
        {
          kind: 'alert',
          reason: 'orphaned_subscription',
          accountId,
          subscriptionId: a.id,
          source: second.id,
        },
      ]);
    });

    it('two Pro tabs, the later processed first: the earlier is stale, ignored and cancelled', async () => {
      const { accountId, customer } = await account();
      const a = sub(customer);
      const b = sub(customer);
      await w.deliver(checkoutEvent(accountId, customer, b.id, BASE + 102));
      const stale = checkoutEvent(accountId, customer, a.id, BASE + 100);
      expect(await w.deliver(stale)).toEqual({
        outcome: 'ignored',
        accountId,
        reason: 'older than the last entitlement change',
      });
      expect((await accountRow(accountId)).current_subscription_id).toBe(b.id);
      expect(w.stripe.live()).toEqual([b.id]);
      expect(w.stripe.alerts.map((x) => x.subscriptionId)).toEqual([a.id]);
    });

    it('two Agency trial tabs: the second is ignored and cancelled at once, without an alert', async () => {
      const { accountId, customer } = await account();
      const trial = {
        plan: 'agency' as const,
        status: 'trialing' as const,
        trialEnd: BASE + 15 * DAY,
      };
      const a = sub(customer, trial);
      const b = sub(customer, trial);
      await w.deliver(checkoutEvent(accountId, customer, a.id, BASE + 100));
      expect(await w.deliver(checkoutEvent(accountId, customer, b.id, BASE + 101))).toEqual({
        outcome: 'ignored',
        accountId,
        reason: 'only a Free account starts a trial',
      });
      expect((await accountRow(accountId)).state).toBe('agency_trial');
      expect(w.stripe.live()).toEqual([a.id]);
      expect(w.stripe.cancelled.map((x) => x.subscriptionId)).toEqual([b.id]);
      expect(w.stripe.alerts).toEqual([]);
    });

    it('a checkout naming no account of ours is recorded, and its live subscription cancelled', async () => {
      const s = sub('cus_stranger');
      const e = checkoutEvent('7d0a4f43-7f1c-4c55-9f3a-8f9f7b0e2c11', 'cus_stranger', s.id, BASE);
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId: null,
        reason: 'no account for the checkout',
      });
      expect(w.stripe.live()).toEqual([]);
      expect(w.stripe.alerts).toEqual([
        {
          kind: 'alert',
          reason: 'orphaned_subscription',
          accountId: null,
          subscriptionId: s.id,
          source: e.id,
        },
      ]);
    });

    it('a checkout whose metadata names another account is treated as naming none', async () => {
      const { accountId, customer } = await account();
      const s = sub(customer);
      const e = checkoutEvent(accountId, customer, s.id, BASE, {
        metadataAccountId: '7d0a4f43-7f1c-4c55-9f3a-8f9f7b0e2c11',
      });
      expect(await w.deliver(e)).toMatchObject({ reason: 'no account for the checkout' });
      expect((await accountRow(accountId)).state).toBe('free');
    });

    it('a checkout that is not a subscription is recorded and nothing is cancelled', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE, { mode: 'payment' });
      expect(await w.deliver(e)).toMatchObject({ reason: 'not a subscription checkout' });
      expect(w.stripe.cancelled).toEqual([]);
    });
  });

  // ─── Disputes ──────────────────────────────────────────────────────────────────────────────────────

  describe('a dispute', () => {
    it('moves the account to Free, cancels the followed subscription and alerts naming it', async () => {
      const { accountId, customer, current } = await account('pro');
      const e = dispute(customer, BASE + 200);
      expect(await w.deliver(e)).toEqual({ outcome: 'applied', accountId, reason: null });
      expect(await accountRow(accountId)).toMatchObject({
        state: 'free',
        current_subscription_id: current!.id,
      });
      expect((await accountRow(accountId)).disputed_at).not.toBeNull();
      expect(w.stripe.cancelled).toEqual([
        { kind: 'cancel', subscriptionId: current!.id, reason: 'disputed', source: e.id },
      ]);
      expect(w.stripe.alerts).toEqual([
        { kind: 'alert', reason: 'dispute', accountId, subscriptionId: current!.id, source: e.id },
      ]);
      expect(w.stripe.live()).toEqual([]);
    });

    it('on a charge no account of ours owns: recorded, with a founder alert', async () => {
      const e = dispute('cus_stranger', BASE);
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId: null,
        reason: 'no account for the disputed charge',
      });
      expect(w.stripe.alerts).toEqual([
        { kind: 'alert', reason: 'dispute', accountId: null, subscriptionId: null, source: e.id },
      ]);
    });
  });

  // ─── Effects ───────────────────────────────────────────────────────────────────────────────────────

  describe('effects', () => {
    it('a converted no-card trial stores and sends trial.converted and entitlement.changed', async () => {
      const { accountId, customer } = await account();
      await w.db.query(
        `select public.apply_entitlement_transition($1, 0, 'pro_trial', 'pro', null, null, 'no_card',
         $2, $3, null, 2, 5, 1, $3, null, null)`,
        [accountId, new Date((BASE + 14 * DAY) * 1000), new Date(BASE * 1000)],
      );
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      await w.deliver(e);
      const sends = [
        {
          id: `trial.converted:${accountId}:${e.id}`,
          name: 'trial.converted',
          data: { accountId },
        },
        {
          id: `entitlement.changed:${accountId}:${e.id}`,
          name: 'entitlement.changed',
          data: { accountId, from: 'pro_trial', to: 'pro' },
        },
      ];
      expect((await ledgerRow(e.id))!.effects).toEqual(sends.map((s) => ({ kind: 'send', ...s })));
      expect(w.stripe.sent).toEqual(sends);
    });

    it('relimit and the site effects plan nothing: Free to Pro sends entitlement.changed only', async () => {
      const { accountId, customer } = await account();
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      await w.deliver(e);
      expect(w.stripe.sent.map((s) => s.name)).toEqual(['entitlement.changed']);
      expect(await ledgerRow(e.id)).toMatchObject({
        effects: [expect.objectContaining({ name: 'entitlement.changed' })],
      });
      // The relimit was done in the transaction: Pro's limits are on the row.
      const { rows } = await w.db.query<{ seat_limit: number; site_limit: number }>(
        `select seat_limit, site_limit from public.accounts where id = $1`,
        [accountId],
      );
      expect(rows[0]).toEqual({ seat_limit: 2, site_limit: 5 });
    });

    it('an agency trial’s trial_will_end stores and sends the reminder email', async () => {
      const { accountId, customer } = await account();
      const s = sub(customer, { plan: 'agency', status: 'trialing', trialEnd: BASE + 15 * DAY });
      await w.deliver(checkoutEvent(accountId, customer, s.id, BASE + 100));
      const e = subscriptionEvent('customer.subscription.trial_will_end', s, BASE + 12 * DAY);
      expect(await w.deliver(e)).toEqual({ outcome: 'applied', accountId, reason: null });
      expect(w.stripe.sent.at(-1)).toEqual({
        id: `email.requested:trial_reminder:${accountId}:${e.id}`,
        name: 'email.requested',
        data: { accountId, template: 'trial_reminder' },
      });
    });
  });

  // ─── Conflicts and the binding ─────────────────────────────────────────────────────────────────────

  describe('conflicts', () => {
    it('a decision on an account that changed meanwhile is made again on the new state', async () => {
      const { accountId, customer, current } = await account('pro');
      w.stripe.update(current!.id, { status: 'past_due' });
      const pastDue = updated(w.stripe.get(current!.id), BASE + 200);
      w.hooks.afterLoad = async () => {
        w.hooks.afterLoad = undefined;
        const failed = paymentFailed(customer, current!.id, BASE + 150);
        expect((await w.deliver(failed)).outcome).toBe('applied');
      };
      // Decided on Pro it would start the grace at 200; on the past-due account it only marks the time.
      expect(await w.deliver(pastDue)).toEqual({ outcome: 'applied', accountId, reason: null });
      const { rows } = await w.db.query<{
        state: string;
        past_due_since: Date;
        entitlement_version: number;
      }>(`select state, past_due_since, entitlement_version from public.accounts where id = $1`, [
        accountId,
      ]);
      expect(rows[0]).toEqual({
        state: 'past_due',
        past_due_since: new Date((BASE + 150) * 1000),
        entitlement_version: 3,
      });
    });

    it(`gives up after ${MAX_RERUNS} more decisions and throws, leaving the event undecided`, async () => {
      const { accountId, customer } = await account();
      let loads = 0;
      w.hooks.afterLoad = async () => {
        loads++;
        await w.db.query(
          `update public.accounts set entitlement_version = entitlement_version + 1 where id = $1`,
          [accountId],
        );
      };
      const e = checkoutEvent(accountId, customer, sub(customer).id, BASE + 100);
      await expect(w.deliver(e)).rejects.toThrow(/changed since it was read/);
      expect(loads).toBe(4);
      expect((await ledgerRow(e.id))!.handled).toBeNull();
    });
  });

  describe('the customer binding', () => {
    it('a checkout binds its customer to an account that has none', async () => {
      const { accountId } = await account();
      await w.db.query(`update public.accounts set stripe_customer_id = null where id = $1`, [
        accountId,
      ]);
      const s = sub('cus_new');
      expect((await w.deliver(checkoutEvent(accountId, 'cus_new', s.id, BASE + 100))).outcome).toBe(
        'applied',
      );
      expect((await accountRow(accountId)).stripe_customer_id).toBe('cus_new');
    });

    it('a checkout whose customer is another account’s is recorded, cancelled and reported', async () => {
      const other = await account();
      const { accountId } = await account();
      await w.db.query(`update public.accounts set stripe_customer_id = null where id = $1`, [
        accountId,
      ]);
      const s = sub(other.customer);
      const e = checkoutEvent(accountId, other.customer, s.id, BASE + 100);
      expect(await w.deliver(e)).toEqual({
        outcome: 'recorded',
        accountId,
        reason: 'the customer belongs to another account',
      });
      expect((await accountRow(accountId)).stripe_customer_id).toBeNull();
      expect(w.stripe.live()).toEqual([]);
      expect(w.reports.map((r) => r.message)).toEqual(['billing.webhook.customer_mismatch']);
    });

    it('a checkout for another customer than the account’s is recorded and cancelled', async () => {
      const { accountId } = await account();
      const s = sub('cus_elsewhere');
      expect(
        await w.deliver(checkoutEvent(accountId, 'cus_elsewhere', s.id, BASE + 100)),
      ).toMatchObject({ reason: 'the checkout is for another customer' });
      expect(w.stripe.live()).toEqual([]);
    });

    it('a binding that loses a race to another account is decided again and recorded', async () => {
      const { accountId } = await account();
      await w.db.query(`update public.accounts set stripe_customer_id = null where id = $1`, [
        accountId,
      ]);
      const s = sub('cus_raced');
      w.hooks.afterLoad = async () => {
        w.hooks.afterLoad = undefined;
        await w.account('cus_raced'); // another account binds the customer first
      };
      expect(
        await w.deliver(checkoutEvent(accountId, 'cus_raced', s.id, BASE + 100)),
      ).toMatchObject({
        reason: 'the customer belongs to another account',
      });
      expect((await accountRow(accountId)).stripe_customer_id).toBeNull();
    });
  });

  describe('reports carry ids, never a Stripe object', () => {
    it('every detail value is a string or null', async () => {
      const { accountId, customer } = await account();
      await w.deliver(
        checkoutEvent(accountId, customer, sub(customer, { priceIds: ['price_x'] }).id, BASE),
      );
      await w.deliver(dispute('cus_stranger', BASE));
      await w.deliver(updated(sub('cus_nobody'), BASE), {
        now: new Date((BASE + 2 * HOUR) * 1000),
      });
      expect(w.reports).toHaveLength(3);
      for (const r of w.reports) {
        for (const v of Object.values(r.detail))
          expect(v === null || typeof v === 'string').toBe(true);
      }
    });
  });
});
