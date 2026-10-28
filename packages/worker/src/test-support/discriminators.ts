import type http from 'node:http';
import type { Verdict } from '@crawlmouse/types/v2';
import { BROWSER_USER_AGENT, CRAWLERS } from '../identities.js';
import { startServer, type FixtureServer } from './http.js';

/**
 * The recorded response shapes of the five discriminator sites from the POC runs (POC-1, POC-2b),
 * carried over from the spike's fixtures: the status, headers and body signature each identity got,
 * not copies of the sites' pages. A fixture server answers as each site, keyed on the user agent.
 *
 * SITE_EXPECTATIONS is the classification under the canary rule (a refusal is blocked_by_ua_rule only
 * when the tagged Googlebot canary was served on that page), per crawler, over the 20 sampled pages.
 */

export const SITES = [
  'nike.com',
  'en.wikipedia.org',
  'css-tricks.com',
  'neilpatel.com',
  'cnn.com',
] as const;
export type Site = (typeof SITES)[number];
export const SAMPLE_PAGES = 20;

type Who = 'crawl' | 'control' | 'canary' | string;

interface Recorded {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const pagePath = (i: number): string => (i === 0 ? '/' : `/p/${i}`);

const pageHtml = (words: number): string =>
  `<html><head><title>t</title></head><body><p>${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}</p></body></html>`;

const SERVED = (): Recorded => ({
  status: 200,
  headers: { 'content-type': 'text/html' },
  body: pageHtml(500),
});
const PLAIN_403 = (): Recorded => ({
  status: 403,
  headers: { 'content-type': 'text/plain', server: 'nginx' },
  body: 'Forbidden',
});
const CHALLENGE = (): Recorded => ({
  status: 403,
  headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge', server: 'cloudflare' },
  body: '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b"></script></body></html>',
});

/** Pages on which neilpatel.com served every identity (POC-2b: 3 of 20). */
const NEILPATEL_SERVED_PAGES = new Set([3, 9, 19]);

const REFUSED_BY: Record<Site, ReadonlySet<Who>> = {
  'nike.com': new Set(['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'GPTBot', 'canary']),
  'en.wikipedia.org': new Set(['ClaudeBot', 'canary']),
  'css-tricks.com': new Set(CRAWLERS.map((c) => c.token!)),
  'neilpatel.com': new Set(),
  'cnn.com': new Set(['canary']),
};

function respond(site: Site, who: Who, page: number): Recorded {
  if (who === 'crawl' || who === 'control') return SERVED();
  if (site === 'neilpatel.com') return NEILPATEL_SERVED_PAGES.has(page) ? SERVED() : CHALLENGE();
  return REFUSED_BY[site].has(who) ? PLAIN_403() : SERVED();
}

function robotsFor(site: Site): string {
  const lines: string[] = [];
  if (site === 'cnn.com') {
    for (const c of CRAWLERS) lines.push(`User-agent: ${c.robotsToken}`);
    lines.push('Disallow: /', '');
  }
  if (site === 'css-tricks.com')
    lines.push(
      'User-agent: GPTBot',
      'User-agent: ChatGPT-User',
      'User-agent: ClaudeBot',
      'Allow: /',
      '',
    );
  lines.push('User-agent: *', 'Disallow: /search', '');
  return lines.join('\n');
}

/** Which identity a request came from, by its user agent. */
export function whoSent(userAgent: string): Who {
  if (userAgent.includes('Googlebot')) return 'canary';
  if (userAgent === BROWSER_USER_AGENT) return 'control';
  const crawler = CRAWLERS.find((c) =>
    userAgent.startsWith(c.userAgent.replace(/ Crawlmouse\/2\.0.*$/, '')),
  );
  return crawler ? crawler.token! : 'crawl';
}

export function siteServer(site: Site): Promise<FixtureServer> {
  return startServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/robots.txt') {
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      return res.end(robotsFor(site));
    }
    const m = url === '/' ? ['', '0'] : url.match(/^\/p\/(\d+)$/);
    if (!m) {
      res.statusCode = 404;
      return res.end();
    }
    const r = respond(site, whoSent(String(req.headers['user-agent'] ?? '')), Number(m[1]));
    res.statusCode = r.status;
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    res.end(r.body);
  });
}

type Counts = Partial<Record<Verdict, number>>;
const all = (c: Counts): Record<string, Counts> =>
  Object.fromEntries(CRAWLERS.map((x) => [x.token!, c]));

export const SITE_EXPECTATIONS: Record<Site, Record<string, Counts>> = {
  'nike.com': {
    'OAI-SearchBot': { refused_unverified: 20 },
    'ChatGPT-User': { refused_unverified: 20 },
    PerplexityBot: { refused_unverified: 20 },
    GPTBot: { refused_unverified: 20 },
    'Claude-SearchBot': { allowed: 20 },
    ClaudeBot: { allowed: 20 },
  },
  'en.wikipedia.org': { ...all({ allowed: 20 }), ClaudeBot: { refused_unverified: 20 } },
  'css-tricks.com': all({ blocked_by_ua_rule: 20 }),
  'neilpatel.com': all({ challenged_ua: 17, allowed: 3 }),
  'cnn.com': all({ disallowed_by_robots: 20 }),
};
