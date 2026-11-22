/**
 * A start from the home form by a person signed in and acting in an account (RC-02, F-001): the
 * check is of a site that account keeps. What POST /api/checks does for a viewer, in order:
 *
 * 1. The host, by the public start's rule (`publicHost`), then the SSRF guard on it. A refusal is
 *    the public start's `invalid_url`.
 * 2. The caller's address bucket, with Turnstile once it is over its limit, at the signed-in limit
 *    (`addressGate`): the home form is never weaker for a signed-in person than it is today.
 * 3. A live site of the account with that host that the caller's seat covers. While its latest check
 *    is queued or running, that check is the answer and nothing is requested (a double submit starts
 *    one crawl). Otherwise it is checked again as the site page's "Run check now" checks it
 *    (`request_capped_check`, under the account's `manualChecksPerSiteDay` and the day's ceiling).
 * 4. No such site: the seat must be one that may add a site, and the site is added with its first
 *    audit by `add_site`, the statement `/api/sites` uses. It counts the account's site limit under
 *    the account's lock, the day's adds, the day's `global:audits:day` ceiling (failing closed) and,
 *    on Free, v1's per-domain hourly bucket. Those are not counted again here.
 *
 * The account is the one the viewer acts in (`loadViewer`: the switcher's choice among the caller's
 * own seats, else their default), so nothing here names an account the caller does not sit on. An
 * answer carries a check id only of that account's own site.
 *
 * The refusals' sentences are built from the account's own tier and limits (RULES: no typed numbers).
 */
import type { Check } from '@crawlmouse/types/v2';
import type { SiteSchedule } from '../../../../lib/auth/schedule';
import type { Tier } from '../../../../lib/entitlement-v2';
import type { AccountViewer } from '../../../../lib/v2/account/viewer-read';
import type { AddSiteOutcome, NewSite } from '../../../../lib/v2/account/sites-store';
import type { RequestRecheck } from '../../../../lib/v2/account/recheck';
import { PLAN_NAMES } from '../../../../lib/v2/view/account';
import { UNAVAILABLE_CODES } from '../../../../lib/v2/unavailable';
import { numberWord, plural } from '../../../../lib/v2/words';
import { START_COPY } from '../../../../components/v2/screens/home/start-check';
import { publicHost } from './host';
import {
  addressGate,
  INVALID_URL,
  type StartDeps,
  type StartInput,
  type StartRefusal,
} from './start';

/** A live site of the account with the host, as the caller's own session reads it. */
export interface CoveredSite {
  id: string;
  pausedReason: string | null;
  /** The site's most recently queued check, or null for none. */
  latest: { id: string; status: Check['status'] } | null;
}

export interface AccountStartDeps extends Pick<StartDeps, 'admit' | 'limits' | 'verifyTurnstile'> {
  /** The account's live site with that host, when the caller's seat covers it; else null. */
  coveredSite(accountId: string, host: string): Promise<CoveredSite | null>;
  /** `seat_may('add_site')` for the account, and a seat not scoped to some clients. */
  mayAdd(accountId: string, seatId: string): Promise<boolean>;
  /** The account's live primary sites: whether this is its first decides the schedule. */
  liveSites(accountId: string): Promise<number>;
  schedule(tier: Tier, first: boolean, now: Date, timezone: string): SiteSchedule | null;
  addSite(site: NewSite): Promise<AddSiteOutcome>;
  recheck: RequestRecheck;
  now(): Date;
}

/** What the route sends once it has answered: the events `/api/sites` and "Run check now" send. */
export type AccountStarted =
  | { trigger: 'first_audit'; siteId: string; n: number }
  | { trigger: 'manual'; siteId: string };

/** The refusals only a start for an account has; the form says each (`START_COPY`). */
export type AccountRefusalCode =
  | 'site_limit'
  | 'adds_capped'
  | 'role_refused'
  | 'site_paused'
  | 'recently_checked'
  | 'site_exists';

export type AccountStartRefusal = {
  ok: false;
  status: 403 | 409 | 429 | 503 | StartRefusal['status'];
  body: { code: string; error: string; resetAt?: string; nextAllowedAt?: string };
};

export type AccountStartOutcome =
  | { ok: true; checkId: string; created: boolean; started: AccountStarted | null }
  | AccountStartRefusal;

const refuse = (
  status: AccountStartRefusal['status'],
  code: string,
  error: string,
  more: { nextAllowedAt?: string } = {},
): AccountStartRefusal => ({ ok: false, status, body: { code, error, ...more } });

