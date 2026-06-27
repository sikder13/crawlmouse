import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';

// SPEC 01 §1/§7: under ENGINE_V2 the engine emits a per-page fetch-outcome taxonomy and tags every
// non-gradeable (non-200) fetch as excluded_from_grade, so persistence can record crawl-health at the
// page grain. v1 emits neither (the columns stay NULL/default and prod is unchanged until the flip).
//
// Fixture: a homepage (200) that links to one healthy page (200) and one dead page (404). The 404 is
// fetched and kept as a page row with its real status (cf. the proven errServer fixture in audit.test.ts),
// so it appears in result.pages as a `dead`, grade-excluded node under v2.
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt' || path === '/sitemap.xml') {
      res.statusCode = 404;
      res.end('');
      return;
    }
    if (path === '/blocked') {
      // A throttled/blocked fetch (the §0-bug category: 403/429/503/0). Must be excluded from the
      // grade and never manufacture a false orphan/unreachable finding.
      res.statusCode = 403;
      res.setHeader('content-type', 'text/html');
      res.end('forbidden');
      return;
    }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') {
      res.end('<html><head><title>Home</title></head><body><a href="/ok">OK</a> <a href="/dead">Dead</a> <a href="/blocked">Blocked</a></body></html>');
    } else if (path === '/ok') {
      res.end('<html><head><title>OK</title></head><body><a href="/">Home</a></body></html>');
    } else {
      // /dead and anything else 404s — a non-blocking dead fetch.
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('runAudit per-page fetch outcome + grade-exclusion (SPEC 01 §1/§7)', () => {
  it('tags each output page with fetchOutcome + excludedFromGrade under ENGINE_V2', async () => {
    const result = await runAudit(
      { url: baseUrl, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true, engineV2: true },
    );

    // The 404 is fetched and recorded as a `dead`, grade-excluded node (never a graph node/orphan).
    const dead = result.pages.find((p) => p.statusCode === 404);
    expect(dead).toBeDefined();
    expect(dead!.fetchOutcome).toBe('dead');
    expect(dead!.excludedFromGrade).toBe(true);

    // The 200 pages are `ok` gradeable nodes — never excluded.
    const oks = result.pages.filter((p) => p.statusCode === 200);
    expect(oks.length).toBeGreaterThanOrEqual(2);
    expect(oks.every((p) => p.fetchOutcome === 'ok')).toBe(true);
    expect(oks.every((p) => p.excludedFromGrade === false)).toBe(true);

    // The 403 is a `blocked` fetch (the §0-bug category) — excluded from the grade. (Recorded as 403
    // or, after block-retry give-up, status 0; both classify as `blocked`, so key on the outcome.)
    const blocked = result.pages.find((p) => p.fetchOutcome === 'blocked');
    expect(blocked).toBeDefined();
    expect(blocked!.excludedFromGrade).toBe(true);

    // §0 guarantee, end-to-end: a blocked/dead (excluded) page must NEVER manufacture an orphan or
    // unreachable finding — that false-finding-on-a-throttled-fetch was the exact bug §1 kills.
    const excludedUrls = new Set(result.pages.filter((p) => p.excludedFromGrade).map((p) => p.url));
    expect(result.findings.every((f) => !f.pageUrl || !excludedUrls.has(f.pageUrl))).toBe(true);
  }, 30000);

  it('leaves fetchOutcome + excludedFromGrade undefined on the v1 path (prod-unchanged)', async () => {
    const result = await runAudit(
      { url: baseUrl, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true, engineV2: false },
    );
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages.every((p) => p.fetchOutcome === undefined)).toBe(true);
    expect(result.pages.every((p) => p.excludedFromGrade === undefined)).toBe(true);
  });
});
