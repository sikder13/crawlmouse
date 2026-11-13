import type { Account } from '@crawlmouse/types/v2';

/**
 * The most extra seats one request may ask for. A raise is charged at once, so a mistyped quantity
 * is money taken; no plan fact bounds seats as `GATES.agency.maxSites` bounds sites. Apart from
 * extras.ts, which reaches the Stripe client's module, so that the Seats view can read it.
 */
export const MAX_EXTRA_SEATS = 100;

/**
 * Whether an account's state is one in which seats and sites beyond the plan's are sold: on Agency,
 * and in a state whose subscription `changeExtras` changes. It changes one whose status is `active`
 * (`CHANGEABLE`, extras.ts); an account in its Agency trial holds one that is trialing, and a
 * past-due account one whose last payment failed, and each is refused there. `POST /api/seats` asks
 * this of the state, which is what its viewer holds.
 */
export const extrasSold = (state: Account['state'], agencyGates: boolean): boolean =>
  agencyGates && state !== 'agency_trial' && state !== 'past_due';

/**
 * Whether a screen offers the account the way to buy them: `extrasSold`, on a plan the reader's
 * records say renews. `renews_at` is null there for an account with no subscription and for one
 * whose subscription is set to end (`accountFromRow`, lib/v2/account/rows.ts), and `changeExtras`
 * refuses both (409 `no_subscription`, `subscription_ending`). It is also null for a subscription
 * row that holds no period end, which the route does not ask about: there the screen offers
 * nothing, though the route might take the change.
 */
export const extrasOffered = (
  account: Pick<Account, 'state' | 'renews_at'>,
  agencyGates: boolean,
): boolean => extrasSold(account.state, agencyGates) && account.renews_at !== null;
