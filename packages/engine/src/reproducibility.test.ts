import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';
import { LOW_CONFIDENCE_SCORE_CAP, MIN_COVERAGE_PAGES } from './constants.js';

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
// §3 semantic lock (v2): a 200 page reachable ONLY via the sitemap (no inbound link) is an
// `orphan`, NEVER a `deep_page`, and has null depth — proving depth stays homepage-rooted and a
// missing link path never manufactures a depth finding. Reachable pages keep finite,
// homepage-rooted depths. (Regression-lock for the §3 behavior the node-eligibility fix delivers;
// confirms the spec correction: reachability is multi-source, depth is homepage-rooted.)
// ─────────────────────────────────────────────────────────────────────────────
describe('§3: sitemap-only 200 page is an orphan (not deep_page); depth is homepage-rooted (v2)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        res.end(
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            ['/', '/a', '/b', '/c', '/lonely'].map((p) => `<url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('') +
            `</urlset>`,
        );
        return;
      }
      if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      // A reachable chain from the homepage (depths 1,2,3 — none "too deep"), plus /lonely, which
      // is in the sitemap only and linked from nowhere.
      const links: Record<string, string[]> = { '/': ['/a'], '/a': ['/b'], '/b': ['/c'], '/c': ['/'], '/lonely': [] };
      const key = path === '' ? '/' : path;
      if (links[key] !== undefined) {
        res.end(`<html><head><title>${key}</title></head><body>${links[key].map((h) => `<a href="${h}">${h}</a>`).join('')}</body></html>`);
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('flags the sitemap-only page as orphan, never deep_page, with null depth', async () => {
    const result = await runAudit(
      { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true, engineV2: true },
    );
    const lonely = `${base}/lonely`;

    // Reachable only via the sitemap, no inbound link → exactly one finding: 'orphan'.
    const lonelyFindings = result.findings.filter((f) => f.pageUrl === lonely);
    expect(lonelyFindings.map((f) => f.category)).toEqual(['orphan']);
    // Null BFS depth must NOT manufacture a deep_page finding (the spec's "orphan, not deep page").
    expect(result.findings.some((f) => f.category === 'deep_page' && f.pageUrl === lonely)).toBe(false);

    // Depth is homepage-rooted: the orphan has no link path from home → null depth + isOrphan.
    const lonelyPage = result.pages.find((p) => p.url === lonely);
    expect(lonelyPage?.depth).toBeNull();
    expect(lonelyPage?.isOrphan).toBe(true);

    // The genuinely reachable pages keep finite, homepage-rooted depths and are not orphans.
    for (const p of ['/a', '/b', '/c']) {
      const page = result.pages.find((x) => x.url === `${base}${p}`);
      expect(page?.isOrphan, `${p} is reachable, not an orphan`).toBe(false);
      expect(typeof page?.depth, `${p} has a finite homepage-rooted depth`).toBe('number');
    }
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 deterministic seed truncation (v2): when the sitemap lists MORE URLs than the page cap, the
// same cap must select the same subset run-to-run, chosen by (canonicalUrl ASC) and independent
// of the sitemap's own ordering. The sitemap below is in REVERSE order on purpose: a sitemap-order
// slice keeps /p7../p5, while the (sorted) v2 slice keeps /p0../p2. (Link-discovered crawl-frontier
// determinism is a separate crawler task tracked with T4 — this covers only the seed path.)
// ─────────────────────────────────────────────────────────────────────────────
describe('§3: deterministic (URL-ordered) seed truncation when the sitemap exceeds the cap (v2)', () => {
  let server: http.Server;
  let base: string;
  const PATHS = ['/p0', '/p1', '/p2', '/p3', '/p4', '/p5', '/p6', '/p7'];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        // Reverse order, to prove the subset is chosen by URL sort, not sitemap order.
        const locs = ['/', ...[...PATHS].reverse()]
          .map((p) => `<url><loc>${base}${p === '/' ? '/' : p}</loc></url>`)
          .join('');
        res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`);
        return;
      }
      if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
      // Standalone pages (no inter-links): the only discovery path is the sitemap seed list, so the
      // page-cap truncation acts purely on the (sorted) seeds.
      res.setHeader('content-type', 'text/html');
      res.end(`<html><head><title>${path}</title></head><body>page ${path}</body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('selects the same lexicographically-first subset on every run', async () => {
    const opts = { url: base, pageCap: 4, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;
    const run1 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
    const run2 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });

    const urls = (r: typeof run1) => r.pages.map((p) => p.url).sort();
    // Deterministic run-to-run, AND the URL-sorted-first cap (homepage + /p0,/p1,/p2),
    // NOT the sitemap-order head (/p7,/p6,/p5).
    expect(urls(run2)).toEqual(urls(run1));
    expect(urls(run1)).toEqual([base, `${base}/p0`, `${base}/p1`, `${base}/p2`]);
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 crawl-health & confidence (v2): the result carries an honest crawl-health summary so a poorly
// reached / heavily-blocked crawl is never presented as a confident grade. Here 2 of 4 fetches are
// blocked (429 + a 5xx that surfaces as status 0) → block_rate 0.5, coverage 0.5 → confidence low.
// On the v1 path crawlHealth is absent (result shape unchanged).
// ─────────────────────────────────────────────────────────────────────────────
describe('§6: crawl-health & confidence on the result (v2)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        res.end(
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            ['/', '/a', '/blocked', '/reset'].map((p) => `<url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('') +
            `</urlset>`,
        );
        return;
      }
      if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
      if (path === '/blocked') { res.statusCode = 429; res.end('slow down'); return; } // blocked
      if (path === '/reset') { res.statusCode = 500; res.end('boom'); return; }        // 5xx → status 0 → blocked
      res.setHeader('content-type', 'text/html');
      const links: Record<string, string[]> = { '/': ['/a'], '/a': ['/'] };
      const key = path === '' ? '/' : path;
      if (links[key]) {
        res.end(`<html><head><title>${key}</title></head><body>${links[key].map((h) => `<a href="${h}">${h}</a>`).join('')}</body></html>`);
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('reports counts + low confidence under v2, and is absent under v1', async () => {
    const opts = { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;

    const v2 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
    expect(v2.crawlHealth).toBeDefined();
    const h = v2.crawlHealth!;
    expect(h.fetchedOk).toBe(2); // / and /a
    expect(h.blocked).toBe(2); // 429 + 5xx(→0)
    expect(h.dead).toBe(0);
    expect(h.attempted).toBe(4);
    expect(h.coveragePct).toBeCloseTo(0.5, 5); // 2 ok / 4 discovered
    expect(h.blockRate).toBeCloseTo(0.5, 5); // 2 blocked / 4 attempted
    expect(h.confidence).toBe('low');

    // v1 path: no crawlHealth (legacy result shape preserved).
    const v1 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true });
    expect(v1.crawlHealth).toBeUndefined();
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 grade-gating (v2, Task 7b): a LOW-confidence crawl must not be certified a confident grade,
// even when the structure is perfect. Here 6 well-linked 200 pages (zero orphans → orphan
// dimension perfect, depth 1) are crawled alongside 2 blocked fetches → block_rate 0.25 → low
// confidence. pageCount (6) is above the thin-crawl floor, so the cap fires PURELY on confidence,
// and an `incomplete_crawl` caveat explains it. Findings are caveated, not suppressed.
// ─────────────────────────────────────────────────────────────────────────────
describe('§6: low confidence caps an otherwise-good grade and caveats it (v2)', () => {
  let server: http.Server;
  let base: string;
  const OK = ['/a', '/b', '/c', '/d', '/e'];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        res.end(
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            ['/', ...OK, '/b1', '/b2'].map((p) => `<url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('') +
            `</urlset>`,
        );
        return;
      }
      if (path === '/robots.txt') { res.statusCode = 404; res.end(''); return; }
      if (path === '/b1') { res.statusCode = 429; res.end('slow down'); return; }
      if (path === '/b2') { res.statusCode = 500; res.end('boom'); return; }
      res.setHeader('content-type', 'text/html');
      if (path === '/' || path === '') {
        // Homepage links to all five children (each thus has an inbound link → no orphans).
        res.end(`<html><head><title>Home</title></head><body>${OK.map((h) => `<a href="${h}">${h}</a>`).join('')}</body></html>`);
      } else if (OK.includes(path)) {
        res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('caps the score on low confidence despite a perfect orphan/depth structure', async () => {
    const result = await runAudit(
      { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true, engineV2: true },
    );

    expect(result.crawlHealth?.confidence).toBe('low');
    expect(result.crawlHealth?.fetchedOk).toBe(6); // 6 ≥ MIN_COVERAGE_PAGES → NOT the thin-crawl cap

    // Structure is genuinely good — so the low score is the CONFIDENCE cap, not bad linking.
    expect(result.breakdown.orphanRatioScore).toBe(1);
    expect(result.breakdown.depthScore).toBe(1);

    // Capped: an A/A- is impossible on a low-confidence crawl.
    expect(result.score).toBeLessThanOrEqual(LOW_CONFIDENCE_SCORE_CAP);
    expect(['A', 'A-']).not.toContain(result.grade);

    // Caveated (not suppressed): one incomplete_crawl finding explains why, carrying the reason.
    const caveats = result.findings.filter((f) => f.category === 'incomplete_crawl');
    expect(caveats).toHaveLength(1);
    expect(caveats[0]!.payload).toMatchObject({ confidence: 'low' });
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 (§2 URL identity). 8a: trailing-slash (always) + tracking-param (v2) collapse to one node.
// 8b (todo): www/non-www unify + rel=canonical.
// ─────────────────────────────────────────────────────────────────────────────
describe('T5: URL identity & canonicalization (§2)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname === '/robots.txt' || pathname === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      if (pathname === '/' || pathname === '') {
        // The homepage links to the SAME page three ways: bare, trailing-slash, and campaign-tagged.
        res.end(
          '<html><head><title>Home</title></head><body>' +
            '<a href="/page">a</a><a href="/page/">b</a><a href="/page?utm_source=nl">c</a></body></html>',
        );
      } else if (pathname === '/page' || pathname === '/page/') {
        res.end('<html><head><title>Page</title></head><body><a href="/">home</a></body></html>');
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('collapses trailing-slash + tracking-param URL identities under v2 (v1 keeps the tracking variant)', async () => {
    const opts = { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;

    const v2 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
    // One page node for the target (no /page/ or ?utm variant).
    expect(v2.pages.filter((p) => p.url.includes('/page')).length).toBe(1);
    expect(v2.pages.some((p) => p.url.includes('utm_source'))).toBe(false);
    // The IDENTITY layer is what §2 fixes: no link edge carries a trailing slash or a tracking param.
    expect(v2.links.every((l) => !l.toUrl.includes('utm_source') && !l.toUrl.endsWith('/page/'))).toBe(true);

    // v1 does not strip tracking params, so the campaign-tagged link target survives as a distinct
    // identity (a duplicate edge whose node is dropped — the double-counting §2 eliminates).
    const v1 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true });
    expect(v1.links.some((l) => l.toUrl.includes('utm_source'))).toBe(true);
  }, 45000);

  // www/non-www unification (§2) can't be exercised on a single loopback host (no real www
  // sibling); it is unit-tested in url-canonical.test.ts (the `unifyHost` rule) and threaded into
  // the audit via identityOpts under v2.
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 (§2 rel=canonical): a same-host page declaring a DIFFERENT canonical is consolidated onto it
// under v2 (not a separate node); v1 keeps it distinct.
// ─────────────────────────────────────────────────────────────────────────────
describe('T5: rel=canonical consolidation (§2)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname === '/robots.txt' || pathname === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      if (pathname === '/' || pathname === '') {
        res.end('<html><head><title>Home</title></head><body><a href="/main">m</a><a href="/variant">v</a></body></html>');
      } else if (pathname === '/main') {
        res.end('<html><head><title>Main</title></head><body><a href="/">home</a></body></html>');
      } else if (pathname === '/variant') {
        // Declares /main as canonical → consolidates onto /main under v2.
        res.end('<html><head><title>Variant</title><link rel="canonical" href="/main"></head><body><a href="/">home</a></body></html>');
      } else { res.statusCode = 404; res.end(''); }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it('consolidates the canonicalised-away page onto its canonical under v2 (v1 keeps it separate)', async () => {
    const opts = { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;

    const v2 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
    expect(v2.pages.some((p) => p.url.endsWith('/main'))).toBe(true);
    expect(v2.pages.some((p) => p.url.endsWith('/variant'))).toBe(false); // consolidated away

    const v1 = await runAudit({ ...opts }, { allowPrivateIpsForTesting: true });
    expect(v1.pages.some((p) => p.url.endsWith('/variant'))).toBe(true); // distinct node on v1
  }, 45000);
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 (§5 politeness vs the 240s/300s budget). All three run on the ENGINE_V2 path;
// each asserts a v1 contrast so the behavior is provably flag-gated.
// ─────────────────────────────────────────────────────────────────────────────
describe('T6: politeness vs the 240s/300s budget (§5)', () => {
  it('honors robots.txt crawl-delay as a minimum (v2 spaces requests; v1 does not)', async () => {
    const server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt') {
        res.setHeader('content-type', 'text/plain');
        res.end('User-agent: *\nCrawl-delay: 1');
        return;
      }
      if (path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      res.setHeader('content-type', 'text/html');
      if (path === '/' || path === '') {
        res.end('<html><head><title>H</title></head><body><a href="/a">a</a><a href="/b">b</a></body></html>');
        return;
      }
      res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const opts = { url: base, pageCap: 50, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 } as const;

      const t0 = Date.now();
      await runAudit({ ...opts }, { allowPrivateIpsForTesting: true, engineV2: true });
      const v2Elapsed = Date.now() - t0;

      const t1 = Date.now();
      await runAudit({ ...opts }, { allowPrivateIpsForTesting: true }); // v1
      const v1Elapsed = Date.now() - t1;

      // v2 honors Crawl-delay: 1 → the 3 crawler fetches (/, /a, /b) are serialized ≥1s apart (≥2 gaps).
      expect(v2Elapsed).toBeGreaterThanOrEqual(1700);
      // and it is at least ~2 delays slower than the v1 crawl, which ignores Crawl-delay.
      expect(v2Elapsed - v1Elapsed).toBeGreaterThanOrEqual(1500);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20000);

  it('honors a 429 Retry-After header as a minimum, then recovers the page (bounded)', async () => {
    const slowHits: number[] = [];
    const server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      if (path === '/slow') {
        slowHits.push(Date.now());
        if (slowHits.length === 1) {
          res.statusCode = 429;
          res.setHeader('retry-after', '1');
          res.end('slow down');
          return;
        }
        res.setHeader('content-type', 'text/html');
        res.end('<html><head><title>slow</title></head><body><a href="/">home</a></body></html>');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end('<html><head><title>H</title></head><body><a href="/slow">s</a></body></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const t0 = Date.now();
      const result = await runAudit(
        { url: base, pageCap: 50, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 },
        { allowPrivateIpsForTesting: true, engineV2: true },
      );
      const elapsed = Date.now() - t0;

      // recovered: the once-429'd page is retried and ends up a 200 node.
      expect(result.pages.find((p) => p.url.endsWith('/slow'))?.statusCode).toBe(200);
      // honored as a minimum: the retry waited ≥ ~1s after the 429.
      expect(slowHits.length).toBeGreaterThanOrEqual(2);
      expect(slowHits[1]! - slowHits[0]!).toBeGreaterThanOrEqual(900);
      // bounded — a small Retry-After resolves promptly, never hangs.
      expect(elapsed).toBeLessThan(15000);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 20000);

  it('stops a slow many-page host at the budget, marks it partial under v2 (v1 throws)', async () => {
    const N = 60;
    const server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      if (path === '/' || path === '') {
        const links = Array.from({ length: N }, (_, i) => `<a href="/p${i + 1}">p${i + 1}</a>`).join('');
        res.setHeader('content-type', 'text/html');
        res.end(`<html><head><title>H</title></head><body>${links}</body></html>`);
        return;
      }
      // Each deep page is slow, so the full crawl cannot finish inside the small test budget.
      res.on('error', () => {});
      setTimeout(() => {
        try {
          if (res.writableEnded) return;
          res.setHeader('content-type', 'text/html');
          res.end(`<html><head><title>${path}</title></head><body><a href="/">home</a></body></html>`);
        } catch { /* socket torn down on budget exhaustion */ }
      }, 150);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const opts = { url: base, pageCap: 100, perHostConcurrency: 2, staggerMs: 0, pageTimeoutMs: 5000 } as const;

      const t0 = Date.now();
      const result = await runAudit(
        { ...opts },
        { allowPrivateIpsForTesting: true, engineV2: true, maxCrawlMsForTesting: 1500 },
      );
      const elapsed = Date.now() - t0;

      // Graceful partial: resolves (no throw), flagged partial, the whole site was NOT crawled,
      // a grade is still produced, and it stops well under the 300s function ceiling.
      expect(result.crawlHealth?.partial).toBe(true);
      expect(result.pages.length).toBeLessThan(N);
      expect(result.grade).toBeTruthy();
      expect(elapsed).toBeLessThan(10000);

      // v1 keeps the Issue-2b contract: budget exhaustion is a hard, classified timeout (throws).
      await expect(
        runAudit({ ...opts }, { allowPrivateIpsForTesting: true, maxCrawlMsForTesting: 1500 }),
      ).rejects.toThrow(/timed out|timeout/i);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30000);

  it('certifies a budget-exhausted deep-chain crawl as low-confidence + caveated (high coverage is a mirage)', async () => {
    // A deep CHAIN: each page links ONLY to the next, so the crawl is serial and the un-crawled tail
    // is never DISCOVERED → coverage (fetchedOk/discovered) reads ~1.0 even though we saw a fraction of
    // the site. Without budget→low-confidence this would be graded a confident A–F on a partial crawl.
    const N = 80;
    const server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
      const n = path === '/' || path === '' ? 0 : (/^\/(\d+)$/.exec(path) ? Number(/^\/(\d+)$/.exec(path)![1]) : -1);
      if (n < 0) { res.statusCode = 404; res.end(''); return; }
      res.on('error', () => {});
      setTimeout(() => {
        try {
          if (res.writableEnded) return;
          res.setHeader('content-type', 'text/html');
          res.end(
            n + 1 <= N
              ? `<html><head><title>${n}</title></head><body><a href="/${n + 1}">next</a></body></html>`
              : `<html><head><title>${n}</title></head><body>end</body></html>`,
          );
        } catch { /* socket torn down on budget exhaustion */ }
      }, 150);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const result = await runAudit(
        { url: base, pageCap: 200, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
        { allowPrivateIpsForTesting: true, engineV2: true, maxCrawlMsForTesting: 2000 },
      );

      // Enough pages to clear the thin-crawl floor, so budget exhaustion (not page count) is the thing
      // forcing low confidence; and not the whole chain (it's partial).
      const ok = result.pages.filter((p) => p.statusCode === 200).length;
      expect(ok).toBeGreaterThanOrEqual(MIN_COVERAGE_PAGES);
      expect(result.pages.length).toBeLessThan(N);

      // The trust contract: a budget-cut partial crawl is low-confidence, partial, and caveated — never
      // presented as a confident grade despite the deceptively-high coverage.
      expect(result.crawlHealth?.partial).toBe(true);
      expect(result.crawlHealth?.confidence).toBe('low');
      expect(result.findings.some((f) => f.category === 'incomplete_crawl')).toBe(true);
      expect(result.score).toBeLessThanOrEqual(LOW_CONFIDENCE_SCORE_CAP);
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 30000);
});
