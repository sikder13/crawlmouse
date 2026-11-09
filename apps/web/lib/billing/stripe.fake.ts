/**
 * A Stripe account in memory, for the v2 webhook's tests: the subscriptions and charges the handler
 * retrieves (`StripeReads`), effect sinks whose cancellation ends a subscription here, and events
 * built and signed as Stripe sends them. Test-only.
 */
import Stripe from 'stripe';
import type { PaidTier } from '../entitlement-v2';
import { lookupKey, type Interval } from './catalog';
import { fakePriceId } from './catalog.fake';
import type { EffectSinks, InngestSend, PlannedAlert, PlannedCancel } from './effects';
import type { SubscriptionStatus } from './state-machine';
import type { StripeReads } from './webhook-types';

/** The secret the fake signs with. Not a Stripe secret: any string signs a test header. */
export const WEBHOOK_SECRET = 'cc03-webhook-test-secret';

export interface FakeSubscription {
  id: string;
  customer: string;
  status: SubscriptionStatus;
  plan: PaidTier;
  interval: Interval;
  seats: number;
  sites: number;
  /** Unix seconds. */
  trialEnd: number | null;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  /** Prices in place of the catalog's, for a subscription that is not ours. */
  priceIds?: string[];
}

const ENDED: ReadonlySet<SubscriptionStatus> = new Set(['canceled', 'incomplete_expired']);
const LIVE: ReadonlySet<SubscriptionStatus> = new Set(['trialing', 'active', 'past_due']);

function item(id: string, price: string, quantity: number, periodEnd: number) {
  return {
    id,
    object: 'subscription_item',
    price: { id: price },
    quantity,
    current_period_end: periodEnd,
  };
}

/** A subscription as the pinned SDK retrieves it: items carry the price and the period end. */
export function stripeSubscription(f: FakeSubscription): Stripe.Subscription {
  const items = f.priceIds
    ? f.priceIds.map((p, i) => item(`si_${f.id}_${i}`, p, 1, f.periodEnd))
    : [
        item(`si_${f.id}_base`, fakePriceId(lookupKey(f.plan, f.interval, 'base')), 1, f.periodEnd),
        ...(f.seats > 0
          ? [
              item(
                `si_${f.id}_seat`,
                fakePriceId(lookupKey(f.plan, f.interval, 'seat')),
                f.seats,
                f.periodEnd,
              ),
            ]
          : []),
        ...(f.sites > 0
          ? [
              item(
                `si_${f.id}_site`,
                fakePriceId(lookupKey(f.plan, f.interval, 'site')),
                f.sites,
                f.periodEnd,
              ),
            ]
          : []),
      ];
  return {
    id: f.id,
    object: 'subscription',
    customer: f.customer,
    status: f.status,
    items: {
      object: 'list',
      data: items,
      has_more: false,
      url: `/v1/subscription_items?subscription=${f.id}`,
    },
    trial_end: f.trialEnd,
    cancel_at_period_end: f.cancelAtPeriodEnd,
    canceled_at: ENDED.has(f.status) ? f.periodEnd : null,
    ended_at: ENDED.has(f.status) ? f.periodEnd : null,
  } as unknown as Stripe.Subscription;
}

export class StripeFake implements StripeReads {
  readonly subscriptions = new Map<string, FakeSubscription>();
  readonly charges = new Map<string, string | null>();
  readonly sent: InngestSend[] = [];
  readonly cancelled: PlannedCancel[] = [];
  readonly alerts: PlannedAlert[] = [];
  /** Thrown by the subscription and charge reads while set, as in a Stripe outage. */
  failReads: Error | null = null;
  /** Runs once, inside the next subscription read, before it answers. */
  onNextRead: (() => Promise<void>) | null = null;

  put(sub: FakeSubscription): FakeSubscription {
    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  update(id: string, change: Partial<FakeSubscription>): void {
    this.subscriptions.set(id, { ...this.get(id), ...change });
  }

  get(id: string): FakeSubscription {
    const sub = this.subscriptions.get(id);
    if (!sub) throw new Error(`the fake holds no ${id}`);
    return sub;
  }

  /** Subscriptions Stripe would still charge. */
  live(): string[] {
    return [...this.subscriptions.values()].filter((s) => LIVE.has(s.status)).map((s) => s.id);
  }

  async retrieveSubscription(id: string): Promise<Stripe.Subscription> {
    if (this.failReads) throw this.failReads;
    const hook = this.onNextRead;
    this.onNextRead = null;
    const answer = stripeSubscription(this.get(id));
    if (hook) await hook();
    return answer;
  }

  async retrieveCharge(id: string): Promise<Stripe.Charge> {
    if (this.failReads) throw this.failReads;
    if (!this.charges.has(id)) throw new Error(`the fake holds no ${id}`);
    return { id, object: 'charge', customer: this.charges.get(id) } as unknown as Stripe.Charge;
  }

  sinks(): EffectSinks {
    return {
      send: async (events) => {
        this.sent.push(...events);
      },
      cancel: async (cancel) => {
        this.cancelled.push(cancel);
        const sub = this.subscriptions.get(cancel.subscriptionId);
        if (sub && !ENDED.has(sub.status)) this.update(sub.id, { status: 'canceled' });
      },
      alert: async (alert) => {
        this.alerts.push(alert);
      },
    };
  }
}

export interface EventOptions {
  id: string;
  /** Unix seconds. */
  created: number;
  livemode?: boolean;
}

/** The JSON Stripe posts for an event, and the signature header it sends with it. */
export function signedPayload(
  type: string,
  object: Record<string, unknown>,
  { id, created, livemode = false }: EventOptions,
): { payload: string; header: string } {
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2026-05-27.dahlia',
    created,
    livemode,
    type,
    data: { object },
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

/** An event as the route has it after `constructEvent`: signed, then verified. */
export function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  options: EventOptions,
): Stripe.Event {
  const { payload, header } = signedPayload(type, object, options);
  return Stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET);
}

/** The payload objects of the event types the webhook reads. */
export const payloads = {
  checkout(o: {
    session: string;
    accountId: string | null;
    customer: string;
    subscription: string;
    created: number;
    metadataAccountId?: string | null;
    mode?: string;
  }): Record<string, unknown> {
    const meta = o.metadataAccountId === undefined ? o.accountId : o.metadataAccountId;
    return {
      id: o.session,
      object: 'checkout.session',
      mode: o.mode ?? 'subscription',
      customer: o.customer,
      client_reference_id: o.accountId,
      metadata: meta === null ? {} : { account_id: meta },
      subscription: o.subscription,
      created: o.created,
    };
  },
  subscription(f: FakeSubscription): Record<string, unknown> {
    return stripeSubscription(f) as unknown as Record<string, unknown>;
  },
  invoice(o: { id: string; customer: string; subscription: string | null; legacy?: boolean }) {
    if (o.legacy) {
      return { id: o.id, object: 'invoice', customer: o.customer, subscription: o.subscription };
    }
    return {
      id: o.id,
      object: 'invoice',
      customer: o.customer,
      parent:
        o.subscription === null
          ? null
          : {
              type: 'subscription_details',
              subscription_details: { subscription: o.subscription },
            },
    };
  },
  dispute(o: { id: string; charge: string }): Record<string, unknown> {
    return { id: o.id, object: 'dispute', charge: o.charge };
  },
};
