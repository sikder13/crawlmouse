import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';

// ─────────────────────────────────────────────────────────────────────────────
// T1 (§0 bug, §1 node-eligibility): blocked/dead fetches must never become
// gradeable nodes and must never produce a false orphan / unreachable_page
// finding. The fixture serves 5 real interlinked 200 pages plus 3 non-200 pages
// that are discoverable ONLY via the sitemap (so today they enter the graph as
// inDegree-0 nodes and are flagged 'orphan'). After the fix they are crawl
// outcomes, not nodes: no findings, not orphaned, and the orphan dimension is
// perfect because every real page is linked.
// ─────────────────────────────────────────────────────────────────────────────
describe('T1: blocked/dead fetches are not gradeable nodes (§0/§1)', () => {
  let server: http.Server;
  let base: string;

  const sitemap = () =>
    `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    ['/', '/a', '/b', '/c', '/d', '/dead', '/forbidden', '/srverr']
      .map((p) => `<url><loc>${base}${p === '/' ? '/' : p}</loc></url>`)
      .join('') +
    `</urlset>`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        res.end(sitemap());
        return;
      }
      if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }

      // Non-200 fetches, discoverable only via the sitemap (no inbound link).
      if (path === '/dead') { res.statusCode = 404; res.end('not found'); return; }       // dead (4xx)
      if (path === '/forbidden') { res.statusCode = 403; res.end('forbidden'); return; }   // blocked (4xx)
      if (path === '/srverr') { res.statusCode = 500; res.end('server error'); return; }   // blocked (5xx → status 0)

      res.setHeader('content-type', 'text/html');
      const links: Record<string, string[]> = {
        '/': ['/a', '/b', '/c', '/d'],
        '/a': ['/b'],
        '/b': ['/a', '/c'],
        '/c': ['/d'],
        '/d': ['/a'],
      };
      const key = path === '' ? '/' : path;
      if (links[key]) {
        const as = links[key].map((h) => `<a href="${h}">${h}</a>`).join('');
        res.end(`<html><head><title>${key}</title></head><body>${as}</body></html>`);
      } else {
        res.statusCode = 404; res.end('');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('does not flag non-200 fetches, and the orphan dimension is perfect', async () => {
    const result = await runAudit(
      { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true, engineV2: true },
    );

    const nonOk = ['/dead', '/forbidden', '/srverr'].map((p) => `${base}${p}`);

    // (core) No finding references any non-200 fetch — not 'orphan', not 'unreachable_page', not anything.
    for (const url of nonOk) {
      const refs = result.findings.filter((f) => f.pageUrl === url);
      expect(refs, `no finding should reference blocked/dead ${url}`).toHaveLength(0);
    }

    // (core) Blocked/dead fetches are not orphaned nodes on the wire.
    expect(
      result.pages.filter((p) => p.statusCode !== 200).every((p) => p.isOrphan === false),
      'no non-200 page may be marked an orphan',
    ).toBe(true);

    // (core) The 5 real pages are interlinked, so the orphan dimension must be perfect:
    // blocked/dead pages must not dilute it. (Today they count as 3 orphans → score < 1.)
    expect(result.breakdown.orphanRatioScore).toBe(1);

    // (control) The genuinely linked 200 pages are never flagged orphan/unreachable.
    for (const p of ['/a', '/b', '/c', '/d']) {
      const refs = result.findings.filter(
        (f) => f.pageUrl === `${base}${p}` && (f.category === 'orphan' || f.category === 'unreachable_page'),
      );
      expect(refs, `linked 200 page ${p} must not be a false orphan/unreachable`).toHaveLength(0);
    }
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 (R1 determinism): identical clean fixture + identical cap, two runs → an
// IDENTICAL grade. Regression-lock: the engine is already order-independent for a
// fully-crawled clean site; this guards that property against future changes.
// ─────────────────────────────────────────────────────────────────────────────
describe('T2: determinism on a clean crawl, same cap (R1)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      const links: Record<string, string[]> = {
        '/': ['/a', '/b', '/c'], '/a': ['/b', '/c'], '/b': ['/a', '/c'], '/c': ['/a', '/b'],
      };
      const key = path === '' ? '/' : path;
      if (links[key]) {
        res.end(`<html><head><title>${key}</title></head><body>${links[key].map((h) => `<a href="${h}">link ${h}</a>`).join('')}</body></html>`);
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('produces an identical grade across two runs', async () => {
    const opts = { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;
    const a = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
    const b = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });

    expect(b.score).toBe(a.score);
    expect(b.grade).toBe(a.grade);
    expect(b.breakdown).toEqual(a.breakdown);

    // Findings are the same SET (order is not contractually deterministic).
    const sortFindings = (fs: typeof a.findings) =>
      [...fs].map((f) => `${f.category}|${f.pageUrl ?? ''}`).sort();
    expect(sortFindings(b.findings)).toEqual(sortFindings(a.findings));
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 (R2 cap-independence, site fits): a site smaller than both caps is fully
// crawled at 500 and 2000, so the grade must be within ±2. Regression-lock.
// ─────────────────────────────────────────────────────────────────────────────
describe('T3: cap-independence when the site fits, cap 500 vs 2000 (R2)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      const links: Record<string, string[]> = {
        '/': ['/a', '/b', '/c'], '/a': ['/b', '/c'], '/b': ['/a', '/c'], '/c': ['/a', '/b'],
      };
      const key = path === '' ? '/' : path;
      if (links[key]) {
        res.end(`<html><head><title>${key}</title></head><body>${links[key].map((h) => `<a href="${h}">link ${h}</a>`).join('')}</body></html>`);
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('grade is within ±2 across caps when the site fits', async () => {
    const common = { url: base, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;
    const at500 = await runAudit({ ...common, pageCap: 500 }, { allowPrivateIpsForTesting: true, engineV2: true });
    const at2000 = await runAudit({ ...common, pageCap: 2000 }, { allowPrivateIpsForTesting: true, engineV2: true });

    // The whole site (4 pages) fits within both caps → identical sample → grade within ±2.
    expect(Math.abs(at500.score - at2000.score)).toBeLessThanOrEqual(2);
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 (§2 URL identity) — stubs, implemented in Task 8.
// ─────────────────────────────────────────────────────────────────────────────
describe('T5: URL identity & canonicalization (§2)', () => {
  it.todo('collapses trailing-slash variants (/x and /x/) to one node');
  it.todo('strips tracking params (utm_*, gclid, fbclid, mc_*, ref) so /x?utm_source=a === /x');
  it.todo('consolidates a rel=canonical target so the canonicalised-away URL is not a separate node');
  it.todo('unifies www vs non-www to the homepage’s resolved host');
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 (§5 politeness vs the 300s budget) — stubs, implemented in Task 9.
// ─────────────────────────────────────────────────────────────────────────────
describe('T6: politeness vs the 240s/300s budget (§5)', () => {
  it.todo('honors robots.txt crawl-delay as a minimum');
  it.todo('honors a 429 Retry-After header as a minimum');
  it.todo('a slow ~600-page host stops at the 240s budget, marks the crawl partial, and never exceeds 300s');
});
