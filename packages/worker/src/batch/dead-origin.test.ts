import { describe, expect, it } from 'vitest';
import type { FetchOutcome, Fetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { outcome } from '../test-support/outcome.js';
import { BUDGET_CEILINGS, type BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

/** One origin of a site gives no answer; the batch reads the rest (F-165). */
const DEAD = 'https://www.shop.test';
const LIVE = 'https://shop.test';
const PAGE = `<!doctype html><title>t</title><p>${'word '.repeat(60)}</p>`;

const common = {
  check_id: '00000000-0000-4000-8000-000000000001',
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: BUDGET_CEILINGS,
};
const crawl = (urls: string[]): BatchRequest => ({ kind: 'crawl', ...common, urls });
const access = (urls: string[]): BatchRequest => ({
  kind: 'access',
  ...common,
  pages: urls.map((url) => ({ url, template_key: '/' })),
});

type Failure = NonNullable<FetchOutcome['error']>;

async function go(req: BatchRequest, dead: (url: string) => Failure | 503 | null) {
  const asked: string[] = [];
  const fetcher: Fetcher = async (url, identity, limits) => {
    asked.push(url);
    const common = { url, identity, maxBytes: limits.maxBytes };
    const d = dead(url);
    if (d === 503) return outcome({ ...common, status: 503, body: '' });
    if (d)
      return outcome({ ...common, status: null, finalUrl: null, body: '', bytes: 0, error: d });
    if (url.endsWith('/robots.txt'))
      return outcome({
        ...common,
        headers: { 'content-type': 'text/plain' },
        body: 'User-agent: *\nAllow: /\n',
      });
    return outcome({ ...common, body: PAGE });
  };
  const clock = new InstantClock();
  const result = await runBatch(req, {
    clock,
    sites: new Sites(clock),
    fetcher,
    robotsCache: new RobotsCache(clock),
  });
  return { result, asked };
}
const atDead = (f: Failure | 503) => (url: string) => (url.startsWith(`${DEAD}/`) ? f : null);

describe.each<Failure>(['dns_failed', 'network', 'timeout'])(
  'an origin that answers %s',
  (failure) => {
    it('a crawl reads the rest of the site and skips only that origin', async () => {
      const { result, asked } = await go(
        crawl([`${DEAD}/a`, `${LIVE}/b`, `${LIVE}/c`]),
        atDead(failure),
      );
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(asked.filter((u) => u.startsWith(`${DEAD}/`))).toEqual([`${DEAD}/robots.txt`]);
      const by = Object.fromEntries(result.pages.map((p) => [p.url, p]));
      expect(by[`${LIVE}/b`]!.outcome).toBe('fetched');
      expect(by[`${LIVE}/c`]!.outcome).toBe('fetched');
      expect(by[`${DEAD}/a`]!.outcome).toBe('not_requested');
      const why = by[`${DEAD}/a`]!.limitations[0]!;
      expect(why).toContain(`robots.txt unreachable at ${DEAD}`);
      expect(why).toContain('this origin');
      expect(why).not.toContain('The site was treated');
      expect(result.coverage.urls_complete).toBe(2);
      expect(result.partial?.reasons).toContain('robots_unreachable');
    });

    it('asks that origin for no declaration file when it comes first', async () => {
      const { result, asked } = await go(crawl([`${DEAD}/a`, `${LIVE}/b`]), atDead(failure));
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(asked.filter((u) => u.startsWith(`${DEAD}/`))).toEqual([`${DEAD}/robots.txt`]);
      expect(result.declarations.length).toBeGreaterThan(0);
      for (const d of result.declarations) {
        expect(d.state).toBe('not_requested');
        expect(d.not_requested).toBe('site_blocked');
      }
    });

    it('an access batch measures the live page and marks the dead one not measured', async () => {
      const { result, asked } = await go(access([`${DEAD}/a`, `${LIVE}/b`]), atDead(failure));
      if (result.kind !== 'access') throw new Error('access');
      expect(asked.filter((u) => u.startsWith(`${DEAD}/`))).toEqual([`${DEAD}/robots.txt`]);
      const dead = result.access_tests.filter((r) => r.page_url === `${DEAD}/a`);
      const live = result.access_tests.filter((r) => r.page_url === `${LIVE}/b`);
      expect(dead.length).toBeGreaterThan(0);
      for (const r of dead) {
        expect(r.verdict).toBe('not_measured');
        expect(r.limitations[0]).toContain('this origin');
      }
      expect(live.length).toBeGreaterThan(0);
      expect(live.every((r) => r.verdict === 'allowed')).toBe(true);
    });

    it('with every origin dead, reads nothing', async () => {
      const { result, asked } = await go(crawl([`${DEAD}/a`, `${LIVE}/b`]), () => failure);
      if (result.kind !== 'crawl') throw new Error('crawl');
      expect(asked.sort()).toEqual([`${DEAD}/robots.txt`, `${LIVE}/robots.txt`].sort());
      expect(result.pages.every((p) => p.outcome === 'not_requested')).toBe(true);
    });
  },
);

describe('a live origin that says "not now" still stops the batch', () => {
  it('a 503 on robots.txt keeps the other origin from being fetched, in the same words', async () => {
    const { result, asked } = await go(crawl([`${DEAD}/a`, `${LIVE}/b`]), atDead(503));
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(asked).toEqual([`${DEAD}/robots.txt`]);
    expect(result.pages.every((p) => p.outcome === 'not_requested')).toBe(true);
    expect(result.pages[1]!.limitations[0]).toContain('The site was treated as fully disallowed');
  });
});
