import { CRAWLER_REGISTRY_V2 } from '@crawlmouse/engine/worker';

/**
 * Who the worker says it is on each request.
 *
 * - `crawl`: our own crawler, for crawl batches and for robots.txt.
 * - `control`: an untagged browser identity, one request per sampled page in an access batch. It is
 *   disclosed on /bot as part of the method; it carries no tag and no From header.
 * - `crawler`: each crawler the registry marks testable, sent as the registry's user agent with our
 *   tag appended. Where the registry prints no user agent (it never invents one), the bare token is
 *   sent instead, as the CC-11 fixtures do.
 * - `canary`: Googlebot's registry user agent, tagged. Its only use is to tell whether a site checks
 *   crawler IP addresses; it never produces a Googlebot verdict.
 */

export const TAG = 'Crawlmouse/2.0 (+https://crawlmouse.com/bot)';
export const FROM = 'bot@crawlmouse.com';
export const CRAWL_USER_AGENT =
  'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';
/** robots.txt groups that bind our own requests. Matching is case-insensitive. */
export const OUR_ROBOTS_TOKENS = ['Crawlmouse', 'CrawlmouseBot'] as const;
/** Used in the control's user agent and in place of the `W.X.Y.Z` Google documents for its own. */
export const CHROME_VERSION = '131.0.0.0';
export const BROWSER_USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const ACCEPT_ENCODING = 'gzip, deflate, br';

export type IdentityRole = 'crawl' | 'control' | 'crawler' | 'canary';

export interface Identity {
  role: IdentityRole;
  /** The registry token for a crawler or the canary; null for our crawl and the control. */
  token: string | null;
  /** The robots.txt group that binds this identity in addition to ours; null for crawl and control. */
  robotsToken: string | null;
  userAgent: string;
  /** Request headers in the order they are sent, with the names as written on the wire. */
  headers: ReadonlyArray<readonly [name: string, value: string]>;
}

function identity(
  role: IdentityRole,
  token: string | null,
  robotsToken: string | null,
  userAgent: string,
): Identity {
  const headers: Array<readonly [string, string]> = [
    ['User-Agent', userAgent],
    ['Accept', ACCEPT],
    ['Accept-Encoding', ACCEPT_ENCODING],
  ];
  if (role !== 'control') headers.push(['From', FROM]);
  return { role, token, robotsToken, userAgent, headers };
}

const tagged = (userAgent: string): string => `${userAgent} ${TAG}`;

export const CRAWL: Identity = identity('crawl', null, null, CRAWL_USER_AGENT);
export const CONTROL: Identity = identity('control', null, null, BROWSER_USER_AGENT);

export const CRAWLERS: readonly Identity[] = CRAWLER_REGISTRY_V2.filter((e) => e.testable).map(
  (e) => identity('crawler', e.token, e.robots_token, tagged(e.ua_string ?? e.token)),
);

function canaryIdentity(): Identity {
  const googlebot = CRAWLER_REGISTRY_V2.find((e) => e.token === 'Googlebot');
  if (!googlebot?.ua_string)
    throw new Error('identities: the registry has no Googlebot user agent');
  const userAgent = googlebot.ua_string.replace('W.X.Y.Z', CHROME_VERSION);
  return identity('canary', googlebot.token, googlebot.robots_token, tagged(userAgent));
}

export const CANARY: Identity = canaryIdentity();

/**
 * The search engines whose robots.txt verdicts a crawl row records, by registry token and the group
 * name they read. Never requested as: verified search bots are not testable.
 */
export const SEARCH_ENGINES: readonly { token: string; robotsToken: string }[] =
  CRAWLER_REGISTRY_V2.filter((e) => e.group === 'search_engine').map((e) => ({
    token: e.token,
    robotsToken: e.robots_token,
  }));
