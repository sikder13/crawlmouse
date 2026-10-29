import type { NotRequested } from '../batch/polite-fetch.js';
import { MAX_URL_LENGTH } from '../rows/bounded.js';
import { MAX_CRAWL_DELAY_S, MAX_ROBOTS_ORIGINS, type SiteBlock } from '../batch/site-rules.js';
import type { FetchError, RedirectStop } from '../fetch/fetcher.js';
import {
  MAX_ROBOTS_BYTES,
  MAX_ROBOTS_RULES,
  type TooLargeReason,
  type UnreachableReason,
} from '../politeness/robots.js';
import type { ChallengeEvidence } from './response.js';
import type { Observed } from './table.js';
import { THIN_RATIO } from './table.js';

/**
 * What a row's evidence cannot show, in words. Every sentence that names data is built from that
 * data, so it cannot name a crawler, a count or a cause the batch did not observe.
 */

export const TAGGED_REQUEST =
  "Requested with the crawler's user agent tagged \"Crawlmouse/2.0\", from Crawlmouse's own IP address, not the operator's. A rule that matches the exact user agent will not fire on it, and a site that checks crawler IP addresses treats it as unverified.";

export const CONTROL_REQUEST =
  'An untagged browser-identity control request: it shows what the server sends before scripts run.';

export const CANARY_REQUEST =
  'A tagged Googlebot request made only to tell whether this site checks crawler IP addresses. It is not a Googlebot result.';

export const ROBOTS_DISALLOWS_CRAWLER =
  'Read from robots.txt: the crawler is told not to fetch this path, so nothing was requested as it.';

export const SITE_REFUSED =
  "The SSRF guard refused this site's address (a private or reserved range, or a non-web URL), so nothing was requested. The request shown is the refused robots.txt read.";

export const ROBOTS_DISALLOWS_US =
  'robots.txt asks Crawlmouse not to fetch this path, so nothing was requested on it.';

/**
 * Why a served crawler response was not compared with the control, naming each reason that held: the
 * conditions of the table's served_uncounted row (verdict/table.ts), read from the same values.
 */
export function uncounted(
  words: number | null,
  controlWords: number | null,
  sameType: boolean,
): string {
  const reasons = [
    words === null ? "the words in the crawler's response could not be counted" : null,
    controlWords === null ? "the words in the control's response could not be counted" : null,
    controlWords === 0 && !sameType
      ? "the control had no words and the crawler's response was of another type"
      : null,
  ].filter((r): r is string => r !== null);
  const why = list(reasons);
  return `${why.charAt(0).toUpperCase()}${why.slice(1)}, so the crawler's access is not measured against the control.`;
}

const REQUEST_FAILED: Record<FetchError, string> = {
  ssrf_refused: 'the SSRF guard refused it',
  dns_failed: 'the host name did not resolve',
  too_large: 'the response was larger than the size ceiling',
  timeout: 'it timed out',
  network: 'the connection failed or was closed before the response ended',
};

/** Why a request got no usable response. */
export const requestFailed = (error: FetchError): string =>
  `The request failed: ${REQUEST_FAILED[error]}.`;

/** A limitation about the control's response, on a row whose evidence is the crawler's. */
export const aboutControl = (note: string): string =>
  `About the browser control's response: ${note}`;

const UNREACHABLE: Record<UnreachableReason, string> = {
  server_error: 'it answered with a server error',
  timeout: 'the request timed out',
  network: 'the request failed',
  challenged: 'it was answered with a challenge',
  byte_budget: "it was larger than the batch's byte budget had left",
  redirect_status: 'it ended on a redirect',
};

export const robotsUnreachable = (origin: string, why: UnreachableReason): string =>
  `robots.txt unreachable at ${origin}: ${UNREACHABLE[why]}. The site was treated as fully disallowed for this batch, so nothing was requested. The request shown is that robots.txt read.`;

const TOO_LARGE: Record<TooLargeReason, string> = {
  bytes: `it is larger than the ${MAX_ROBOTS_BYTES / 1024} KiB this worker reads`,
  rules: `a group in it for a user agent this worker reads holds more than ${MAX_ROBOTS_RULES} rules`,
};

export const robotsTooLarge = (origin: string, why: TooLargeReason): string =>
  `robots.txt too large to evaluate at ${origin}: ${TOO_LARGE[why]}. Nothing was requested on the site in this batch. The request shown is that robots.txt read.`;

/** Why robots.txt keeps the batch from fetching any page. */
export function siteBlocked({ block, rules }: SiteBlock): string {
  const { reading } = rules;
  if (block === 'site_refused') return SITE_REFUSED;
  if (block === 'crawl_delay_over_limit')
    return crawlDelayOverLimit(rules.crawlDelayS!, MAX_CRAWL_DELAY_S);
  if (reading.state === 'too_large') return robotsTooLarge(rules.origin, reading.why);
  return robotsUnreachable(rules.origin, reading.state === 'unreachable' ? reading.why : 'network');
}

/** Why the batch or the site had stopped, as the end of a sentence. */
export function stoppedBecause(n: NotRequested): string {
  return n.reason === 'budget'
    ? `the batch's ${n.budget} budget was spent`
    : `requests to ${n.site} were stopped`;
}

