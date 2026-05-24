import { describe, it, expect, vi } from 'vitest';
import { discoverSitemaps, parseSitemapUrls } from './sitemap.js';

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
