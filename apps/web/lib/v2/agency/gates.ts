/**
 * What a reader is told at a limit (CC-31 D10): the limit they reached and the plan that lifts it.
 * Every number here is read from `GATES` or `prices.ts`; this file writes none
 * (`gates.test.ts` reads its source for a digit).
 */
import { AGENCY_MONTHLY, PRO_MONTHLY, usd } from '../../billing/prices';
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
