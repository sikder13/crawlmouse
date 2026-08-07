import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { crawlForAudit, analyzeCrawl } from './index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a D4 — THE freepltn ACCEPTANCE CASE, end to end through the real crawler.
//
// Measured in production: 821 URLs declared in the sitemap, exactly ONE of them reachable by
// following links. The owner's acceptance criterion is that
//
//     "820 of the 821 pages in your sitemap can't be reached by following links"
//
// surfaces as the HEADLINE FINDING — not as a caveat underneath a refusal, and not as a footnote
// beneath the crawl-health banners.
//
// WHY CRAWL-ONLY ORPHAN DETECTION CANNOT SEE THIS. We seed from the sitemap, so these pages ARE
// fetched. They are not missing and they are not dead; they simply have no inbound internal link.
// Orphan detection over the crawled graph therefore has nothing to flag — the pages are present. Only
// the DECLARED-set difference exposes them, which is the whole point of §7.2's triangulation.
//
// Driven through `crawlForAudit` + `analyzeCrawl` rather than a stub, because the thing under test is
// the plumbing: the declared URL SET has to survive from sitemap parsing, through seed selection, into
// the analysis context, and be differenced against BFS reachability. A unit test of the pure function
// would have passed with that chain broken at any link.
// ─────────────────────────────────────────────────────────────────────────────

const DECLARED_TOTAL = 821; // the homepage + 820 unreachable pages, exactly as measured
const LEAF_COUNT = DECLARED_TOTAL - 1;

