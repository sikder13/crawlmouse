/**
 * What a reader is told at a limit (CC-31 D10): the limit they reached and the plan that lifts it.
 * Every number here is read from `GATES` or `prices.ts`; this file writes none
 * (`gates.test.ts` reads its source for a digit).
 */
import { AGENCY_MONTHLY, EXTRA_SITE, PRO_MONTHLY, usd } from '../../billing/prices';
import { GATES, type Tier } from '../../entitlement-v2';
import { count, plural } from '../words';

/** The limits a plan change lifts. */
export type UpgradeGate = 'sites' | 'seats' | 'fixes' | 'exports' | 'clientReports';

type PaidTier = Exclude<Tier, 'free'>;
type LowerTier = Exclude<Tier, 'agency'>;

const NEXT: Record<LowerTier, PaidTier> = { free: 'pro', pro: 'agency' };
const NAME: Record<Tier, string> = { free: 'Free', pro: 'Pro', agency: 'Agency' };
const MONTHLY: Record<PaidTier, number> = { pro: PRO_MONTHLY, agency: AGENCY_MONTHLY };

/** The plan that lifts `tier`'s limits, or null on Agency. */
export const nextTier = (tier: Tier): PaidTier | null => (tier === 'agency' ? null : NEXT[tier]);

const sites = (n: number) => `${count(n)} ${plural(n, 'site', 'sites')}`;
const seats = (n: number) => `${count(n)} ${plural(n, 'seat', 'seats')}`;

/**
 * What an account that keeps as many sites as its plan allows is told when it adds one more: the
 * sites gate below Agency, and on Agency what a site beyond the plan's costs.
 */
export function sitesFullMessage(tier: Tier): string {
  if (tier === 'agency') {
    return `${NAME.agency} keeps ${sites(GATES.agency.sites)}. A site beyond them is ${usd(EXTRA_SITE)} a month.`;
  }
  const to = NEXT[tier];
  return `${NAME[tier]} keeps ${sites(GATES[tier].sites)}. ${NAME[to]} keeps ${sites(GATES[to].sites)}: ${NAME[to]} is ${usd(MONTHLY[to])} a month.`;
}

/**
 * What an account below Agency is told on an Agency-only page (the client matrix, a client page):
 * what Agency keeps, and its price.
 */
export function agencyGateMessage(): string {
  const g = GATES.agency;
  return `Clients, their matrix and their pages are on ${NAME.agency}, which keeps ${sites(g.sites)} and ${seats(g.seats)}: ${NAME.agency} is ${usd(MONTHLY.agency)} a month.`;
}

/**
 * The line for `gate` on `tier`, or null when the next plan does not lift it (a Pro account sees
 * every fix and exports already; a Free account's next plan has no client reports).
 */
export function gateMessage(gate: UpgradeGate, tier: LowerTier): string | null {
  const to = NEXT[tier];
  const [from, next] = [GATES[tier], GATES[to]];
  const lifts = `${NAME[to]} is ${usd(MONTHLY[to])} a month.`;
  switch (gate) {
    case 'sites':
      return `${NAME[tier]} keeps ${sites(from.sites)}. ${NAME[to]} keeps ${sites(next.sites)}: ${lifts}`;
    case 'seats':
      return `${NAME[tier]} has ${seats(from.seats)}. ${NAME[to]} has ${seats(next.seats)}: ${lifts}`;
    case 'fixes':
      if (from.fixesVisible === 'all' || next.fixesVisible !== 'all') return null;
      return `${NAME[tier]} opens the ${count(from.fixesVisible)} largest fixes of a check. ${NAME[to]} opens every fix: ${lifts}`;
    case 'exports':
      if (from.exports || !next.exports) return null;
      return `Reports and exports are made on ${NAME[to]}. ${lifts}`;
    case 'clientReports':
      if (from.agencyBranding || !next.agencyBranding) return null;
      return `Reports sent to a client are made on ${NAME[to]}. ${lifts}`;
  }
}
