/**
 * The v2 Stripe webhook's contract (CC-03 D2, D4, D5): what `applyStripeEvent(event, deps)`
 * (./stripe-webhook.ts) is given and what it answers. Shared by the route, the handler and the
 * sandbox smoke, which runs the handler against PGlite.
 */
import type Stripe from 'stripe';
import type { Catalog } from './catalog';
import type { EffectSinks } from './effects';

/** The Stripe reads the handler makes at processing time (D5): the objects as they are now. */
export interface StripeReads {
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  retrieveCharge(id: string): Promise<Stripe.Charge>;
}

export type WebhookOutcome =
  /** `processed_at` was already set: nothing was done. */
  | { outcome: 'duplicate' }
  /** A decision was recorded but its effects were not confirmed sent: they were sent again. */
  | { outcome: 'resumed' }
  /** `event.livemode` is not the account's mode: recorded, and the route answers 400. */
  | { outcome: 'refused'; reason: 'livemode_mismatch' }
  /**
   * The event was decided: `applied` changed the account or sent an effect, `ignored` is the
   * machine's no, and `recorded` is a decision the webhook's own rules made: recorded-only types, a
   * price outside the allow-list, an unknown account, a superseded event, and an event the RPC's
   * guard refused after the machine had answered (older than the subscription's last event, or its
   * subscription had ended).
   */
  | {
      outcome: 'applied' | 'ignored' | 'recorded';
      accountId: string | null;
      reason: string | null;
    };

export interface WebhookDeps<Db> {
  db: Db;
  stripe: StripeReads;
  catalog: Catalog;
  sinks: EffectSinks;
  /** `expectedLivemode()`: whether this account's events must be live. */
  livemode: boolean;
}
