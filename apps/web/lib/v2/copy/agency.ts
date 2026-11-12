/**
 * The agency workspace's written sentences (CC-31): the parts no record holds, every number a
 * parameter, so the view models fill them from the data, `GATES` and `prices.ts`
 * (OPERATING-RULES §10). The lock corrections for the agency artboards follow.
 */
import { count, plural } from '../words';

/** The agency rail's plan card and the account switcher (the switcher is outside the artboards). */
export const AGENCY_RAIL_COPY = {
  /** "Agency · $99 a month": the price is prices.ts's, already formatted. */
  planPrice: (plan: string, price: string, period: 'month' | 'year') =>
    `${plan} · ${price} a ${period}`,
  planKeeps: (sites: number, seats: number) =>
    `${count(sites)} client ${plural(sites, 'site', 'sites')} · ${count(seats)} ${plural(seats, 'seat', 'seats')}`,
  renews: (date: string, last4: string) => `Renews ${date}. Card ending ${last4}.`,
  /** Read before the account's name by a screen reader. */
  acting: 'Account',
  switchTo: 'Switch to',
  switchToAccount: (name: string) => `Switch to ${name}`,
  /** On a page of an account the reader is not acting in. */
  actingIn: (name: string) => `You are acting in ${name}.`,
};
