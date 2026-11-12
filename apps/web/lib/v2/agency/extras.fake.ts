/**
 * A Stripe subscription in memory for the tests of `changeExtras`: `update` applies an items change
 * as Stripe does (an item named by id is set or deleted, one named by price is added), answers a
 * repeated idempotency key with what it answered first and changes nothing, and declines a change
 * sent with `error_if_incomplete` when told to. Test-only.
 */
import type Stripe from 'stripe';
import type { ExtrasStripe } from './extras';

export interface FakeUpdate {
  id: string;
  params: Stripe.SubscriptionUpdateParams;
  idempotencyKey: string;
}

export interface FakeExtrasStripe extends ExtrasStripe {
  /** The subscription as it stands. */
  current(): Stripe.Subscription;
  retrieved: string[];
  updates: FakeUpdate[];
}

export function fakeExtrasStripe(
  start: Stripe.Subscription,
  opts: { declines?: boolean } = {},
): FakeExtrasStripe {
  let sub = start;
  let n = 0;
  const answered = new Map<string, Stripe.Subscription>();
  const retrieved: string[] = [];
  const updates: FakeUpdate[] = [];
  return {
    current: () => sub,
    retrieved,
    updates,
    subscriptions: {
      async retrieve(id) {
        retrieved.push(id);
        return sub;
      },
      async update(id, params, { idempotencyKey }) {
        updates.push({ id, params, idempotencyKey });
        const replay = answered.get(idempotencyKey);
        if (replay) return replay;
        if (opts.declines && params.payment_behavior === 'error_if_incomplete') {
          throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' });
        }
        const periodEnd = sub.items.data[0]!.current_period_end;
        let data = [...sub.items.data];
        for (const change of params.items ?? []) {
          if (change.id === undefined) {
            data.push({
              id: `si_added_${++n}`,
              price: { id: change.price },
              quantity: change.quantity,
              current_period_end: periodEnd,
            } as unknown as Stripe.SubscriptionItem);
          } else if (change.deleted) {
            data = data.filter((i) => i.id !== change.id);
          } else {
            data = data.map((i) =>
              i.id === change.id ? ({ ...i, quantity: change.quantity } as typeof i) : i,
            );
          }
        }
        sub = {
          ...sub,
          items: { ...sub.items, data },
          // A change invoiced at once leaves a new latest invoice.
          latest_invoice:
            params.proration_behavior === 'always_invoice' ? `in_fake_${++n}` : sub.latest_invoice,
        } as Stripe.Subscription;
        answered.set(idempotencyKey, sub);
        return sub;
      },
    },
  };
}
