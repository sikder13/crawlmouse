/**
 * A verified Stripe event of the Crawlmouse account, turned into what the v2 webhook does with it
 * (CC-03 D4, D5; spec 03, "The webhook"): an entitlement event for the machine, or a decision that
 * is only recorded. From the payload it reads `type`, `created`, `livemode`, ids, `customer`,
 * `client_reference_id`, `metadata`, `mode`, an update's `status` and an invoice's `parent` (or its
 * older top-level `subscription`), fields that keep their meaning across API versions; subscription
 * status, plan and extras come from Stripe at processing time.
 *
 * The rules this module adds to the machine's:
 * - A grant (a checkout, an agency trial start, an update to `active`) needs a subscription the
 *   allow-list accepts; a revoke applies whatever the prices, with the plan the mirror holds
 *   (spec 03, Q11).
 * - An update whose status is no longer the subscription's, and a payment failure on a subscription
 *   that is not `past_due` or `unpaid`, are recorded as superseded: the event that made the change
 *   carries it (spec 03, review finding 2).
 * - An event whose customer has no account throws while it is under an hour old, so Stripe retries
 *   while the binding checkout may still be in flight, and is recorded after that (spec 03, Q16).
 * - A checkout that grants nothing leaves its subscription orphaned; a live one is cancelled
 *   (spec 03, Q10). `orphanEffects` plans that, here and in ./stripe-webhook.ts.
 * - A checkout whose subscription is still `incomplete` throws, so it is retried rather than
 *   decided: Stripe settles the subscription `active` on the first payment or `incomplete_expired`
 *   23 hours later, and retries a live-mode event for up to three days (a sandbox's, three times
 *   over a few hours). Decided while `incomplete`, it would grant nothing and cancel nothing.
 *
 * Any Stripe error propagates, so the event is answered 500 and retried rather than recorded.
 */
import type Stripe from 'stripe';
import type { Catalog } from './catalog';
import type { PlannedEffect } from './effects';
import type { EntitlementEvent, SubscriptionStatus } from './state-machine';
import { keptMirror, mirrorOf, type MirrorResult, type MirrorRow } from './subscription-mirror';
import type { EventWrite, WebhookDb } from './webhook-db';
import type { StripeReads } from './webhook-types';

/** How long an event whose customer has no account is retried before it is recorded. */
export const NO_ACCOUNT_RETRY_MS = 60 * 60 * 1000;

