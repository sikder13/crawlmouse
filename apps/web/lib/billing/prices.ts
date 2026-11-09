/**
 * List prices in whole US dollars. A page that shows a price renders it from here.
 *
 * The Agency prices follow the project decision of 2026-11-03, which set the Agency list price at
 * $99 a month; the locked Sign-up artboard still says $69 (see docs/specs/v2/25-account-door.md).
 */
export const PRO_MONTHLY = 19;
export const PRO_YEARLY = 190;
export const AGENCY_MONTHLY = 99;
export const AGENCY_YEARLY = 990;
/** An Agency seat beyond the plan's five, a month. */
export const EXTRA_SEAT = 12;
/** An Agency site beyond the plan's 25, a month. */
export const EXTRA_SITE = 3;
/** The same two, a year: ten months' price, as the plans are. */
export const EXTRA_SEAT_YEARLY = 120;
export const EXTRA_SITE_YEARLY = 30;

/** "$19". Whole dollars only: a fractional price would need a format decision first. */
export function usd(dollars: number): string {
  if (!Number.isInteger(dollars) || dollars < 0) {
    throw new RangeError(`a price is a whole number of dollars ≥ 0, got ${dollars}`);
  }
  return `$${dollars}`;
}
