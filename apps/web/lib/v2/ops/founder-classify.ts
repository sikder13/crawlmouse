/**
 * Which entitlement changes the founder is told of at once (CC-33 D3), from `entitlement.changed`'s
 * `from` and `to`:
 *
 *   free → pro_trial, free → agency_trial             trial started (Pro, Agency)
 *   free, pro_trial or agency_trial → pro or agency   payment
 *   past_due → pro or agency                          payment, `recovery`: a failed charge settled.
 *                                                     founder.ts sends it when it is the first
 *                                                     payment (a trial whose first charge failed),
 *                                                     and not otherwise
 *   any other state → past_due                        payment failed (the plan of the state left)
 *
 * Any other change answers null and has no instant notice. Whether a payment is the customer's first
 * is Stripe's record (`paymentLabel`, review C2), not the account's state history: a trial whose
 * conversion charge failed reaches a paid state from past_due without ever having paid.
 */
import type { AccountState } from '@crawlmouse/types/v2';

export type Plan = 'pro' | 'agency';

export type FounderEntitlement =
  | { kind: 'trial_started'; plan: Plan }
  | { kind: 'payment'; plan: Plan; recovery: boolean }
  | { kind: 'payment_failed'; plan: Plan | null };

/**
 * What Stripe says of a payment (lib/v2/ops/functions.ts `stripePayment`): the subscription's latest
 * invoice, and whether the customer has an earlier paid invoice with an amount above 0.
 */
export interface PaymentRecord {
  invoice: {
    /** Stripe's status, as given; null when Stripe gives none. */
    status: string | null;
    amountPaid: number;
    amountDue: number;
    currency: string;
  } | null;
  /** `unknown`: Stripe's listing was cut before an earlier payment was found. */
  earlier: 'none' | 'some' | 'unknown';
}

const PLAN_OF: Partial<Record<AccountState, Plan>> = {
  pro_trial: 'pro',
  pro: 'pro',
  agency_trial: 'agency',
  agency: 'agency',
};
const UNPAID = new Set<AccountState>(['free', 'pro_trial', 'agency_trial']);

export function classifyEntitlement(
  from: AccountState,
  to: AccountState,
): FounderEntitlement | null {
  if (from === 'free' && (to === 'pro_trial' || to === 'agency_trial')) {
    return { kind: 'trial_started', plan: PLAN_OF[to]! };
  }
  if ((UNPAID.has(from) || from === 'past_due') && (to === 'pro' || to === 'agency')) {
    return { kind: 'payment', plan: to, recovery: from === 'past_due' };
  }
  if (to === 'past_due' && from !== 'past_due') {
    return { kind: 'payment_failed', plan: PLAN_OF[from] ?? null };
  }
  return null;
}

/** `first` with no earlier paid invoice, `returning` with one, `unknown` when Stripe did not say. */
export function paymentLabel(record: PaymentRecord | null): 'first' | 'returning' | 'unknown' {
  if (record === null || record.earlier === 'unknown') return 'unknown';
  return record.earlier === 'none' ? 'first' : 'returning';
}
