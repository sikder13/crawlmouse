import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';
import type { CrawlActivity } from '@crawlmouse/types';

// SPEC 04 §2 — the onProgress emission seam (the ONE sanctioned engine touch). Two contracts:
//   1. HONESTY: every emitted event reflects a real pipeline step (a fetched page, a discovered
//      sitemap, a real phase transition) — pagesFetched counts actual stored pages.
//   2. NO-OP PIN: with the callback ABSENT the audit result is IDENTICAL — the seam adds zero
//      behavior. A throwing listener must also never break the audit (emission is best-effort).
let server: http.Server;
let baseUrl: string;
let sitemapServer: http.Server;
let sitemapBaseUrl: string;

const page = (links: string[], title: string) =>
  `<html><head><title>${title}</title></head><body>${links
    .map((h) => `<a href="${h}">go to ${h}</a>`)
    .join(' ')}</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') { res.end(page(['/a', '/b'], 'home')); return; }
    if (path === '/a') { res.end(page(['/b'], 'a')); return; }
    if (path === '/b') { res.end(page(['/'], 'b')); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // A sitemap-bearing fixture for the sitemap_seeded event.
  sitemapServer = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
    if (path === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>SITE/</loc></url><url><loc>SITE/a</loc></url><url><loc>SITE/b</loc></url>
      </urlset>`.replaceAll('SITE', sitemapBaseUrl));
      return;
    }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') { res.end(page(['/a', '/b'], 'home')); return; }
    if (path === '/a' || path === '/b') { res.end(page(['/'], path.slice(1))); return; }
    res.statusCode = 404; res.end('not found');
  });
  await new Promise<void>((r) => sitemapServer.listen(0, '127.0.0.1', r));
  sitemapBaseUrl = `http://127.0.0.1:${(sitemapServer.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => sitemapServer.close(() => r()));
});

const OPTS = { pageCap: 10, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 };
const FLAGS = { allowPrivateIpsForTesting: true, engineV2: true };

/** Result fields that must be identical with/without the listener (timestamps excluded). */
function comparable(r: Awaited<ReturnType<typeof runAudit>>) {
  return {
    grade: r.grade,
    score: r.score,
    // breakdown + crawlHealth catch a seam-induced drift in the component scores or crawl-health
    // metrics that grade/score alone could mask.
    breakdown: r.breakdown,
    crawlHealth: r.crawlHealth,
    pages: [...r.pages].sort((a, b) => a.url.localeCompare(b.url)),
    links: [...r.links].sort((a, b) => (a.fromUrl + a.toUrl).localeCompare(b.fromUrl + b.toUrl)),
    findings: r.findings,
    cms: r.cms,
  };
}

describe('engine onProgress emission (SPEC 04 §2)', () => {
  it('emits real fetch_ok events with a monotonically non-decreasing pagesFetched count and phase transitions', async () => {
    const events: CrawlActivity[] = [];
    await runAudit({ url: baseUrl, ...OPTS, onProgress: (a) => events.push(a) }, FLAGS);

    const fetches = events.filter((e) => e.kind === 'fetch_ok');
    expect(fetches.length).toBeGreaterThanOrEqual(3); // home + /a + /b actually crawled
    // pagesFetched counts REAL stored pages, never a timer: non-decreasing, ends at the crawl size.
    const counts = fetches.map((e) => e.pagesFetched ?? 0);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] ?? 0);
    expect(counts[counts.length - 1]).toBe(3);
    // Every event carries a plain-language label.
    for (const e of events) expect(typeof e.label).toBe('string');
    // Real phase transitions only: crawling (before the crawl) then analyzing (after it).
    const phases = events.filter((e) => e.kind === 'phase').map((e) => e.phase);
    expect(phases).toContain('crawling');
    expect(phases).toContain('analyzing');
    expect(phases.indexOf('crawling')).toBeLessThan(phases.indexOf('analyzing'));
    // The grade NEVER rides the activity stream (it belongs to the terminal done payload).
    for (const e of events) expect(e.label).not.toMatch(/grade\s*[A-F]\b/i);
  }, 30000);

  it('emits sitemap_seeded with the honest sitemap-derived estimatedTotal when a sitemap exists', async () => {
    const events: CrawlActivity[] = [];
    await runAudit({ url: sitemapBaseUrl, ...OPTS, onProgress: (a) => events.push(a) }, FLAGS);
    const seeded = events.find((e) => e.kind === 'sitemap_seeded');
    expect(seeded).toBeDefined();
    expect(seeded!.estimatedTotal).toBe(3); // exactly what the sitemap listed — never inflated
  }, 30000);

  it('NO-OP PIN: an absent onProgress produces an identical audit result (the seam adds zero behavior)', async () => {
    const withCb = await runAudit({ url: baseUrl, ...OPTS, onProgress: () => {} }, FLAGS);
    const without = await runAudit({ url: baseUrl, ...OPTS }, FLAGS);
    expect(comparable(withCb)).toEqual(comparable(without));
  }, 30000);

  it('a THROWING listener never breaks the audit (emission is best-effort, swallowed)', async () => {
    const result = await runAudit(
      { url: baseUrl, ...OPTS, onProgress: () => { throw new Error('listener exploded'); } },
      FLAGS,
    );
    expect(result.grade).toBeTruthy();
    expect(result.pages.length).toBe(3);
  }, 30000);
});
