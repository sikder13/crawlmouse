/**
 * The product events CC-27b sends (D9), through the product's one server sender. The distinct id is
 * the person's `users.id` for their own action, and `account:<id>` for the purge, which no person
 * runs (CC-41 D1, `distinctIdFor`); the account is `account_id`. No property holds an address, a host
 * or a token. A request's consent cookies decide
 * whether a route's event is sent (`captureServerEvent` reads them); the purge has no request and
 * sends with no cookie header, so with no person profile and keyed by the account only.
 */
import type { FunnelEvent } from '../../analytics-events';
import { captureServerEvent, distinctIdFor, type EventKey } from '../../analytics-server';
import type { Tier } from '../../entitlement-v2';

export interface AccountEvents {
  account_email_changed: { tier: Tier };
  account_deletion_requested: { tier: Tier };
  account_deletion_confirmed: { tier: Tier; accounts: number };
  account_restored: { tier: Tier };
  /** Rows the erasure deleted or changed, by `table.action`. */
  account_purged: { counts: Record<string, number> };
}

export type AccountEventName = keyof AccountEvents & FunnelEvent;

export type CaptureAccountEvent = <E extends AccountEventName>(
  event: E,
  key: EventKey,
  properties: AccountEvents[E],
) => Promise<void>;

/** The capture for one request (its `Cookie` header), or for the purge (`null`). */
export function accountCapture(
  cookieHeader: string | null,
  capture: typeof captureServerEvent = captureServerEvent,
): CaptureAccountEvent {
  return (event, key, properties) =>
    capture(cookieHeader, {
      event,
      distinctId: distinctIdFor(cookieHeader, key),
      accountId: key.accountId,
      properties,
    });
}
