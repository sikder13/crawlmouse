/**
 * Who reads each account-screen preview, and when. The fixtures are the contract's and are not
 * edited (D2); where one has no account to read it as, the stand-in account is defined here, in
 * the open, and the spec lists it.
 */
import type { Account } from '@crawlmouse/types/v2';
import { NO_EXTRAS, contractLimits } from '../../../../lib/entitlement-v2';
import { fixture } from '../../../../lib/v2/fixtures';
import { firstRunNow, viewAt, type Viewer } from '../../../../lib/v2/view/account';
import { accountShellView } from '../../../../lib/v2/view/account-shell';
import { dashboardView } from '../../../../lib/v2/view/dashboard';
import { sitePage, siteView, type FirstCheckView } from '../../../../lib/v2/view/site';
import type { FixtureDataset } from '@crawlmouse/types/v2';

/** example-outfitter.com's owner, on day 9 of the Pro trial (bad-site). */
export const BAD_ACCOUNT_ID = 'a0000000-0000-4000-8000-000000000001';
/** Northwind Digital: Agency, an invoice failed on 1 Nov, inside the 7-day grace (challenged-site). */
export const NORTHWIND_ACCOUNT_ID = 'a0000000-0000-4000-8000-0000000000c9';

const clean = fixture('clean-site');
const cleanSite = clean.sites[0]!;

/**
 * A stand-in account for clean-site, whose one site is an unkept audit (`account_id` null): a Free
 * account that has never had a trial, so the dashboard shows the one-time "Start 14 days of Pro"
 * offer (H5). Not a fixture record; nothing outside the previews reads it.
 */
export const STAND_IN_FREE_ACCOUNT: Account = {
  id: 'a0000000-0000-4000-8000-0000000000f1',
  email: 'owner@trailhead.example',
  name: null,
  state: 'free',
  state_history: [{ state: 'free', since: cleanSite.created_at }],
  trial_ends_at: null,
  card_last4: null,
  renews_at: null,
  billing_period_months: null,
  timezone: 'UTC',
  limits: contractLimits('free', NO_EXTRAS),
  email_prefs: { change_notes: true, trial_reminder: true },
  integrations: [],
  api_keys: [],
  branding: null,
  agency_trial_consent: null,
};

/** clean-site at its as_of, read by the stand-in account holding its one audit. */
export const CLEAN_VIEWER: Viewer = {
  accountId: STAND_IN_FREE_ACCOUNT.id,
  account: STAND_IN_FREE_ACCOUNT,
  adopt: [cleanSite.id],
  now: clean.as_of,
};

/** The account screens' viewers, by preview. */
export const ACCOUNT_VIEWERS = {
  /** Day 0: when the account begins, seven minutes after its first audit finished (Q9). */
  day0: (): Viewer => {
    const d = fixture('bad-site');
    return { accountId: BAD_ACCOUNT_ID, now: firstRunNow(d, { accountId: BAD_ACCOUNT_ID }) };
  },
  home: (): Viewer => ({ accountId: BAD_ACCOUNT_ID, now: fixture('bad-site').as_of }),
  clean: (): Viewer => CLEAN_VIEWER,
  withheld: (): Viewer => ({
    accountId: NORTHWIND_ACCOUNT_ID,
    now: fixture('challenged-site').as_of,
  }),
};

/** The fixture each viewer reads. */
export const DATASET = {
  day0: 'bad-site',
  home: 'bad-site',
  clean: 'clean-site',
  withheld: 'challenged-site',
} as const satisfies Record<keyof typeof ACCOUNT_VIEWERS, string>;

/** The account frame each preview renders: the rail, its trial card and theme. */
export function shellPreview(name: keyof typeof ACCOUNT_VIEWERS) {
  return accountShellView(viewAt(fixture(DATASET[name]), ACCOUNT_VIEWERS[name]()), 'Sites');
}

/** The dashboard each preview renders. */
export const dashboardPreview = (name: keyof typeof ACCOUNT_VIEWERS) =>
  dashboardView(fixture(DATASET[name]), ACCOUNT_VIEWERS[name]());

/**
 * The site each site preview opens. On bad-site and clean-site it is the account's primary site
 * (example-outfitter.com, the clean site). On challenged-site it is granitepeak.example, the site
 * whose AI readability is withheld; the primary site there is harborlight.example, made a day earlier.
 */
export const SITE_OF = {
  home: '50000000-0000-4000-8000-000000000001',
  clean: cleanSite.id,
  withheld: '50000000-0000-4000-8000-0000000000c9',
} as const;

/** The site page each preview renders. */
export const sitePreview = (name: keyof typeof SITE_OF) =>
  siteView(fixture(DATASET[name]), ACCOUNT_VIEWERS[name](), SITE_OF[name]);

/** Each account-screen preview: the screen it renders and the viewer who reads it. */
export const ACCOUNT_PREVIEWS = {
  '/v2-preview/screens/dashboard/day0': { screen: 'dashboard', viewer: 'day0' },
  '/v2-preview/screens/dashboard': { screen: 'dashboard', viewer: 'home' },
  '/v2-preview/screens/dashboard/clean': { screen: 'dashboard', viewer: 'clean' },
  '/v2-preview/screens/dashboard/withheld': { screen: 'dashboard', viewer: 'withheld' },
  '/v2-preview/screens/site': { screen: 'site', viewer: 'home' },
  '/v2-preview/screens/site/clean': { screen: 'site', viewer: 'clean' },
  '/v2-preview/screens/site/withheld': { screen: 'site', viewer: 'withheld' },
} as const satisfies Record<
  string,
  { screen: 'dashboard' | 'site'; viewer: keyof typeof ACCOUNT_VIEWERS }
>;

// ── States a live account reaches that the fixtures hold no moment of (CC-26b D8, R22) ─────────

/** bad-site's account with every site record taken out: day 0 before a site is added. */
export function noSiteDataset(): FixtureDataset {
  const d = fixture('bad-site');
  return {
    ...d,
    sites: [],
    checks: [],
    page_results: [],
    link_edges: [],
    access_tests: [],
    fixes: [],
    fix_events: [],
    changes: [],
    alert_rules: d.alert_rules.filter((r) => r.site_id === null),
    reports: [],
    usage_events: [],
    withheld: [],
  };
}

/** The dashboard of an account with no site, at bad-site's as_of. */
export const noSitePreview = () => dashboardView(noSiteDataset(), ACCOUNT_VIEWERS.home());

/** nahltech.com, bad-site's second site, halfway through its first check. */
export const FIRST_CHECK_SITE = '50000000-0000-4000-8000-000000000002';

export function firstCheckPreview(): FirstCheckView {
  const d = fixture('bad-site');
  const first = d.checks
    .filter((c) => c.site_id === FIRST_CHECK_SITE)
    .sort((a, b) => Date.parse(a.queued_at) - Date.parse(b.queued_at))[0]!;
  const now = new Date((Date.parse(first.started_at!) + Date.parse(first.finished_at!)) / 2);
  const p = sitePage(d, { accountId: BAD_ACCOUNT_ID, now: now.toISOString() }, FIRST_CHECK_SITE);
  if (p.kind !== 'first_check')
    throw new Error('nahltech.com has a result mid-way through its first check');
  return p.first;
}
