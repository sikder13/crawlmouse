/**
 * The product events of Pricing and the Agency trial (CC-29 D10), through the product's one server
 * sender, `captureServerEvent`, which reads the visitor's consent from the request's cookie header
 * (`serverCaptureAllowed`) and drops a send that fails.
 *
 * - `pricing_viewed {interval, signedIn}`: at the page's per-request render.
 * - `plan_chosen {plan, interval}`: where a plan's flow starts on the server. Only the Agency trial
 *   has a server step of its own (POST /api/agency-trial); Free and Pro start on Sign-up's page, on
 *   CC-26b's trial route or on CC-03's checkout route, none of which this step changes.
 * - `trial_started {kind: 'agency', variant: 'card_required', stage: 'checkout_opened'}`: when the
 *   Agency trial's Checkout is opened. The trial itself starts at the webhook (CC-03).
 *
 * The distinct id is `account:<id>`; a signed-out view, which has no account, gets a random id of
 * its own, so no two views are joined. No property holds an address, a host or a name.
 */
import { randomUUID } from 'node:crypto';
import type { FunnelEvent } from '../../analytics-events';
import { captureServerEvent } from '../../analytics-server';
import type { Interval } from '../../billing/catalog';
import type { PaidTier } from '../../entitlement-v2';

export interface PricingEvents {
  pricing_viewed: { interval: Interval; signedIn: boolean };
  plan_chosen: { plan: PaidTier; interval: Interval };
  trial_started: { kind: 'agency'; variant: 'card_required'; stage: 'checkout_opened' };
}

export type PricingEventName = keyof PricingEvents & FunnelEvent;

export type CapturePricingEvent = <E extends PricingEventName>(
  event: E,
  accountId: string | null,
  properties: PricingEvents[E],
) => Promise<void>;

/** The capture for one request, given its `Cookie` header. */
export function pricingCapture(
  cookieHeader: string | null,
  capture: typeof captureServerEvent = captureServerEvent,
): CapturePricingEvent {
  return (event, accountId, properties) =>
    capture(cookieHeader, {
      event,
      distinctId: accountId === null ? `anon:${randomUUID()}` : `account:${accountId}`,
      properties,
    });
}
