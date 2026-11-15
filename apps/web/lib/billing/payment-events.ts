/**
 * The payment events the v2 webhook sends PostHog (CC-41 D3), planned from one decided Stripe event:
 * the entitlement event it became, the snapshot it was decided on, the transition, the subscription
 * mirror the decision writes, and the Stripe event itself. Amounts, currency, `attempt_count` and
 * `cancel_at_period_end` are read from the Stripe event, never from prices.ts; the interval and the
 * subscription's plan from that mirror row.
 *
 * - `subscription_started` — an applied checkout (`trial: false`), or an applied Agency or
 *   card-required trial start (`trial: true`).
 * - `trial_converted` — the transition carries the machine's `trial.converted`.
 * - `plan_changed` — an applied `subscription_updated` that moves between the two paid tiers.
 * - `subscription_canceled` — an update to the followed subscription that turns
 *   `cancel_at_period_end` from false to true (`at_period_end: true`), or an applied deletion whose
 *   subscription had no end-of-period cancellation set (`at_period_end: false`).
 * - `subscription_ended` — an applied deletion.
 * - `payment_failed` — a payment failure on the followed subscription; `attempt` is the invoice's
 *   `attempt_count`.
 *
 * Each capture's `uuid` is a UUIDv5 of `<stripe event id>:<event name>` under CAPTURE_NAMESPACE, and
 * its `timestamp` is the Stripe event's `created`, so a plan built twice for one Stripe event builds
 * the same bodies. Our ledger is what stops a second send: a processed Stripe event sends nothing.
 */
import { createHash } from 'node:crypto';
import type Stripe from 'stripe';
import { PlannedEffectSchema, type PlannedCapture } from './effects';
import type { EntitlementEvent, EntitlementSnapshot, Transition } from './state-machine';
import type { MirrorRow } from './subscription-mirror';

/** The namespace every capture uuid is made under. Changing it changes every capture's id. */
export const CAPTURE_NAMESPACE = 'a4bda8a7-2118-43f0-925a-f29e7e0415b9';

/** A name-based UUID, version 5 (RFC 9562 §5.5): SHA-1 of the namespace's bytes and the name. */
export function uuidV5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new RangeError(`not a UUID: ${namespace}`);
  const b = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function captureUuid(stripeEventId: string, event: PlannedCapture['event']): string {
  return uuidV5(CAPTURE_NAMESPACE, `${stripeEventId}:${event}`);
}

/** A capture before it is keyed to a person: the name and properties, paired. */
export type PaymentEvent = PlannedCapture extends infer C
  ? C extends PlannedCapture
    ? Pick<C, 'event' | 'properties'>
    : never
  : never;

export interface PaymentEventInput {
  stripe: Stripe.Event;
  event: EntitlementEvent;
  before: EntitlementSnapshot;
  transition: Transition;
  /** The subscription row the decision writes; null when it writes none. */
  mirror: MirrorRow | null;
}

type Payload = Record<string, unknown>;

/** A count or an amount in the smallest unit, or null for anything else. */
const whole = (v: unknown): number | null =>
  Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
const currency = (v: unknown): string | null =>
  typeof v === 'string' && /^[a-z]{3}$/.test(v) ? v : null;

export function paymentEvents(i: PaymentEventInput): PaymentEvent[] {
  const { event: e, before, transition, mirror } = i;
  const after = transition.state;
  const applied = transition.outcome === 'applied';
  const object = i.stripe.data.object as unknown as Payload;
  const followed = 'subscriptionId' in e && e.subscriptionId === before.subscriptionId;
  const out: PaymentEvent[] = [];

  const started =
    e.type === 'checkout_completed' ||
    e.type === 'agency_trial_started' ||
    (e.type === 'trial_started' && e.variant === 'card_required');
  if (applied && started && after.tier !== 'free' && mirror !== null) {
    const session = i.stripe.type === 'checkout.session.completed' ? object : null;
    out.push({
      event: 'subscription_started',
      properties: {
        plan: after.tier,
        interval: mirror.interval,
        trial: e.type !== 'checkout_completed',
        amount_cents: whole(session?.amount_total),
        currency: currency(session?.currency),
      },
    });
  }

  const converted = transition.effects.some(
    (x) => x.kind === 'event' && x.name === 'trial.converted',
  );
  if (converted && after.tier !== 'free') {
    out.push({ event: 'trial_converted', properties: { plan: after.tier } });
  }

  // An ignored transition keeps the snapshot, so a tier that moved was applied.
  if (
    e.type === 'subscription_updated' &&
    before.tier !== after.tier &&
    before.tier !== 'free' &&
    after.tier !== 'free'
  ) {
    out.push({ event: 'plan_changed', properties: { from: before.tier, to: after.tier } });
  }

  if (mirror === null) return out;
  const plan = mirror.plan;

  const previous = i.stripe.data.previous_attributes as Payload | undefined;
  if (
    e.type === 'subscription_updated' &&
    followed &&
    previous?.cancel_at_period_end === false &&
    object.cancel_at_period_end === true
  ) {
    out.push({ event: 'subscription_canceled', properties: { plan, at_period_end: true } });
  }

  if (applied && e.type === 'subscription_deleted') {
    if (object.cancel_at_period_end !== true) {
      out.push({ event: 'subscription_canceled', properties: { plan, at_period_end: false } });
    }
    out.push({ event: 'subscription_ended', properties: { plan } });
  }

  if (e.type === 'invoice_payment_failed' && followed) {
    out.push({
      event: 'payment_failed',
      properties: { plan, attempt: whole(object.attempt_count) },
    });
  }
  return out;
}

export interface CaptureKey {
  stripe: Stripe.Event;
  /** The account owner's `users.id`. */
  distinctId: string;
  accountId: string;
}

/** The planned captures of `events`, each keyed to the owner and fixed by the Stripe event. */
export function plannedCaptures(
  events: readonly PaymentEvent[],
  key: CaptureKey,
): PlannedCapture[] {
  const timestamp = new Date(key.stripe.created * 1000).toISOString();
  return events.map(
    (p) =>
      PlannedEffectSchema.parse({
        kind: 'capture',
        uuid: captureUuid(key.stripe.id, p.event),
        event: p.event,
        distinctId: key.distinctId,
        accountId: key.accountId,
        timestamp,
        properties: p.properties,
      }) as PlannedCapture,
  );
}
