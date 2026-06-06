import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { runAudit } from './audit.js';

let server: http.Server;
let baseUrl: string;

const sitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>BASE/</loc></url>
  <url><loc>BASE/a</loc></url>
  <url><loc>BASE/b</loc></url>
  <url><loc>BASE/orphan</loc></url>
  <url><loc>BASE/cart</loc></url>
</urlset>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      res.end(sitemap.replaceAll('BASE', baseUrl));
      return;
    }
    if (path === '/robots.txt') {
      res.statusCode = 404; res.end(''); return;
    }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') {
      res.end(`<html><head><title>Home</title></head><body>
        <a href="/a">A</a><a href="/b">B</a>
      </body></html>`);
    } else if (path === '/a') {
      res.end(`<html><head><title>A</title></head><body><a href="/b">B</a></body></html>`);
    } else if (path === '/b') {
      res.end(`<html><head><title>B</title></head><body></body></html>`);
    } else if (path === '/orphan') {
      res.end(`<html><head><title>Orphan</title></head><body></body></html>`);
    } else if (path === '/cart') {
      // In-degree 0 (nothing links to it) AND a generic CMS-excluded path. It must
      // produce NO finding — not 'orphan' and not 'unreachable_page'.
      res.end(`<html><head><title>Cart</title></head><body></body></html>`);
    } else {
      res.statusCode = 404; res.end('');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runAudit', () => {
  it('produces a complete AuditResult', async () => {
    const result = await runAudit({
      url: baseUrl,
      pageCap: 50,
      perHostConcurrency: 2,
      staggerMs: 0,
      pageTimeoutMs: 5000,
    }, { allowPrivateIpsForTesting: true });

    expect(result.url).toBe(baseUrl);
    expect(result.cms).toBe('custom');
    expect(result.pages.length).toBe(5);
    expect(result.findings.some((f) => f.category === 'orphan')).toBe(true);
    expect(['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']).toContain(result.grade);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);

    // The CMS-excluded orphan (/cart) must not surface as ANY finding —
    // not 'orphan' (it's excluded) and not 'unreachable_page' (no double-flag).
    const cartUrl = `${baseUrl}/cart`;
    expect(result.findings.some((f) => f.pageUrl === cartUrl)).toBe(false);
    // The real orphan is still flagged exactly once, and never double-flagged.
    const orphanUrl = `${baseUrl}/orphan`;
    const orphanFindings = result.findings.filter((f) => f.pageUrl === orphanUrl);
    expect(orphanFindings).toHaveLength(1);
    expect(orphanFindings[0]!.category).toBe('orphan');
  });

  // A1 + A1b end-to-end on a real site that 30x-downgrades deep paths https->http.
  // runAudit must (a) crawl deep (A1 same-hostname) and (b) pin every page identity to
  // the homepage's actual scheme (A1b), so the downgraded pages don't form a second,
  // fully-orphaned identity set. Requires network.
  it('audits a scheme-downgrading site with one consistent identity (A1/A1b)', async () => {
    const result = await runAudit({
      url: 'https://quotes.toscrape.com/',
      pageCap: 30,
      perHostConcurrency: 4,
      staggerMs: 0,
      pageTimeoutMs: 15000,
    });
    expect(result.pages.length).toBeGreaterThan(5);
    // Homepage stays https; every stored page identity is pinned to that one scheme.
    expect(result.pages.every((p) => p.url.startsWith('https://'))).toBe(true);
    // The graph is genuinely connected (a scheme split would orphan nearly everything).
    const orphans = result.pages.filter((p) => p.isOrphan).length;
    expect(orphans).toBeLessThan(result.pages.length / 2);
  }, 60000);
});

describe('runAudit low-confidence coverage floor (A3)', () => {
  let tinyServer: http.Server;
  let tinyBase: string;

  beforeAll(async () => {
    tinyServer = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') {
        res.statusCode = 404;
        res.end('');
        return;
      }
      res.setHeader('content-type', 'text/html');
      if (path === '/' || path === '') {
        res.end('<html><head><title>Tiny</title></head><body><a href="/a">A</a></body></html>');
      } else if (path === '/a') {
        res.end('<html><head><title>A</title></head><body></body></html>');
      } else {
        res.statusCode = 404;
        res.end('');
      }
    });
    await new Promise<void>((r) => tinyServer.listen(0, '127.0.0.1', r));
    tinyBase = `http://127.0.0.1:${(tinyServer.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => tinyServer.close(() => r()));
  });

  it('emits incomplete_crawl and withholds a high grade when too few pages are reached', async () => {
    const result = await runAudit(
      { url: tinyBase, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true },
    );
    // Only 2 pages reachable -> below the coverage floor.
    expect(result.pages.length).toBeLessThan(5);
    const incomplete = result.findings.filter((f) => f.category === 'incomplete_crawl');
    expect(incomplete).toHaveLength(1);
    // A 2-page crawl must not be certified as an A (it scored 97 "A" before A3).
    expect(['A', 'A-']).not.toContain(result.grade);
  });
});

describe('runAudit coverage floor counts only successfully-fetched pages (A3 errored crawl)', () => {
  let errServer: http.Server;
  let errBase: string;

  beforeAll(async () => {
    errServer = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') {
        res.statusCode = 404;
        res.end('');
        return;
      }
      if (path === '/' || path === '') {
        // Homepage loads (200) and links to four siblings that all fail (404).
        res.setHeader('content-type', 'text/html');
        res.end('<html><head><title>Broken</title></head><body><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a></body></html>');
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r));
    errBase = `http://127.0.0.1:${(errServer.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => errServer.close(() => r()));
  });

  it('flags an errored crawl (1 real page + several failed fetches) as incomplete', async () => {
    const result = await runAudit(
      { url: errBase, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true },
    );
    // Five page rows total (1 OK + 4 failed) would slip past a naive length>=5 check, but only
    // ONE page actually fetched successfully, so the coverage floor must still trip.
    const successful = result.pages.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length;
    expect(successful).toBeLessThan(5);
    expect(result.findings.filter((f) => f.category === 'incomplete_crawl')).toHaveLength(1);
    expect(['A', 'A-']).not.toContain(result.grade);
  });
});

// A real cross-SCHEME redirect (https->http) needs TLS, which is impractical in a unit test, so
// the audit-level A1b threading is proven end-to-end only by the live quotes.toscrape test above.
// This deterministic source-guard catches the cheap regression that test couldn't run offline to
// catch: dropping the homepage-scheme derivation or failing to thread it into the crawl.
describe('runAudit threads the homepage scheme into the crawl (A1b source guard)', () => {
  const src = readFileSync(new URL('./audit.ts', import.meta.url), 'utf8');

  it('derives canonicalScheme from the homepage finalUrl', () => {
    expect(src).toMatch(/canonicalScheme\s*=\s*new URL\(\s*homepageRes\.finalUrl\s*\)\.protocol/);
  });

  it('passes canonicalScheme into runCrawl', () => {
    // The runCrawl call passes it via object shorthand (`canonicalScheme,`); the derivation uses
    // `canonicalScheme =`. Matching the shorthand asserts the value is actually threaded through.
    expect(src).toMatch(/runCrawl\(\{[\s\S]*\bcanonicalScheme,[\s\S]*\}\)/);
  });
});
