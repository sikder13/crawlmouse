/**
 * Why an account may not buy a plan now (CC-03 D6), apart from the checkout itself so a page can ask
 * the same question without importing Stripe: CC-03's checkout route and Pricing's buttons both call
 * this.
 */
import type { PaidTier } from '../entitlement-v2';
import type { BillingRefusal } from './checkout-v2';
import type { EntitlementSnapshot } from './state-machine';

const RANK: Readonly<Record<PaidTier, number>> = { pro: 1, agency: 2 };

/** Why the account may not buy `plan` now, or null when it may. */
export function checkoutRefusal(s: EntitlementSnapshot, plan: PaidTier): BillingRefusal | null {
  if ((s.state === 'pro' || s.state === 'agency') && RANK[s.state] >= RANK[plan]) {
    return { ok: false, status: 409, error: 'plan_held' };
  }
  if (s.subscriptionId !== null) {
    return { ok: false, status: 409, error: 'subscription_open', detail: { next: 'portal' } };
  }
  return null;
}
