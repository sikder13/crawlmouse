/**
 * The most extra seats one request may ask for. A raise is charged at once, so a mistyped quantity
 * is money taken; no plan fact bounds seats as `GATES.agency.maxSites` bounds sites. Apart from
 * extras.ts, which reaches the Stripe client's module, so that the Seats view can read it.
 */
export const MAX_EXTRA_SEATS = 100;

/**
 * Whether the screens offer an account seats and sites beyond the plan's: on Agency, and in a state
 * whose subscription `changeExtras` changes. It changes one whose status is `active`
 * (`CHANGEABLE`, extras.ts); an account in its Agency trial holds one that is trialing, and a
 * past-due account one whose last payment failed, and each is refused there.
 */
export const extrasSold = (
  state: 'free' | 'pro_trial' | 'pro' | 'agency_trial' | 'agency' | 'past_due',
  agencyGates: boolean,
): boolean => agencyGates && state !== 'agency_trial' && state !== 'past_due';
