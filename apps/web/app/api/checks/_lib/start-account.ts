/**
 * A start from the home form by a person signed in and acting in an account (RC-02, F-001): the
 * check is of a site that account keeps. What POST /api/checks does for a viewer, in order:
 *
 * 1. The host, by the public start's rule (`publicHost`), then the SSRF guard on it. A refusal is
 *    the public start's `invalid_url`.
 * 2. A live site of the account with that host that the caller's seat covers. A paused one is
 *    refused. While its latest check is running, that check is the answer. While it is queued, it is
 *    the answer too, and its event is sent again under its own id, since a send that failed leaves
 *    a queued check nothing runs; Inngest drops the repeat when the first arrived, and repeats count
 *    in the replay bucket as on the public start. Otherwise it is checked again as the site page's "Run check now" checks it
 *    (`request_capped_check`, under the account's `manualChecksPerSiteDay` and the day's ceiling).
 * 3. No such site: the seat must be one that may add a site, and the account must be under its site
 *    limit. Then the site is added with its first audit by `add_site`, the statement `/api/sites`
 *    uses: it counts the site limit under the account's lock, the day's adds, the day's
 *    `global:audits:day` ceiling (failing closed) and, on Free, v1's per-domain hourly bucket. Those
 *    are not counted again here. Two submits racing for one new host: the one `add_site` answers
 *    `exists` is answered with the other's check.
 * 4. Before step 2's or step 3's request, and only then, the caller's address bucket, with Turnstile
 *    once it is over its limit, at the signed-in limit (`addressGate`): the home form is never weaker
 *    for a signed-in person than it is today. A caller with no known address is not counted, as on
 *    the public start.
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
import type { AddSiteOutcome, NewSite, ResendQueued } from '../../../../lib/v2/account/sites-store';
import type { RequestRecheck } from '../../../../lib/v2/account/recheck';
import { PLAN_NAMES } from '../../../../lib/v2/view/account';
import { UNAVAILABLE_CODES } from '../../../../lib/v2/unavailable';
import { numberWord, plural } from '../../../../lib/v2/words';
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
  latest: {
    id: string;
    status: Check['status'];
    trigger: Check['trigger'];
    queued_at: string;
  } | null;
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
  /** Sends a queued check's event again under its own id; false when that id cannot be proved. */
  resendQueued(queued: ResendQueued): Promise<boolean>;
  now(): Date;
}

/** What the route sends once it has answered: the events `/api/sites` and "Run check now" send. */
export type AccountStarted =
  | { trigger: 'first_audit'; siteId: string; n: number }
  | { trigger: 'manual'; siteId: string };

/** The refusals only a start for an account has; the home form has words for each. */
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

/**
 * The sentence of each refusal that holds no number. The home form says the same words for the same
 * codes (`START_COPY`, components/v2/screens/home/start-check.ts); `start-account.test.ts` holds the
 * two equal, since a module here may not import the form's.
 */
export const ACCOUNT_SENTENCES: Readonly<
  Record<Exclude<AccountRefusalCode, 'site_limit'>, string>
> = Object.freeze({
  adds_capped: 'This account has added as many sites as it may today. Try again tomorrow.',
  role_refused:
    'Your seat on this account cannot add a site. Switch to your own account to check it there, or ask this account’s owner to add it.',
  site_paused: 'Checks of this site are paused. Its page on your dashboard says why.',
  recently_checked:
    'This site was checked as often as its plan allows for now. Its latest audit is on your dashboard.',
  site_exists: 'This account already keeps that site. Open it from your dashboard.',
});

const said = (
  status: AccountStartRefusal['status'],
  code: Exclude<AccountRefusalCode, 'site_limit'>,
  more: { nextAllowedAt?: string } = {},
): AccountStartRefusal => refuse(status, code, ACCOUNT_SENTENCES[code], more);

const CAPACITY = refuse(
  503,
  UNAVAILABLE_CODES.capacity,
  'We’re at capacity right now. Please try again tomorrow.',
);

/**
 * "This account’s Free plan keeps one site, and it is already taken." `kept` is the account's live
 * site count now: an account over its limit (a lapsed plan's sites) is told how many it has.
 */
