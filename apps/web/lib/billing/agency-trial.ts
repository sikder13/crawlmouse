/**
 * The Agency trial with a card (CC-03 D7): a Checkout Session on the Agency base price with a
 * 14-day trial, the card taken now and the plan charged when the trial ends unless it is cancelled;
 * with no card on file at the end, Stripe cancels it.
 *
 * The request names the account (spec 03, Q15): ARCH-2 §2.4 makes an agency trial a second account,
 * which CC-29 creates. It is refused up front with `trialRefusal`'s reason, the same check the
 * webhook's `agency_trial_started` makes, on the account as this request reads it.
 */
import { z } from 'zod';
import type { Interval } from './catalog';
import { startCheckout, type BillingResult, type Buyer, type CheckoutDeps } from './checkout-v2';
import type { RequestBody } from './request-body';
import { TRIAL_DAYS, trialRefusal } from './state-machine';

const AgencyTrialBody = z.strictObject({
  interval: z.enum(['month', 'year']),
  accountId: z.uuid(),
});

export type AgencyTrialInput = z.infer<typeof AgencyTrialBody>;

/** An agency trial body: the interval and the account, both required; null for anything else. */
export function parseAgencyTrial(body: RequestBody): AgencyTrialInput | null {
  const parsed = AgencyTrialBody.safeParse(body.fields);
  return parsed.success ? parsed.data : null;
}

export async function agencyTrial(
  deps: CheckoutDeps,
  input: Buyer & { interval: Interval },
): Promise<BillingResult> {
  const account = await deps.accounts.read(input.accountId);
  if (account === null) throw new Error(`account ${input.accountId} not found`);
  const reason = trialRefusal(account.snapshot, deps.now());
  if (reason !== null)
    return { ok: false, status: 409, error: 'trial_refused', detail: { reason } };
  return startCheckout(deps, input, account, {
    plan: 'agency',
    interval: input.interval,
    cancelPath: '/agency-trial',
    trialDays: TRIAL_DAYS,
  });
}
