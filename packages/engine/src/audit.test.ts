import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
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
});
