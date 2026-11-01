/**
 * v2 entitlement: what each tier may do, and which tier an account is on right now.
 *
 * This module sits beside v1's `entitlement.ts` and `pro.ts` and is not imported by any live route.
 * A later step switches the routes over behind a flag (see docs/specs/v2/01-accounts.md, follow-ups).
 *
 * Sources: ARCH-2 §3.1 for every gate except `checksPerSiteDay`, which is DECISION-LOG J9.
 */
import type { AccountState } from '@crawlmouse/types/v2';

export type Tier = 'free' | 'pro' | 'agency';
export type PaidTier = Exclude<Tier, 'free'>;

/**
 * Pages read per check on Pro and Agency. Pending re-measurement against the cost model at the load
 * test (CC-39): at the measured 2 requests a second a 2,000-page crawl does not fit the 20-minute
 * check budget (ENGINE-GAP §8.2 proposed 800 on cost grounds).
 */
export const PAID_PAGES_PER_CHECK = 2000;
export const FREE_PAGES_PER_CHECK = 500;

/** How long a `past_due` account keeps its paid tier, from `past_due_since` (DECISION-LOG J3). */
export const PAST_DUE_GRACE_DAYS = 7;

const AGENCY_EXTRA_SITES_MAX = 25;

export interface TierGates {
  /** Primary sites included in the plan. */
  sites: number;
  /** Primary sites with every paid extra (Agency sells sites 26-50). */
  maxSites: number;
  /** Seats included in the plan. Agency adds paid extra seats on top. */
  seats: number;
  schedule: 'monthly_first_site_only' | 'weekly';
  /** Free sees the three largest open fixes of the latest check. */
  fixesVisible: 3 | 'all';
  /** Free gets a 402 for the packet of a fix it cannot see. */
  packets: 'visible_fixes_only' | 'all';
  competitorsPerSite: number;
  /** PDF, CSV and JSON exports. */
  exports: boolean;
  slack: boolean;
  stagingAndDeployHooks: boolean;
  /** Brand, sender domain, client report page and scheduled client reports. */
  agencyBranding: boolean;
  pagesPerCheck: number;
  fullRendersPerMonth: number;
  /** The read-only `cm_ro_` API. */
  readOnlyApi: boolean;
  searchConsole: boolean;
  observedCrawlerActivity: boolean;
  /**
   * Checks a day per site at this tier. DECISION-LOG J9 enforces it per eTLD+1 across every account
   * in the pipeline's `claim` step, so it is a crawl cap rather than a per-account allowance.
   */
  checksPerSiteDay: number;
}

const PAID: Omit<TierGates, 'sites' | 'maxSites' | 'seats' | 'competitorsPerSite' | 'fullRendersPerMonth' | 'agencyBranding'> = {
  schedule: 'weekly',
  fixesVisible: 'all',
  packets: 'all',
  exports: true,
  slack: true,
  stagingAndDeployHooks: true,
  pagesPerCheck: PAID_PAGES_PER_CHECK,
  readOnlyApi: true,
  searchConsole: true,
  observedCrawlerActivity: true,
  checksPerSiteDay: 12,
};

export const GATES: Readonly<Record<Tier, Readonly<TierGates>>> = Object.freeze({
  free: Object.freeze({
    sites: 1,
    maxSites: 1,
    seats: 1,
    schedule: 'monthly_first_site_only',
    fixesVisible: 3,
    packets: 'visible_fixes_only',
    competitorsPerSite: 0,
    exports: false,
    slack: false,
    stagingAndDeployHooks: false,
    agencyBranding: false,
    pagesPerCheck: FREE_PAGES_PER_CHECK,
    fullRendersPerMonth: 0,
    readOnlyApi: false,
    searchConsole: false,
    observedCrawlerActivity: false,
    checksPerSiteDay: 3,
  }),
  pro: Object.freeze({
    ...PAID,
    sites: 5,
    maxSites: 5,
    seats: 2,
    competitorsPerSite: 1,
    fullRendersPerMonth: 10,
    agencyBranding: false,
  }),
  agency: Object.freeze({
    ...PAID,
    sites: 25,
    maxSites: 25 + AGENCY_EXTRA_SITES_MAX,
    seats: 5,
    competitorsPerSite: 3,
    fullRendersPerMonth: 30,
    agencyBranding: true,
  }),
});

/** Paid extras on an Agency subscription: the $12 seat item and the $3 site item. */
export interface Extras {
  seats: number;
  sites: number;
}

export const NO_EXTRAS: Readonly<Extras> = Object.freeze({ seats: 0, sites: 0 });

export interface AccountLimits {
  seats: number;
  sites: number;
  competitorsPerSite: number;
}

/** The limits written to `accounts.seat_limit`, `site_limit` and `competitor_limit`. */
export function limitsFor(tier: Tier, extras: Extras): AccountLimits {
  for (const [name, value] of Object.entries(extras)) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`extra ${name} must be a whole number ≥ 0`);
  }
  if (tier !== 'agency' && (extras.seats !== 0 || extras.sites !== 0)) {
    throw new RangeError(`the ${tier} plan sells no extra seats or sites`);
  }
  if (extras.sites > AGENCY_EXTRA_SITES_MAX) {
    throw new RangeError(`at most ${AGENCY_EXTRA_SITES_MAX} extra sites`);
  }
  const g = GATES[tier];
  return { seats: g.seats + extras.seats, sites: g.sites + extras.sites, competitorsPerSite: g.competitorsPerSite };
}

/** The contract's `Account.limits` for a tier and its extras. */
export function contractLimits(tier: Tier, extras: Extras) {
  const limits = limitsFor(tier, extras);
  return {
    sites: limits.sites,
    seats: limits.seats,
    pages_per_audit: GATES[tier].pagesPerCheck,
    competitors_per_site: limits.competitorsPerSite,
    full_renders_per_month: GATES[tier].fullRendersPerMonth,
  };
}

/** The account fields the tier clock reads. */
export interface EntitlementClock {
  state: AccountState;
  tier: Tier;
  pastDueTier: PaidTier | null;
  pastDueSince: Date | null;
}

const DAY_MS = 86_400_000;

/**
 * The tier an account is on at `now`. It is the `tier` column, except that a `past_due` account
 * keeps `past_due_tier` for 7 days from `past_due_since` and is Free from then on, whether or not
 * the sweep that writes the lapse has run yet.
 */
export function effectiveTier(account: EntitlementClock, now: Date): Tier {
  if (account.state !== 'past_due') return account.tier;
  if (account.pastDueTier === null || account.pastDueSince === null) {
    throw new Error('a past_due account must carry past_due_tier and past_due_since');
  }
  const graceEnds = account.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS;
  return now.getTime() < graceEnds ? account.pastDueTier : 'free';
}

export function gatesFor(account: EntitlementClock, now: Date): Readonly<TierGates> {
  return GATES[effectiveTier(account, now)];
}
