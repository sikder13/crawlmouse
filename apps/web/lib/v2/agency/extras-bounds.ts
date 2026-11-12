/**
 * The most extra seats one request may ask for. A raise is charged at once, so a mistyped quantity
 * is money taken; no plan fact bounds seats as `GATES.agency.maxSites` bounds sites. Apart from
 * extras.ts, which reaches the Stripe client's module, so that the Seats view can read it.
 */
export const MAX_EXTRA_SEATS = 100;
