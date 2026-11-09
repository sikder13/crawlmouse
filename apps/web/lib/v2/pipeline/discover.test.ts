import { describe, expect, it } from 'vitest';
import type { safeFetch } from '@crawlmouse/engine/v2/pipeline';
import { discoverSeeds } from './discover';
import { DISCOVER_S, SITEMAP_URL_CAP } from './limits';

type Fetch = typeof safeFetch;
const UA = 'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';

const urlset = (locs: string[]) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc><lastmod>2026-11-01</lastmod></url>`).join('')}</urlset>`;

/** A site served from a map of URL → body; every request is recorded with its options. */
function site(pages: Record<string, string>, clock = { now: 0 }, stepMs = 0) {
  const requests: { url: string; opts: Parameters<Fetch>[1] }[] = [];
  const fetch = (async (url: string, opts?: Parameters<Fetch>[1]) => {
    requests.push({ url, opts });
    clock.now += stepMs;
    const body = pages[url];
    return { status: body === undefined ? 404 : 200, body: body ?? '', headers: {}, finalUrl: url };
  }) as Fetch;
  return { requests, deps: { fetch, userAgent: UA, now: () => clock.now } };
}

describe('discoverSeeds (Q8)', () => {
  it('seeds the homepage and the sitemaps robots.txt names, as our crawler', async () => {
    const { deps, requests } = site({
      'https://example.com/robots.txt':
        'User-agent: *\nAllow: /\nSitemap: https://example.com/index.xml\n',
      'https://example.com/index.xml':
        '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>',
      'https://example.com/a.xml': urlset(['https://example.com/', 'https://example.com/p/1']),
      'https://example.com/b.xml': urlset(['https://example.com/p/2', 'https://example.com/p/1']),
    });
    const out = await discoverSeeds('https://example.com', deps);
    expect(out.seeds).toEqual([
      { url: 'https://example.com', source: 'homepage', lastmod: null },
      { url: 'https://example.com', source: 'sitemap', lastmod: null },
      { url: 'https://example.com/p/1', source: 'sitemap', lastmod: null },
      { url: 'https://example.com/p/2', source: 'sitemap', lastmod: null },
    ]);
    expect(out.sitemapUrls).toBe(4);
    expect(requests.map((r) => r.url)).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/index.xml',
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ]);
    for (const r of requests) expect(r.opts?.userAgent).toBe(UA);
  });

  it('keeps http(s) locations only', async () => {
    const { deps } = site({
      'https://example.com/sitemap.xml': urlset([
        'ftp://example.com/x',
        'not a url',
        'https://example.com/ok',
      ]),
    });
    const { seeds } = await discoverSeeds('https://example.com', deps);
    expect(seeds.map((s) => s.url)).toEqual(['https://example.com', 'https://example.com/ok']);
  });

  it('reads at most SITEMAP_URL_CAP locations', async () => {
    const locs = Array.from(
      { length: SITEMAP_URL_CAP + 700 },
      (_, i) => `https://example.com/p/${i}`,
    );
    const { deps } = site({ 'https://example.com/sitemap.xml': urlset(locs) });
    const out = await discoverSeeds('https://example.com', deps);
    expect(out.sitemapUrls).toBe(SITEMAP_URL_CAP);
    expect(out.seeds).toHaveLength(SITEMAP_URL_CAP + 1);
  });

  it('stops fetching once DISCOVER_S has passed', async () => {
    const clock = { now: 0 };
    const children = Array.from({ length: 10 }, (_, i) => `https://example.com/s${i}.xml`);
    const pages: Record<string, string> = {
      'https://example.com/sitemap.xml': `<sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join('')}</sitemapindex>`,
    };
    for (const [i, c] of children.entries()) pages[c] = urlset([`https://example.com/p/${i}`]);
    // Each request takes a fifth of the bound: robots.txt (absent), /sitemap.xml found at the common
    // path, the same index read as a sitemap, then two children; the third child finds no time left.
    const { deps, requests } = site(pages, clock, (DISCOVER_S * 1000) / 5);
    const out = await discoverSeeds('https://example.com', deps);
    expect(requests).toHaveLength(5);
    expect(out.seeds.map((s) => s.url)).toEqual([
      'https://example.com',
      'https://example.com/p/0',
      'https://example.com/p/1',
    ]);
    for (const r of requests) {
      expect(r.opts?.totalDeadlineMs).toBeGreaterThan(0);
      expect(r.opts?.totalDeadlineMs).toBeLessThanOrEqual(10_000);
    }
  });
});
