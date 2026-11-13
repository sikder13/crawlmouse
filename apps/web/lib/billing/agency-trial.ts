/**
 * The Agency trial with a card (CC-03 D7): a Checkout Session on the Agency base price with a
 * 14-day trial, the card taken now and the plan charged when the trial ends unless it is cancelled;
 * with no card on file at the end, Stripe cancels it.
 *
 * The request names the account (spec 03, Q15): ARCH-2 §2.4 makes an agency trial a second account,
 * which CC-29 creates. It is refused up front with `trialRefusal`'s reason, the same check the
 * webhook's `agency_trial_started` makes, on the account as this request reads it.
 */
import type { Interval } from './catalog';
import { startCheckout, type BillingResult, type Buyer, type CheckoutDeps } from './checkout-v2';
import { TRIAL_DAYS, trialRefusal } from './state-machine';

/** Where the Agency trial's Checkout lands: the agency's workspace. */
export const AGENCY_HOME = '/agency';

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
    // The trial's account is a second one (CC-29), and Settings shows the account the person acts
    // in, which is still their personal one. `/agency` is the workspace: it offers "Open <agency>",
    // the switch, to a person who holds a seat on an agency and is acting elsewhere (CC-31 Q8).
    successPath: AGENCY_HOME,
    trialDays: TRIAL_DAYS,
  });
}