/** A refusal whose sentence is the home form's own (`START_COPY`): it holds no number. */
const said = (
  status: AccountStartRefusal['status'],
  code: Exclude<AccountRefusalCode, 'site_limit'>,
  more: { nextAllowedAt?: string } = {},
): AccountStartRefusal => refuse(status, code, START_COPY[code], more);

const CAPACITY = refuse(
  503,
  UNAVAILABLE_CODES.capacity,
  'We’re at capacity right now. Please try again tomorrow.',
);

/** "Your Free plan keeps one site, and this account keeps it already." */
export function siteLimitSentence(tier: Tier, limit: number): string {
  const sites = `${numberWord(limit)} ${plural(limit, 'site', 'sites')}`;
  return (
    `Your ${PLAN_NAMES[tier]} plan keeps ${sites}, and this account keeps ` +
    `${plural(limit, 'it', 'them')} already. Open your dashboard to check ` +
    `${plural(limit, 'it', 'one of them')} again.`
  );
}

export async function startAccountCheck(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  input: StartInput,
): Promise<AccountStartOutcome> {
  const host = publicHost(input.url);
  if (host === null || !(await deps.admit(host))) return INVALID_URL;

  const address = await addressGate(deps, input, async () => true);
  if (address !== null) return address;

  const site = await deps.coveredSite(viewer.account.id, host);
  return site === null ? addSite(deps, viewer, host) : checkAgain(deps, viewer, host, site);
}

async function addSite(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  host: string,
): Promise<AccountStartOutcome> {
  const { account, seat } = viewer;
  if (!(await deps.mayAdd(account.id, seat.id))) return said(403, 'role_refused');
  const now = deps.now();
  const first = (await deps.liveSites(account.id)) === 0;
  const added = await deps.addSite({
    accountId: account.id,
    ownerSeatId: seat.id,
    host,
    schedule: deps.schedule(viewer.tier, first, now, account.timezone),
    limit: viewer.limits.sites,
    // v1's per-domain hourly bucket leaves paid tiers out (as /api/sites counts it).
    perDomain: viewer.tier === 'free',
    requestedByUserId: viewer.userId,
  });
  switch (added.outcome) {
    case 'created':
      return {
        ok: true,
        checkId: added.checkId,
        created: true,
        started: { trigger: 'first_audit', siteId: added.siteId, n: added.n },
      };
    case 'exists':
      // The account keeps the host, on a site this seat does not cover, or added a moment ago.
      return said(409, 'site_exists');
    case 'full':
      return refuse(409, 'site_limit', siteLimitSentence(viewer.tier, viewer.limits.sites));
    case 'adds_capped':
      return said(429, 'adds_capped', { nextAllowedAt: added.nextAllowedAt });
    case 'domain_capped':
      return refuse(
        429,
        'domain_limit',
        'Another audit for this domain ran in the last hour. Try again soon.',
        { nextAllowedAt: added.nextAllowedAt },
      );
    case 'capacity':
      return CAPACITY;
  }
}

async function checkAgain(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  host: string,
  site: CoveredSite,
): Promise<AccountStartOutcome> {
  if (site.pausedReason !== null) return said(409, 'site_paused');
  if (
    site.latest !== null &&
    (site.latest.status === 'queued' || site.latest.status === 'running')
  ) {
    return { ok: true, checkId: site.latest.id, created: false, started: null };
  }
  const outcome = await deps.recheck({
    siteId: site.id,
    trigger: 'manual',
    cap: viewer.gates.manualChecksPerSiteDay,
    requestedByUserId: viewer.userId,
  });
  if (outcome.queued) {
    return {
      ok: true,
      checkId: outcome.checkId,
      created: outcome.created,
      started: outcome.created ? { trigger: 'manual', siteId: site.id } : null,
    };
  }
  switch (outcome.reason) {
    case 'check_running':
      return { ok: true, checkId: outcome.checkId, created: false, started: null };
    case 'capped':
    case 'recently_checked':
      return said(429, 'recently_checked', { nextAllowedAt: outcome.nextAllowedAt });
    case 'capacity':
      return CAPACITY;
    case 'paused':
      return said(409, 'site_paused');
    case 'removed':
      // Removed between the read above and the request: the account no longer keeps the host.
      return addSite(deps, viewer, host);
  }
}
