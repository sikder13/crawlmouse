import type { UnreachableReason } from '../politeness/robots.js';
import type { NotRequested } from '../batch/polite-fetch.js';
import type { RedirectStop } from '../fetch/fetcher.js';
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
  "The SSRF guard refused this site's address (a private or reserved range, or a non-web URL), so nothing was requested.";

export const ROBOTS_DISALLOWS_US =
  'robots.txt asks Crawlmouse not to fetch this path, so nothing was requested on it.';

const UNREACHABLE: Record<UnreachableReason, string> = {
  server_error: 'it answered with a server error',
  timeout: 'the request timed out',
  network: 'the request failed',
  challenged: 'it was answered with a challenge',
  redirect_status: 'it ended on a redirect',
};

export const robotsUnreachable = (why: UnreachableReason): string =>
  `robots.txt unreachable: ${UNREACHABLE[why]}. The site was treated as fully disallowed for this batch, so nothing was requested.`;

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
  `Not requested: robots.txt asks for a ${declaredS} s Crawl-delay, above the ${limitS} s this worker honours, so the site was not fetched. The user agent shown is the one that would have been sent.`;

export const controlBlocked = (control: Observed): string =>
  `The untagged browser control was ${control === 'challenged' ? 'challenged' : 'refused'} too, so the site treats our requests this way whatever the user agent. This shows our access, not what the real crawler receives; the crawler's own request was not sent, and the evidence shown is the control's.`;

export const controlUnusable = (control: Observed): string =>
  `The browser control was not served (${describe(control)}), so there is no baseline to read the crawler's response against.`;

const REDIRECT_STOP: Record<RedirectStop, string> = {
  off_site: 'it redirects to another site, which was not requested',
  robots_disallowed: 'it redirects to a path robots.txt disallows, which was not requested',
  too_many: 'it redirects more than five times',
};

export const redirectStopped = (stop: RedirectStop): string =>
  `The page was not read: ${REDIRECT_STOP[stop]}.`;

export function thin(words: number, controlWords: number): string {
  const pct = Math.round((words / controlWords) * 100);
  return `Served ${words} words against ${controlWords} for the browser control (${pct}%); under ${THIN_RATIO * 100}% counts as thin.`;
}

function describe(o: Observed): string {
  return o.replace(/_/g, ' ');
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * For a refusal: what the canary got, and which other tested crawlers were served on the same page.
 * The second half is what lets a reader call a refusal "likely a user-agent rule"; the verdict does
 * not claim it unless the canary was served.
 */
export function canaryReading(
  canary: Observed,
  canaryNotRun: string | null,
  othersServed: readonly string[],
): string {
  const head =
    canary === 'served'
      ? 'The tagged Googlebot request was served on this page, so the site does not check crawler IP addresses here and the refusal is aimed at this user agent.'
      : `The tagged Googlebot request on this page was ${canaryNotRun ?? describe(canary)}, so this refusal cannot be told apart from IP verification.`;
  const tail = othersServed.length
    ? ` ${list(othersServed)} ${othersServed.length === 1 ? 'was' : 'were'} served on this page.`
    : ' No other tested crawler was served on this page.';
  return head + tail;
}