export function notRequested(n: NotRequested): string {
  if (n.reason === 'budget') {
    return `Not requested: the batch's ${n.budget} budget was spent. The user agent shown is the one that would have been sent.`;
  }
  const why =
    n.stop.reason === 'three_429_responses'
      ? 'it answered 429 three times'
      : 'four pages in a row were challenged';
  return `Not requested: requests to ${n.site} were stopped because ${why}. The user agent shown is the one that would have been sent.`;
}

export const crawlDelayOverLimit = (declaredS: number, limitS: number): string =>
  `robots.txt asks for a ${declaredS} s Crawl-delay, above the ${limitS} s this worker honours, so the site was not fetched. The request shown is the robots.txt read.`;

export const controlBlocked = (control: Observed): string =>
  `The untagged browser control was ${control === 'challenged' ? 'challenged' : 'refused'} too, so the site treats our requests this way whatever the user agent. This shows our access, not what the real crawler receives; the crawler's own request was not sent, and the evidence shown is the control's.`;

/** `redirectNotFollowed`: the control's last response was a redirect the batch did not follow. */
export const controlUnusable = (control: Observed, redirectNotFollowed: boolean): string =>
  `The browser control was not served (${redirectNotFollowed ? REDIRECT_NOT_FOLLOWED : observedPhrase[control]}), so there is no baseline to read the crawler's response against.`;

export const REDIRECT_NOT_FOLLOWED = 'it ended on a redirect that was not followed';

const REDIRECT_STOP: Record<RedirectStop, string> = {
  off_site: 'it redirects to another site, which was not requested',
  robots_disallowed: 'it redirects to a path robots.txt disallows, which was not requested',
  robots_unreadable:
    "it redirects to an origin whose robots.txt could not be read, or asks for a Crawl-delay above the worker's limit, so the target was not requested",
  not_web: 'it redirects to a URL that is not http or https, which was not requested',
  url_too_long: `it redirects to a URL over ${MAX_URL_LENGTH} characters, which was neither requested nor recorded`,
  other_port: 'it redirects to another port, which was not requested',
  origin_limit: `it redirects to another origin, but the batch had already read robots.txt for ${MAX_ROBOTS_ORIGINS} origins, the most it reads, so the target was not requested`,
  batch_stopped:
    'it redirects, and the batch stopped (a budget spent or the site stopped) before the target was requested',
  too_many: 'it redirects more than five times',
};

/** Why a page was not read past its redirect; `cut` names what stopped the batch, when it did. */
export function redirectStopped(stop: RedirectStop, cut: NotRequested | null = null): string {
  if (stop === 'batch_stopped' && cut) {
    return `The page was not read: it redirects, and ${stoppedBecause(cut)} before the target was requested.`;
  }
  return `The page was not read: ${REDIRECT_STOP[stop]}.`;
}

const CHALLENGE: Record<ChallengeEvidence, (marker: string) => string> = {
  mitigation_header: (m) => `the ${m} header`,
  challenge_redirect: (m) => `a redirect to a URL containing "${m}"`,
  body_signature: (m) => `the body text "${m}" on a 403 or 503`,
};

export const challengedBy = (c: { evidence: ChallengeEvidence; marker: string }): string =>
  `Recognised as a challenge by ${CHALLENGE[c.evidence](c.marker)}.`;

export function thin(words: number, controlWords: number): string {
  const pct = Math.round((words / controlWords) * 100);
  return `Served ${words} words against ${controlWords} for the browser control (${pct}%); under ${THIN_RATIO * 100}% counts as thin.`;
}

/** How a request came out, as the rest of a sentence. */
const observedPhrase: Record<Observed, string> = {
  served: 'served',
  refused: 'refused',
  gone: 'answered 404 or 410',
  challenged: 'challenged',
  rate_limited: 'rate limited (429)',
  payment: 'answered 402, payment required',
  redirected_away: 'redirected to another site',
  error: 'failed',
  not_requested: 'not requested',
};

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What the canary request got, as a predicate. */
const CANARY_OUTCOME: Record<Observed, string> = {
  served: 'was served',
  refused: 'was refused',
  gone: 'got 404 or 410',
  challenged: 'was challenged',
  rate_limited: 'was rate limited (429)',
  payment: 'got 402, payment required',
  redirected_away: 'was redirected to another site',
  error: 'failed',
  not_requested: 'was not requested',
};

/**
 * For a refusal: what the canary got, and which other tested crawlers were served on the same page.
 * The second half is what lets a reader call a refusal "likely a user-agent rule"; the verdict does
 * not claim it unless the canary was served.
 */
export function canaryReading(
  canary: Observed,
  canaryNote: string | null,
  othersServed: readonly string[],
): string {
  const head =
    canary === 'served'
      ? 'The tagged Googlebot request was served on this page, so the site does not check crawler IP addresses here and the refusal is aimed at this user agent.'
      : `The tagged Googlebot request on this page ${canaryNote ?? CANARY_OUTCOME[canary]}, so this refusal cannot be told apart from IP verification.`;
  const tail = othersServed.length
    ? ` ${list(othersServed)} ${othersServed.length === 1 ? 'was' : 'were'} served on this page.`
    : ' No other tested crawler was served on this page.';
  return head + tail;
}
