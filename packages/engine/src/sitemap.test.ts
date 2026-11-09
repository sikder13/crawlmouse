import { describe, it, expect, vi } from 'vitest';
import { discoverSitemaps, parseSitemapEntries, parseSitemapUrls } from './sitemap.js';
import { isAllowedByRobots, ROBOTS_UA } from './robots.js';

describe('discoverSitemaps', () => {
  it('returns sitemaps from robots.txt when present', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return { status: 200, body: 'Sitemap: https://example.com/sitemap.xml\n' };
      }
      return { status: 404, body: '' };
    });
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
    expect(out.source).toBe('robots');
  });

  it('falls back to common paths if robots.txt has no sitemaps', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/sitemap.xml')) return { status: 200, body: '<urlset></urlset>' };
      return { status: 404, body: '' };
    });
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toContain('https://example.com/sitemap.xml');
    expect(out.source).toBe('common_path');
  });

  it('returns empty + source=none when nothing exists', async () => {
    const fetcher = vi.fn(async () => ({ status: 404, body: '' }));
    const out = await discoverSitemaps('https://example.com', { fetcher });
    expect(out.sitemapUrls).toEqual([]);
    expect(out.source).toBe('none');
  });
});

describe('parseSitemapUrls', () => {
  it('parses a simple urlset', async () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/a</loc></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`;
    const urls = await parseSitemapUrls('https://example.com/sitemap.xml', {
      fetcher: async () => ({ status: 200, body: xml }),
    });
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('follows sitemap index to children', async () => {
    const index = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/products.xml</loc></sitemap>
      </sitemapindex>`;
    const child = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/p1</loc></url>
      </urlset>`;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('products.xml')) return { status: 200, body: child };
      return { status: 200, body: index };
    });
    const urls = await parseSitemapUrls('https://example.com/sitemap.xml', { fetcher });
    expect(urls).toEqual(['https://example.com/p1']);
  });
});

describe('parseSitemapEntries', () => {
  const serve = (files: Record<string, string>) =>
    vi.fn(async (url: string) =>
      Object.hasOwn(files, url) ? { status: 200, body: files[url]! } : { status: 404, body: '' },
    );

  it('reads each <loc> with its <lastmod> as a date, and null where a url gives none', async () => {
    const fetcher = serve({
      'https://example.com/sitemap.xml': `<urlset>
        <url><loc>https://example.com/a</loc><lastmod>2026-11-05</lastmod></url>
        <url><loc>https://example.com/b</loc><lastmod>2026-10-01T08:30:00+02:00</lastmod></url>
        <url><loc>https://example.com/c</loc></url>
      </urlset>`,
    });
    expect(await parseSitemapEntries('https://example.com/sitemap.xml', { fetcher })).toEqual([
      { loc: 'https://example.com/a', lastmod: '2026-11-05' },
      { loc: 'https://example.com/b', lastmod: '2026-10-01' },
      { loc: 'https://example.com/c', lastmod: null },
    ]);
  });

  it('gives null for a <lastmod> that is not a calendar date', async () => {
    const fetcher = serve({
      'https://example.com/sitemap.xml': `<urlset>
        <url><loc>https://example.com/a</loc><lastmod>2026-02-30</lastmod></url>
        <url><loc>https://example.com/b</loc><lastmod>yesterday</lastmod></url>
        <url><loc>https://example.com/c</loc><lastmod></lastmod></url>
      </urlset>`,
    });
    const entries = await parseSitemapEntries('https://example.com/sitemap.xml', { fetcher });
    expect(entries.map((e) => e.lastmod)).toEqual([null, null, null]);
  });

  it('follows an index, keeps the cap across children, and agrees with parseSitemapUrls', async () => {
    const files = {
      'https://example.com/index.xml': `<sitemapindex>
        <sitemap><loc>https://example.com/one.xml</loc></sitemap>
        <sitemap><loc>https://example.com/two.xml</loc></sitemap>
      </sitemapindex>`,
      'https://example.com/one.xml': `<urlset>
        <url><loc>https://example.com/1</loc><lastmod>2026-01-01</lastmod></url>
        <url><loc>https://example.com/2</loc></url>
      </urlset>`,
      'https://example.com/two.xml': `<urlset>
        <url><loc>https://example.com/3</loc><lastmod>2026-03-03</lastmod></url>
        <url><loc>https://example.com/4</loc></url>
      </urlset>`,
    };
    const entries = await parseSitemapEntries('https://example.com/index.xml', {
      fetcher: serve(files),
      maxUrls: 3,
    });
    expect(entries).toEqual([
      { loc: 'https://example.com/1', lastmod: '2026-01-01' },
      { loc: 'https://example.com/2', lastmod: null },
      { loc: 'https://example.com/3', lastmod: '2026-03-03' },
    ]);
    const urls = await parseSitemapUrls('https://example.com/index.xml', {
      fetcher: serve(files),
      maxUrls: 3,
    });
    expect(urls).toEqual(entries.map((e) => e.loc));
  });
});

describe('discoverSitemaps — a robots.txt group named after an inherited property', () => {
  it.each(['__proto__', 'constructor'])(
    'User-agent: %s + Disallow does not stop discovery, and does not bind CrawlmouseBot',
    async (agent) => {
      const fetcher = vi.fn(async (url: string) =>
        url.endsWith('/robots.txt')
          ? {
              status: 200,
              body: `User-agent: ${agent}\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n`,
            }
          : { status: 404, body: '' },
      );
      const out = await discoverSitemaps('https://example.com', { fetcher });
      expect(out.sitemapUrls).toEqual(['https://example.com/sitemap.xml']);
      expect(out.source).toBe('robots');
      expect(out.robots).not.toBeNull();
      // Not isUrlAllowed: its catch turns a throwing lookup into `true`, which this would read as a pass.
      expect(isAllowedByRobots(out.robots!, ROBOTS_UA, '/anything')).toBe(true);
    },
  );
});
