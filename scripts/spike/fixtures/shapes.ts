import { parseRobotsTxt, isAllowedByRobots } from '../../../packages/engine/src/robots.js';
import { CRAWLER_TOKENS, type IdentityName, type Token } from '../worker/identities.js';
import {
  classifyResponse,
  classifyControl,
  gFromU,
  type PageObs,
  type RobotsVerdict,
  type SiteSummary,
  type Verdict,
  type ResponseShape,
} from '../worker/classify.js';

/**
 * Recorded response SHAPES for the five discriminator sites (POC-1, POC-2b; ENGINE-GAP 3.5a). These are
 * the status/header/body-signature shapes the sites produced, not copies of their pages. One source of
 * truth: the unit tests classify them directly and the node:http fixture serves the same bytes.
 */

export const SITE_NAMES = ['nike.com', 'en.wikipedia.org', 'css-tricks.com', 'neilpatel.com', 'cnn.com'] as const;
export type SiteName = (typeof SITE_NAMES)[number];
export const SAMPLE_PAGES = 20;

export interface Recorded {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const pagePath = (i: number): string => (i === 0 ? '/' : `/p/${i}`);

export function pageHtml(words: number): string {
  return `<html><head><title>t</title></head><body><p>${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}</p></body></html>`;
}

const SERVED = (): Recorded => ({ status: 200, headers: { 'content-type': 'text/html' }, body: pageHtml(500) });
const PLAIN_403 = (): Recorded => ({ status: 403, headers: { 'content-type': 'text/plain', server: 'nginx' }, body: 'Forbidden' });
const CHALLENGE = (): Recorded => ({
  status: 403,
  headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge', server: 'cloudflare' },
  body: '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b"></script></body></html>',
});

/** Pages (by index) on which neilpatel.com served every identity (POC-2b: 3 of 20). */
export const NEILPATEL_SERVED_PAGES = new Set([3, 9, 19]);

const REFUSED_BY: Record<SiteName, ReadonlySet<string>> = {
  'nike.com': new Set(['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'GPTBot', 'googlebot']),
  'en.wikipedia.org': new Set(['ClaudeBot', 'googlebot']),
  'css-tricks.com': new Set(CRAWLER_TOKENS),
  'neilpatel.com': new Set(),
  'cnn.com': new Set(['googlebot']),
};

export function respond(site: SiteName, who: IdentityName, pageIdx: number): Recorded {
  if (who === 'crawlmouse' || who === 'browser') return SERVED();
  if (site === 'neilpatel.com') return NEILPATEL_SERVED_PAGES.has(pageIdx) ? SERVED() : CHALLENGE();
  return REFUSED_BY[site].has(who) ? PLAIN_403() : SERVED();
}

export function robotsFor(site: SiteName): string {
  const lines: string[] = [];
  if (site === 'cnn.com') {
    for (const t of CRAWLER_TOKENS) lines.push(`User-agent: ${t}`);
    lines.push('Disallow: /', '');
  }
  if (site === 'css-tricks.com') {
    lines.push('User-agent: GPTBot', 'User-agent: ChatGPT-User', 'User-agent: ClaudeBot', 'Allow: /', '');
  }
  lines.push('User-agent: *', 'Disallow: /search', '');
  return lines.join('\n');
}

const shapeOf = (r: Recorded, host: string): ResponseShape => ({
  status: r.status,
  headers: r.headers,
  bodyHead: r.body.slice(0, 4096),
  words: r.status === 200 ? r.body.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length : 0,
  originHost: host,
  finalHost: host,
});

/** 20 sampled pages per site, as the per-page observations the decision table consumes. */
export function shapePages(site: SiteName | string): PageObs[] {
  const s = site as SiteName;
  const robots = parseRobotsTxt(robotsFor(s));
  const pages: PageObs[] = [];
  for (let i = 0; i < SAMPLE_PAGES; i++) {
    const path = pagePath(i);
    const R = {} as Record<Token, RobotsVerdict>;
    const U = {} as PageObs['U'];
    const words = {} as PageObs['words'];
    for (const t of CRAWLER_TOKENS) {
      R[t] = isAllowedByRobots(robots, t, path) ? 'allowed' : 'disallowed';
      if (R[t] === 'disallowed') {
        U[t] = 'not_fetched';
        words[t] = 0;
      } else {
        const sh = shapeOf(respond(s, t, i), site);
        U[t] = classifyResponse(sh);
        words[t] = sh.words;
      }
    }
    const control = [shapeOf(respond(s, 'browser', i), site), shapeOf(respond(s, 'crawlmouse', i), site)];
    // The tagged Googlebot witness runs on the homepage and on any page where none of the six was served.
    const noneServed = CRAWLER_TOKENS.every((t) => U[t] !== 'served');
    const gRun = i === 0 || noneServed;
    const G = gRun ? gFromU(classifyResponse(shapeOf(respond(s, 'googlebot', i), site))) : 'not_run';
    pages.push({ robots: R, K: classifyControl(control), controlWords: control[0]!.words, U, words, G });
  }
  return pages;
}

/** ENGINE-GAP 3.5a classification of the five sites, expressed as expected page counts per token (of 20). */
type Expect = Partial<Record<Verdict, number>>;
const all = (e: Expect): Record<Token, Expect> => Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, e])) as Record<Token, Expect>;

export const SITE_EXPECTATIONS: Record<SiteName, Record<Token, Expect>> = {
  'nike.com': {
    'OAI-SearchBot': { blocked_by_ua_rule: 20 },
    'ChatGPT-User': { blocked_by_ua_rule: 20 },
    PerplexityBot: { blocked_by_ua_rule: 20 },
    GPTBot: { blocked_by_ua_rule: 20 },
    'Claude-SearchBot': { allowed: 20 },
    ClaudeBot: { allowed: 20 },
  },
  'en.wikipedia.org': {
    ...all({ allowed: 20 }),
    ClaudeBot: { blocked_by_ua_rule: 20 },
  },
  'css-tricks.com': all({ blocked_by_ua_rule: 20 }),
  'neilpatel.com': all({ challenged_ua: 17, allowed: 3 }),
  'cnn.com': all({ disallowed_by_robots: 20 }),
};

export const SPLIT_TOLERANCE_PAGES = 2;

export function matchesExpectation(site: string, got: SiteSummary): { ok: boolean; misses: string[] } {
  const want = SITE_EXPECTATIONS[site as SiteName];
  const misses: string[] = [];
  if (!want) return { ok: false, misses: [`unknown site ${site}`] };
  for (const t of CRAWLER_TOKENS) {
    const g = got[t] ?? {};
    const w = want[t];
    for (const v of new Set([...Object.keys(w), ...Object.keys(g)]) as Set<Verdict>) {
      const diff = Math.abs((g[v] ?? 0) - (w[v] ?? 0));
      if (diff > SPLIT_TOLERANCE_PAGES) misses.push(`${site} ${t} ${v}: got ${g[v] ?? 0}, want ${w[v] ?? 0}`);
    }
  }
  return { ok: misses.length === 0, misses };
}