const WORDS = 'internal linking structure hub depth orphan anchor crawl graph page site navigation editorial index taxonomy sitemap canonical breadcrumb listing archive'.split(' ');
const prose = (seed: number) =>
  Array.from({ length: 80 }, (_, i) => `${WORDS[(i * 7 + seed) % WORDS.length]}${seed}${i} ${WORDS[(i * 3 + seed) % WORDS.length]}`).join(' ');

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      res.end(`User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`);
      return;
    }
    if (path === '/sitemap.xml') {
      // Declares the homepage plus 820 leaves. NOTHING links to the leaves.
      const urls = [`${baseUrl}/`, ...Array.from({ length: LEAF_COUNT }, (_, i) => `${baseUrl}/p/${i}`)];
      res.setHeader('content-type', 'application/xml');
      res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
        .map((u) => `<url><loc>${u}</loc></url>`)
        .join('')}</urlset>`);
      return;
    }

    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') {
      // THE SHAPE: a homepage that links to NOTHING. Every other page exists only in the sitemap.
      res.end(`<html><head><title>Home</title></head><body><h1>Home</h1><main><p>${prose(0)}</p></main></body></html>`);
      return;
    }
    const m = /^\/p\/(\d+)$/.exec(path);
    if (m) {
      const n = Number(m[1]);
      // Real content, so these are not excluded as thin — they are excluded from REACHABILITY only,
      // which is exactly the distinction under test.
      res.end(`<html><head><title>Page ${n}</title></head><body><h1>Page ${n}</h1><main><p>${prose(n + 1)}</p></main></body></html>`);
      return;
    }
    res.statusCode = 404;
    res.end('');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('D4 acceptance — freepltn: 1 reachable of 821 declared', () => {
  it('reports the sitemap delta as the LEADING finding, with the real numbers', async () => {
    // A small cap deliberately: the delta is computed over what the sitemap DECLARED, so it must be
    // 820 whether we fetched 10 of those pages or all 821. Making the count depend on our own crawl
    // budget would let a smaller crawl report a smaller problem.
    const { crawlOut, ctx } = await crawlForAudit(
      { url: baseUrl, pageCap: 12, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true },
      true,
    );
    const result = analyzeCrawl(crawlOut, ctx, true);

    // §7.1 — the three counts are distinguishable, and the estimate says where it came from.
    const coverage = result.coverage!;
    expect(coverage.sitemapDeclared).toBe(DECLARED_TOTAL);
    expect(coverage.estimateSource).toBe('sitemap');
    expect(coverage.estimatedTotal).toBe(DECLARED_TOTAL);
    // fetched and gradeable are their own numbers, bounded by the cap — not the declared total.
    expect(coverage.fetched).toBeLessThanOrEqual(12);
    expect(coverage.fetched).toBeGreaterThan(0);

    // §7.2 — THE HEADLINE NUMBER. Only the homepage is reachable by following links.
    expect(coverage.sitemapUnreached).toBe(LEAF_COUNT);

    // D4 — it LEADS. Not third under the JS and incomplete-crawl banners.
    expect(result.findings[0]?.category).toBe('sitemap_unreached');
    expect(result.findings[0]?.severity).toBe('critical');
    expect(result.findings[0]?.payload).toMatchObject({
      unreached: LEAF_COUNT,
      declared: DECLARED_TOTAL,
      reachable: 1,
    });
  }, 60000);

  it('keeps the finding as the headline even though the audit is REFUSED', async () => {
    // The acceptance criterion in full: "This is the finding, not a caveat. We're not giving a letter
    // because we could only reach one page — but the number above is the more useful answer."
    //
    // So the refusal and the finding must coexist: no letter, no score, AND the sitemap delta still
    // leading. A design that withheld findings alongside the verdict would satisfy the honesty gate
    // and destroy the most useful output at the same time.
    const { crawlOut, ctx } = await crawlForAudit(
      { url: baseUrl, pageCap: 3, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true },
      true,
    );
    const result = analyzeCrawl(crawlOut, ctx, true);

    expect(result.refusal?.refused).toBe(true);
    expect(result.score).toBeNull();
    expect(result.grade).toBeNull();

    // The finding survives the refusal, and still leads.
    expect(result.findings[0]?.category).toBe('sitemap_unreached');
    expect(result.coverage?.sitemapUnreached).toBe(LEAF_COUNT);

    // And the coverage accounting survives too — on a refused audit it is most of what we can offer.
    expect(result.coverage?.sitemapDeclared).toBe(DECLARED_TOTAL);
  }, 60000);

  it('counts the delta over the DECLARED set, independent of our own crawl budget', async () => {
    // Two different caps report the SAME unreached count.
    //
    // ⚠ READ THE LIMIT OF THIS TEST BEFORE CITING IT. On THIS fixture the leaves have no inbound link
    // at any cap, so the cap can never bind on them and this assertion cannot fail however the
    // reachability rule is defined. It pins the freepltn NUMBER; it does NOT prove budget-independence.
    // Gate 4 found that exact vacuity — the property was true here and false in general (36 unreached
    // at cap 5, 31 at cap 10, 0 at cap 41 on an interlinked site). The test that actually carries the
    // property is the interlinked one below, where the cap DOES bind.
    const run = async (pageCap: number) => {
      const { crawlOut, ctx } = await crawlForAudit(
        { url: baseUrl, pageCap, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
        { allowPrivateIpsForTesting: true },
        true,
      );
      return analyzeCrawl(crawlOut, ctx, true).coverage!.sitemapUnreached;
    };
    expect(await run(4)).toBe(LEAF_COUNT);
    expect(await run(16)).toBe(LEAF_COUNT);
  }, 90000);
});

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a D4 — THE COUNTERPART CASE: a fully interlinked site, where the CAP BINDS.
//
// Gate 4 / B-A. `sitemapUnreached` was differenced against `GraphAnalysis.depths`, and `buildGraph`
// drops every edge whose TARGET was not fetched — so "reachable by following links" silently meant
// "fetched AND reachable in the crawl we happened to afford". On this fixture, where every page links
// to every other page and there is no orphan by any definition, that reported:
//
//     cap  5 → 36 of 41 unreached  (critical, on a GRADED audit, leading the findings)
//     cap 10 → 31 of 41 unreached  (critical)
//     cap 41 →  0
//
// "36 of the 41 pages in your sitemap can't be reached by following links" — about pages one click
// from the homepage. That is the exact class SPEC 5.1a exists to delete: a claim about the SITE
// derived from a measurement of OUR BUDGET, inside the honesty gate, at critical severity.
// Production-reachable on any site declaring more URLs than FREE_PAGE_CAP fetches.
//
// The fixture is deliberately built so the cap BINDS: with 41 declared and a cap of 5, 36 declared
// URLs are never fetched, so anything that requires a fetch to count a page reachable will fail here.
// ─────────────────────────────────────────────────────────────────────────────

const MESH_TOTAL = 41;

let meshServer: http.Server;
let meshUrl: string;

describe('D4 acceptance — an interlinked site is never told its pages are unreachable', () => {
  beforeAll(async () => {
    meshServer = http.createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0] ?? '/';
      const all = [`/`, ...Array.from({ length: MESH_TOTAL - 1 }, (_, i) => `/m/${i}`)];

      if (path === '/robots.txt') {
        res.setHeader('content-type', 'text/plain');
        res.end(`User-agent: *\nAllow: /\nSitemap: ${meshUrl}/sitemap.xml\n`);
        return;
      }
      if (path === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${all
          .map((u) => `<url><loc>${meshUrl}${u}</loc></url>`)
          .join('')}</urlset>`);
        return;
      }

      // EVERY page links to EVERY other page. Zero orphans by any definition, at any crawl budget.
      const nav = all
        .filter((u) => u !== path)
        .map((u, i) => `<a href="${u}">${WORDS[i % WORDS.length]} ${i}</a>`)
        .join(' ');
      const isKnown = path === '/' || /^\/m\/\d+$/.test(path);
      if (!isKnown) {
        res.statusCode = 404;
        res.end('');
        return;
      }
      const seed = path === '/' ? 0 : Number(/^\/m\/(\d+)$/.exec(path)![1]) + 1;
      res.setHeader('content-type', 'text/html');
      res.end(
        `<html><head><title>Mesh ${seed}</title></head><body><h1>Mesh ${seed}</h1><nav>${nav}</nav><main><p>${prose(seed)}</p></main></body></html>`,
      );
    });
    await new Promise<void>((r) => meshServer.listen(0, '127.0.0.1', r));
    meshUrl = `http://127.0.0.1:${(meshServer.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => meshServer.close(() => r()));
  });

  const runMesh = async (pageCap: number) => {
    const { crawlOut, ctx } = await crawlForAudit(
      { url: meshUrl, pageCap, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 },
      { allowPrivateIpsForTesting: true },
      true,
    );
    return analyzeCrawl(crawlOut, ctx, true);
  };

  it('reports ZERO unreached at a cap that binds — the count is not a function of our budget', async () => {
    const result = await runMesh(5);
    const coverage = result.coverage!;

    // The cap really did bind: the sitemap declared far more than we fetched. Without this the test
    // would be the vacuous one all over again — passing because the property was never exercised.
    expect(coverage.sitemapDeclared).toBe(MESH_TOTAL);
    expect(coverage.fetched).toBeLessThanOrEqual(5);
    expect(MESH_TOTAL - coverage.fetched).toBeGreaterThan(30);

    // Every declared page is one click from the homepage. Not one of them is unreachable.
    expect(coverage.sitemapUnreached).toBe(0);

    // And therefore no finding at all — not a downgraded one.
    expect(result.findings.some((f) => f.category === 'sitemap_unreached')).toBe(false);
  }, 60000);

  it('reports the same ZERO across three caps, including one that fetches the whole site', async () => {
    // The property the vacuous test claimed and could not carry, on the fixture where it can fail.
    const counts = [
      (await runMesh(5)).coverage!.sitemapUnreached,
      (await runMesh(10)).coverage!.sitemapUnreached,
      (await runMesh(MESH_TOTAL)).coverage!.sitemapUnreached,
    ];
    expect(counts).toEqual([0, 0, 0]);
  }, 120000);
});