/** A subscription Stripe may still charge. */
const LIVE: ReadonlySet<SubscriptionStatus> = new Set(['trialing', 'active', 'past_due']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Something an operator should see, sent to Sentry by the route. `detail` holds ids, as strings. */
export interface Report {
  level: 'warning' | 'error';
  message: string;
  detail: Record<string, string | null>;
}

export type Decision =
  | {
      kind: 'apply';
      accountId: string;
      event: EntitlementEvent;
      write: EventWrite;
      /** For a checkout-derived grant: its subscription as retrieved, for the orphan rules. */
      checkout: { subscriptionId: string; status: SubscriptionStatus } | null;
      reports: Report[];
    }
  | {
      kind: 'record';
      accountId: string | null;
      reason: string;
      write: EventWrite;
      effects: PlannedEffect[];
      reports: Report[];
    };

export interface NormaliseContext {
  db: Pick<WebhookDb, 'accountById' | 'accountByCustomer' | 'subscriptionById'>;
  stripe: StripeReads;
  catalog: Catalog;
  now: Date;
}

/** The cancellation, and for a paid one the founder alert, of a subscription nothing follows. */
export function orphanEffects(
  sub: { subscriptionId: string; status: SubscriptionStatus },
  accountId: string | null,
  source: string,
): PlannedEffect[] {
  if (!LIVE.has(sub.status)) return [];
  const cancel: PlannedEffect = {
    kind: 'cancel',
    subscriptionId: sub.subscriptionId,
    reason: 'orphaned',
    source,
  };
  if (sub.status === 'trialing') return [cancel];
  return [
    cancel,
    {
      kind: 'alert',
      reason: 'orphaned_subscription',
      accountId,
      subscriptionId: sub.subscriptionId,
      source,
    },
  ];
}

type Payload = Record<string, unknown>;

/** A Stripe reference: an id, or an expanded object's id. */
function idOf(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  if (v !== null && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string') {
    return (v as { id: string }).id;
  }
  return null;
}

function priceReport(message: string, mirror: MirrorResult, subscriptionId: string): Report {
  return {
    level: 'warning',
    message,
    detail: {
      subscriptionId,
      refused: 'refused' in mirror ? mirror.refused : null,
      priceIds: 'refused' in mirror ? mirror.priceIds.join(',') : null,
    },
  };
}

class Normaliser {
  private readonly at: Date;
  private readonly payload: Payload;

  constructor(
    private readonly event: Stripe.Event,
    private readonly ctx: NormaliseContext,
  ) {
    this.at = new Date(event.created * 1000);
    this.payload = event.data.object as unknown as Payload;
  }

  private write(
    accountId: string | null,
    subscription: EventWrite['subscription'] = null,
    bindCustomer: string | null = null,
  ): EventWrite {
    return { eventId: this.event.id, created: this.at, accountId, bindCustomer, subscription };
  }

  private record(
    accountId: string | null,
    reason: string,
    extra: { write?: EventWrite; effects?: PlannedEffect[]; reports?: Report[] } = {},
  ): Decision {
    return {
      kind: 'record',
      accountId,
      reason,
      write: extra.write ?? this.write(accountId),
      effects: extra.effects ?? [],
      reports: extra.reports ?? [],
    };
  }

  private apply(
    accountId: string,
    event: EntitlementEvent,
    write: EventWrite,
    extra: {
      checkout?: { subscriptionId: string; status: SubscriptionStatus };
      reports?: Report[];
    } = {},
  ): Decision {
    return {
      kind: 'apply',
      accountId,
      event,
      write,
      checkout: extra.checkout ?? null,
      reports: extra.reports ?? [],
    };
  }

  /** The account a customer is bound to; none throws while the event is young (Q16). */
  private async accountOfCustomer(customer: string | null): Promise<string | Decision> {
    const accountId = customer === null ? null : await this.ctx.db.accountByCustomer(customer);
    if (accountId !== null) return accountId;
    if (this.ctx.now.getTime() - this.at.getTime() < NO_ACCOUNT_RETRY_MS) {
      throw new Error(`no account for the customer of stripe event ${this.event.id} yet`);
    }
    return this.record(null, 'no account for customer', {
      reports: [
        { level: 'error', message: 'billing.webhook.no_account', detail: { customerId: customer } },
      ],
    });
  }

  async decide(): Promise<Decision> {
    switch (this.event.type) {
      case 'checkout.session.completed':
        return this.checkout();
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        return this.subscription(this.event.type);
      case 'invoice.payment_failed':
        return this.paymentFailed();
      case 'charge.dispute.created':
        return this.dispute();
      case 'invoice.paid':
      case 'setup_intent.succeeded':
      case 'charge.refunded':
        return this.recordedOnly(idOf(this.payload.customer));
      case 'customer.updated':
        return this.recordedOnly(idOf(this.payload.id));
      default:
        return this.record(null, 'not subscribed');
    }
  }

  private async recordedOnly(customer: string | null): Promise<Decision> {
    const accountId = customer === null ? null : await this.ctx.db.accountByCustomer(customer);
    return this.record(accountId, `${this.event.type} is recorded, not applied`);
  }

  private async checkout(): Promise<Decision> {
    const s = this.payload;
    if (s.mode !== 'subscription') return this.record(null, 'not a subscription checkout');
    const subscriptionId = idOf(s.subscription);
    if (subscriptionId === null) return this.record(null, 'the checkout names no subscription');
    const customer = idOf(s.customer);
    const sub = await this.ctx.stripe.retrieveSubscription(subscriptionId);
    if (sub.status === 'incomplete') {
      throw new Error(`the subscription of stripe event ${this.event.id} is still incomplete`);
    }
    const mirror = await mirrorOf(sub, this.ctx.catalog);
    const own = { subscriptionId: sub.id, status: sub.status };
    const ours = !('refused' in mirror);

    const ref = s.client_reference_id;
    const named = (s.metadata as Payload | null | undefined)?.account_id;
    const account =
      typeof ref === 'string' && UUID.test(ref) && named === ref
        ? await this.ctx.db.accountById(ref)
        : null;
    if (account === null) {
      return this.record(null, 'no account for the checkout', {
        effects: ours ? orphanEffects(own, null, this.event.id) : [],
        reports: [
          {
            level: 'warning',
            message: 'billing.webhook.checkout_without_account',
            detail: { subscriptionId: sub.id, customerId: customer },
          },
        ],
      });
    }
    // The subscription the account already follows is never an orphan of a later completion for it.
    const followed = account.currentSubscriptionId === sub.id;
    if ('refused' in mirror) {
      // The checkout names the account in client_reference_id and metadata alike, as our route opens
      // it: the subscription is ours whatever the listing says now (a deploy that changed prices.ts
      // while the session was open), so it is cancelled rather than left charging for nothing.
      return this.record(account.id, mirror.refused, {
        effects: followed ? [] : orphanEffects(own, account.id, this.event.id),
        reports: [
          { ...priceReport('billing.webhook.foreign_price', mirror, sub.id), level: 'error' },
        ],
      });
    }
    const mismatch = async (): Promise<string | null> => {
      if (customer === null) return 'the checkout names no customer';
      if (account.stripeCustomerId !== null) {
        return account.stripeCustomerId === customer
          ? null
          : 'the checkout is for another customer';
      }
      const holder = await this.ctx.db.accountByCustomer(customer);
      return holder === null || holder === account.id
        ? null
        : 'the customer belongs to another account';
    };
    const refusal = await mismatch();
    if (refusal !== null) {
      return this.record(account.id, refusal, {
        effects: followed ? [] : orphanEffects(own, account.id, this.event.id),
        reports: [
          {
            level: 'error',
            message: 'billing.webhook.customer_mismatch',
            detail: { subscriptionId: sub.id, customerId: customer },
          },
        ],
      });
    }

    const write = this.write(
      account.id,
      { id: sub.id, gated: false, mirror: mirror.row },
      account.stripeCustomerId === null ? customer : null,
    );
    const event: EntitlementEvent =
      sub.status === 'trialing' && mirror.plan === 'agency' && sub.trial_end !== null
        ? {
            type: 'agency_trial_started',
            at: this.at,
            trialEnd: new Date(sub.trial_end * 1000),
            subscriptionId: sub.id,
            subscriptionStatus: sub.status,
          }
        : {
            type: 'checkout_completed',
            at: this.at,
            plan: mirror.plan,
            subscriptionId: sub.id,
            subscriptionStatus: sub.status,
            extras: mirror.extras,
          };
    return this.apply(account.id, event, write, { checkout: own });
  }

  /**
   * The mirror row of a subscription whose prices are not ours: Stripe's fields and the plan the
   * stored row holds. Null when no row mirrors it for this account: a grant writes the mirror of
   * the subscription it makes the account follow, so such a subscription is not the one followed.
   */
  private async storedRow(sub: Stripe.Subscription, accountId: string): Promise<MirrorRow | null> {
    const stored = await this.ctx.db.subscriptionById(sub.id);
    return stored === null || stored.accountId !== accountId ? null : keptMirror(sub, stored);
  }

  /**
   * What a revoke writes: the allow-list's row when the prices are ours, the stored row's with a
   * warning otherwise, or a recorded refusal when there is none to take the plan from.
   */
  private async revokeMirror(
    sub: Stripe.Subscription,
    accountId: string,
    mirror: MirrorResult,
  ): Promise<{ row: MirrorRow; reports: Report[] } | Decision> {
    if (!('refused' in mirror)) return { row: mirror.row, reports: [] };
    const row = await this.storedRow(sub, accountId);
    if (row === null) {
      return this.record(accountId, mirror.refused, {
        reports: [priceReport('billing.webhook.foreign_price', mirror, sub.id)],
      });
    }
    return {
      row,
      reports: [priceReport('billing.webhook.foreign_price_on_revoke', mirror, sub.id)],
    };
  }

  private async subscription(
    type:
      | 'customer.subscription.created'
      | 'customer.subscription.updated'
      | 'customer.subscription.deleted'
      | 'customer.subscription.trial_will_end',
  ): Promise<Decision> {
    const found = await this.accountOfCustomer(idOf(this.payload.customer));
    if (typeof found !== 'string') return found;
    const accountId = found;
    const subscriptionId = idOf(this.payload.id);
    if (subscriptionId === null) return this.record(accountId, 'the event names no subscription');
    const sub = await this.ctx.stripe.retrieveSubscription(subscriptionId);
    const gated = type !== 'customer.subscription.trial_will_end';
    const at = (row: MirrorRow | null) => this.write(accountId, { id: sub.id, gated, mirror: row });
    const mirror = await mirrorOf(sub, this.ctx.catalog);

    if (type === 'customer.subscription.created') {
      const ours = !('refused' in mirror);
      return this.record(accountId, `${type} is recorded, not applied`, {
        write: at(ours ? mirror.row : await this.storedRow(sub, accountId)),
        reports: ours ? [] : [priceReport('billing.webhook.foreign_price', mirror, sub.id)],
      });
    }

    if (type === 'customer.subscription.updated') {
      if (this.payload.status !== sub.status) {
        return this.record(accountId, 'superseded', { write: at(null) });
      }
      if (sub.status === 'active') {
        if ('refused' in mirror) {
          return this.record(accountId, mirror.refused, {
            reports: [priceReport('billing.webhook.foreign_price', mirror, sub.id)],
          });
        }
        return this.apply(
          accountId,
          {
            type: 'subscription_updated',
            at: this.at,
            subscriptionId: sub.id,
            status: sub.status,
            plan: mirror.plan,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            extras: mirror.extras,
          },
          at(mirror.row),
        );
      }
    }

    const kept = await this.revokeMirror(sub, accountId, mirror);
    if ('kind' in kept) return kept;
    const event: EntitlementEvent =
      type === 'customer.subscription.updated'
        ? {
            type: 'subscription_updated',
            at: this.at,
            subscriptionId: sub.id,
            status: sub.status,
            plan: kept.row.plan,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            extras: { seats: kept.row.seat_quantity, sites: kept.row.extra_site_quantity },
          }
        : type === 'customer.subscription.deleted'
          ? { type: 'subscription_deleted', at: this.at, subscriptionId: sub.id }
          : { type: 'trial_will_end', at: this.at, subscriptionId: sub.id };
    return this.apply(accountId, event, at(kept.row), { reports: kept.reports });
  }

  /** The invoice's subscription: `parent.subscription_details` (dahlia), or the older top-level field. */
  private invoiceSubscription(): string | null {
    const parent = this.payload.parent as Payload | null | undefined;
    const details = parent?.subscription_details as Payload | null | undefined;
    return idOf(details?.subscription) ?? idOf(this.payload.subscription);
  }

  private async paymentFailed(): Promise<Decision> {
    const subscriptionId = this.invoiceSubscription();
    const customer = idOf(this.payload.customer);
    if (subscriptionId === null) {
      const accountId = customer === null ? null : await this.ctx.db.accountByCustomer(customer);
      return this.record(accountId, 'the invoice names no subscription');
    }
    const found = await this.accountOfCustomer(customer);
    if (typeof found !== 'string') return found;
    const accountId = found;
    const sub = await this.ctx.stripe.retrieveSubscription(subscriptionId);
    if (sub.status !== 'past_due' && sub.status !== 'unpaid') {
      return this.record(accountId, 'superseded', {
        write: this.write(accountId, { id: sub.id, gated: true, mirror: null }),
      });
    }
    const kept = await this.revokeMirror(sub, accountId, await mirrorOf(sub, this.ctx.catalog));
    if ('kind' in kept) return kept;
    return this.apply(
      accountId,
      { type: 'invoice_payment_failed', at: this.at, subscriptionId: sub.id },
      this.write(accountId, { id: sub.id, gated: true, mirror: kept.row }),
      { reports: kept.reports },
    );
  }

  private async dispute(): Promise<Decision> {
    const alert = (accountId: string | null): PlannedEffect => ({
      kind: 'alert',
      reason: 'dispute',
      accountId,
      subscriptionId: null,
      source: this.event.id,
    });
    const chargeId = idOf(this.payload.charge);
    const charge = chargeId === null ? null : await this.ctx.stripe.retrieveCharge(chargeId);
    const customer = charge === null ? null : idOf(charge.customer);
    const accountId = customer === null ? null : await this.ctx.db.accountByCustomer(customer);
    if (accountId === null) {
      return this.record(null, 'no account for the disputed charge', {
        effects: [alert(null)],
        reports: [
          {
            level: 'error',
            message: 'billing.webhook.dispute_without_account',
            detail: { chargeId, customerId: customer },
          },
        ],
      });
    }
    return this.apply(accountId, { type: 'dispute_created', at: this.at }, this.write(accountId));
  }
}

export function normalise(event: Stripe.Event, ctx: NormaliseContext): Promise<Decision> {
  return new Normaliser(event, ctx).decide();
}