export function siteLimitSentence(tier: Tier, limit: number, kept: number = limit): string {
  // A site was removed between the refused add and this count: there is no limit to explain.
  if (kept < limit) return 'A site on this account was just removed. Try again.';
  const sites = (n: number) => `${numberWord(n)} ${plural(n, 'site', 'sites')}`;
  const holds =
    kept === limit
      ? `${plural(limit, 'it is', 'they are')} already taken`
      : `the account has ${sites(kept)} now`;
  // "This account’s", not "Your": a manager acts in a client’s account, on a plan they do not hold.
  return (
    `This account’s ${PLAN_NAMES[tier]} plan keeps ${sites(limit)}, and ${holds}. Open your ` +
    `dashboard to check ${plural(kept, 'it', 'one of them')} again.`
  );
}

export async function startAccountCheck(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  input: StartInput,
): Promise<AccountStartOutcome> {
  const host = publicHost(input.url);
  if (host === null || !(await deps.admit(host))) return INVALID_URL;
  // The address bucket is counted only for a start that would request a check: a refusal of the
  // account's own, or an answer with a check already queued, counts against nothing.
  const gate = () => addressGate(deps, input, async () => true);
  const site = await deps.coveredSite(viewer.account.id, host);
  return site === null
    ? addSite(deps, viewer, host, gate, input.ip)
    : checkAgain(deps, viewer, host, site, gate, input.ip);
}

type Gate = () => Promise<StartRefusal | null>;

async function addSite(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  host: string,
  gate: Gate,
  ip: string,
): Promise<AccountStartOutcome> {
  const { account, seat } = viewer;
  if (!(await deps.mayAdd(account.id, seat.id))) return said(403, 'role_refused');
  const live = await deps.liveSites(account.id);
  // `add_site` decides under the account's lock; this read only spares the address bucket.
  if (live >= viewer.limits.sites) return limitReached(viewer, live);
  const address = await gate();
  if (address !== null) return address;
  const added = await deps.addSite({
    accountId: account.id,
    ownerSeatId: seat.id,
    host,
    schedule: deps.schedule(viewer.tier, live === 0, deps.now(), account.timezone),
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
    case 'exists': {
      // Added a moment ago by another submit: its check is the answer. A site this seat does not
      // cover reads as none, and is refused without naming it.
      const now = await deps.coveredSite(account.id, host);
      return now === null
        ? said(409, 'site_exists')
        : checkAgain(deps, viewer, host, now, NO_GATE, ip);
    }
    case 'full':
      return limitReached(viewer, await deps.liveSites(account.id));
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

/** The address was counted already, for the request this answer belongs to. */
const NO_GATE: Gate = async () => null;

const limitReached = (viewer: AccountViewer, kept: number) =>
  refuse(409, 'site_limit', siteLimitSentence(viewer.tier, viewer.limits.sites, kept));

async function checkAgain(
  deps: AccountStartDeps,
  viewer: AccountViewer,
  host: string,
  site: CoveredSite,
  gate: Gate,
  ip: string,
): Promise<AccountStartOutcome> {
  if (site.pausedReason !== null) return said(409, 'site_paused');
  const latest = site.latest;
  if (latest?.status === 'running') {
    return { ok: true, checkId: latest.id, created: false, started: null };
  }
  if (latest?.status === 'queued') {
    // Its event may never have gone (a send that failed): this repeat is what recovers it. The same
    // event id, so Inngest runs it once, and counted as the public start counts a repeat.
    if (ip !== 'unknown' && !(await deps.limits.replay(ip))) {
      return refuse(429, 'rate_limited', 'Too many repeats of this request. Try again later.');
    }
    await deps.resendQueued({
      siteId: site.id,
      accountId: viewer.account.id,
      host,
      check: latest,
      requestedByUserId: viewer.userId,
    });
    return { ok: true, checkId: latest.id, created: false, started: null };
  }
  const address = await gate();
  if (address !== null) return address;
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
      return addSite(deps, viewer, host, NO_GATE, ip);
  }
}
