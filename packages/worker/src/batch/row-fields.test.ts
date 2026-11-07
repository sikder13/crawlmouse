/**
 * The crawl row's fields for the check builder (CC-20a), as a batch writes them: content features and
 * main-content length on a page read whole, the CMS on the batch's first URL only, noindex from the
 * meta tags and from the X-Robots-Tag header, and robots.txt kept whole.
 */
import { readContentFeatures } from '@crawlmouse/engine/worker';
import { describe, expect, it } from 'vitest';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { fakeFetcher, type FakeResponse } from '../test-support/fake-fetcher.js';
import { headerNoindex } from './crawl.js';
import type { BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

const BASE = 'https://example.com';
const ROBOTS = 'User-agent: *\nDisallow: /private\n# Content-Signal: search=yes\n';
const WP_HOME =
  '<html><head><link rel="stylesheet" href="/wp-content/a.css"></head>' +
  '<body><h1>Home</h1><p>Welcome to the shop, where every tent is tested in the rain.</p></body></html>';

function respond(url: string): FakeResponse {
  const path = new URL(url).pathname;
  if (path === '/robots.txt') return { headers: { 'content-type': 'text/plain' }, body: ROBOTS };
  if (path === '/hidden')
    return {
      headers: { 'content-type': 'text/html', 'x-robots-tag': 'googlebot: noindex' },
      body: '<html><body><p>x</p></body></html>',
    };
  if (path === '/file.pdf')
    return { headers: { 'content-type': 'application/pdf', 'x-robots-tag': 'none' }, body: '%PDF' };
  return { headers: { 'content-type': 'text/html' }, body: WP_HOME };
}

async function crawl(paths: string[]) {
  const clock = new InstantClock();
  const req: BatchRequest = {
    kind: 'crawl',
    check_id: '00000000-0000-4000-8000-0000000000c5',
    site_id: '00000000-0000-4000-8000-0000000000a5',
    batch: 0,
    nonce: 'n'.repeat(16),
    jwt: 'x',
    budget: { max_requests: 100, max_bytes: 10_000_000, max_seconds: 600 },
    urls: paths.map((p) => `${BASE}${p}`),
  };
  const result = await runBatch(req, {
    clock,
    sites: new Sites(clock),
    fetcher: fakeFetcher(clock, respond),
    robotsCache: new RobotsCache(clock),
  });
  if (result.kind !== 'crawl') throw new Error(result.kind);
  return { result, row: (p: string) => result.pages.find((r) => r.url === `${BASE}${p}`)! };
}

describe('crawl row fields for the check builder', () => {
  it("carries the engine's content features and the main-content length of a page read whole", async () => {
    const { row } = await crawl(['/', '/other']);
    expect(row('/other').content_features).toEqual(readContentFeatures(WP_HOME));
    expect(row('/other').main_text_chars).toBeGreaterThan(0);
    expect(row('/other').noindex).toBe(false);
  });

  it("reads the CMS on the batch's first URL only", async () => {
    const { row } = await crawl(['/', '/other']);
    expect(row('/').stack_signals).toEqual({
      cms: 'wordpress',
      detected_from: 'HTML and response headers',
    });
    expect(row('/other').stack_signals).toBeNull();
  });

  it('reads noindex from the X-Robots-Tag header, also on a response it does not read', async () => {
    const { row } = await crawl(['/', '/hidden', '/file.pdf']);
    expect(row('/hidden').noindex).toBe(true);
    expect(row('/file.pdf').noindex).toBe(true);
    expect(row('/file.pdf').content_features).toBeNull();
    expect(row('/file.pdf').main_text_chars).toBeNull();
  });

  it('leaves noindex unknown on a URL it did not fetch', async () => {
    const { row } = await crawl(['/', '/private/x']);
    expect(row('/private/x').outcome).toBe('robots_disallowed');
    expect(row('/private/x').noindex).toBeNull();
  });

  it('keeps robots.txt whole, beside its excerpt', async () => {
    const { result } = await crawl(['/']);
    expect(result.robots[0]).toMatchObject({ body: ROBOTS, body_complete: true });
  });

  it("reads v1's X-Robots-Tag rule: every value, every token, any agent prefix", () => {
    const h = (v: string | string[]) => headerNoindex({ headers: { 'x-robots-tag': v } });
    expect(h('noindex')).toBe(true);
    expect(h('nofollow, NONE')).toBe(true);
    expect(h(['nofollow', 'bingbot: noindex'])).toBe(true);
    expect(h('noarchive, nofollow')).toBe(false);
    expect(headerNoindex({ headers: {} })).toBe(false);
  });
});
