import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runAudit } from './audit.js';
import { selectSitemapSeeds } from './audit.js';
import { parseRobotsTxt } from './robots.js';
import { isCrawlTrap } from './crawl-traps.js';
import { canonicalizeUrl } from './url-canonical.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a Stage 1 (§4) — crawl integrity.
//
// The governing fact: we run a public crawler against other people's websites and we sell honesty.
// Robots filtering was applied to ENQUEUED LINKS ONLY (crawler.ts), so a URL entering the frontier by
// any other route — a sitemap seed, a redirect target, a rel=canonical target — was fetched even when
// the owner disallowed it. §4.1 makes it ONE gate with no exceptions.
//
// THE ASSERTION THAT MATTERS is not "the page is absent from the result" but "the server was NEVER
// ASKED for it". A page can be absent from the output for a dozen reasons; compliance is a statement
// about the requests we made. The fixture server therefore records every path it is asked for, and the
// tests assert against that log.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let requested: string[] = [];

const ROBOTS = 'User-agent: *\nDisallow: /search\nDisallow: /cart\n';

const page = (body: string, head = '') =>
  `<html><head><title>t</title>${head}</head><body>${body}</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const raw = req.url ?? '/';
    requested.push(raw);
    const path = raw.split('?')[0]!;
    res.setHeader('content-type', 'text/html');

    if (path === '/robots.txt') { res.setHeader('content-type', 'text/plain'); res.end(ROBOTS); return; }
    if (path === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      // The sitemap lists two DISALLOWED paths. This is the E8 production shape: seeds bypassed robots.
      res.end(
        '<?xml version="1.0"?><urlset>' +
          [`${baseUrl}/`, `${baseUrl}/ok`, `${baseUrl}/search?q=sitemap`, `${baseUrl}/cart`]
            .map((u) => `<url><loc>${u}</loc></url>`).join('') +
          '</urlset>',
      );
      return;
    }
    if (path === '/' || path === '') {
      res.end(page(
        '<a href="/ok">ok</a>' +
        '<a href="/search?q=link">disallowed link</a>' +   // entry path 1: link
        '<a href="/go">redirecting</a>' +                  // entry path 3: redirect target
        '<a href="/canon">canonicalised</a>' +             // entry path 4: canonical target
        '<a href="/a/b/c/d/e/f/g/h/i/j/k/l/m/n">deep</a>', // §4.4 trap: path depth
      ));
      return;
    }
    if (path === '/ok') { res.end(page('<a href="/">home</a>')); return; }
    if (path === '/go') { res.statusCode = 302; res.setHeader('location', '/search?q=redirect'); res.end(''); return; }
    if (path === '/canon') { res.end(page('<a href="/">home</a>', `<link rel="canonical" href="/search?q=canon">`)); return; }
    if (path === '/search' || path === '/cart') { res.end(page('<a href="/">DISALLOWED CONTENT</a>')); return; }
    res.end(page('<a href="/">home</a>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const OPTS = { pageCap: 50, perHostConcurrency: 4, staggerMs: 0, pageTimeoutMs: 5000 };
const FLAGS = { allowPrivateIpsForTesting: true, engineV2: true };

/** Paths the server was actually asked for, ignoring robots.txt/sitemap.xml themselves. */
const fetchedPaths = (): string[] => requested.filter((p) => !p.startsWith('/robots.txt') && !p.startsWith('/sitemap.xml'));

describe('§4.1 — robots compliance on EVERY entry path', () => {
  beforeAll(() => { requested = []; });

  it('never requests a disallowed path by ANY route, and still crawls the allowed site', async () => {
    const result = await runAudit({ url: baseUrl, ...OPTS }, FLAGS);
    const paths = fetchedPaths();

    // The compliance assertion, stated four ways so a failure names the entry path that leaked.
    expect(paths.filter((p) => p.startsWith('/search'))).toEqual([]); // links, sitemap, redirect, canonical
    expect(paths.filter((p) => p.startsWith('/cart'))).toEqual([]);   // sitemap seed

    // Negative control: the crawl must still WORK. A gate that blocks everything would pass the
    // assertions above while destroying the product, so pin that the allowed pages were reached.
    expect(paths.some((p) => p === '/' || p === '')).toBe(true);
    expect(paths).toContain('/ok');
    expect(paths).toContain('/go');
    expect(paths).toContain('/canon');
    expect(result.pages.length).toBeGreaterThanOrEqual(3);

    // §4.4 at the LINK entry path: the 14-segment link on the homepage exceeds MAX_URL_PATH_DEPTH and
    // must never be requested. Without this the trap caps are only proven on sitemap seeds, and the
    // link path — which is where a real generator lives — would be untested.
    expect(paths.filter((p) => p.startsWith('/a/b/c'))).toEqual([]);

    // KNOWN DEFECT, pinned so it cannot be forgotten and so the fix has a tripwire. A robots refusal
    // is deterministic, yet Crawlee spends its full retry budget on it: measured at 5 requests to the
    // redirecting page for one unchanging verdict. That is crawl budget burned against the wall clock
    // and avoidable load on the host whose rules we are honouring — politeness inverted.
    //
    // This asserts the DEFECT, not a contract we want. When the fix lands (`request.noRetry` from
    // Crawlee's errorHandler — `NonRetryableError` does not work from inside a got hook, because got
    // wraps it and the class identity is lost), this test goes red and must be changed to expect 1.
    expect(paths.filter((p) => p === '/go').length).toBeGreaterThan(1);
  }, 30000);

  it('entry path 4: a rel=canonical pointing at a disallowed URL is NOT adopted as the identity', async () => {
    // Adopting it would put a disallowed URL into `pages` and report on a path the owner excluded —
    // the same harm as fetching it, arrived at without a request.
    const result = await runAudit({ url: baseUrl, ...OPTS }, FLAGS);
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(canonicalizeUrl(`${baseUrl}/canon`));
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
  }, 30000);
});

describe('§4.1/§4.2/§4.4 — sitemap seed selection (the E8 defect, at its source)', () => {
  const robots = parseRobotsTxt(ROBOTS);
  const origin = 'https://a.com';
  const identityOpts = { forceScheme: 'https:', stripTrackingParams: true, unifyHost: 'a.com' };
  const select = (collected: string[], overrides = {}) =>
    selectSitemapSeeds(collected, {
      canonicalOrigin: origin, homepageUrl: 'https://a.com', robots,
      identityOpts, v2: true, pageCap: 500, ...overrides,
    });

  it('drops robots-disallowed sitemap URLs and RECORDS them (they inform the §7 sitemap delta)', () => {
    const out = select(['https://a.com/ok', 'https://a.com/search?q=x', 'https://a.com/cart']);
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/ok']);
    expect(out.robotsExcluded).toEqual(['https://a.com/cart', 'https://a.com/search?q=x']);
  });

  it('B2: rejects a.com.evil.com as same-origin — the suffix-match bypass fails CLOSED', () => {
    // 'https://a.com.evil.com/x'.startsWith('https://a.com') === true, which is how the bare prefix
    // test at audit.ts:221 handed an attacker-controlled host straight to crawler.run(startUrls).
    const out = select(['https://a.com.evil.com/x', 'https://a.comevil.com/y', 'https://evil.com/z', 'https://a.com/ok']);
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/ok']);
  });

  it('B2: preserves www-equivalence, and still rejects a real subdomain', () => {
    const out = select(['https://www.a.com/w', 'https://blog.a.com/b']);
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/w']);
  });

  it('drops crawl-trap URLs before they reach the frontier', () => {
    const deep = `https://a.com/${Array.from({ length: 20 }, (_, i) => `s${i}`).join('/')}`;
    const out = select(['https://a.com/ok', deep]);
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/ok']);
  });

  it('counts what the sitemap DECLARED before any cap or filter, so "of ~M" is not silently shrunk', () => {
    // The honest site-total estimate must reflect the sitemap, not our filtering of it. Reporting the
    // post-filter number would understate the site and quietly flatter our own coverage.
    const out = select(['https://a.com/ok', 'https://a.com/search?q=x', 'https://a.com/cart']);
    expect(out.sitemapUrlCount).toBe(4); // homepage + /ok + /search + /cart
  });

  it('keeps the homepage first and orders the rest deterministically under v2', () => {
    const out = select(['https://a.com/z', 'https://a.com/m', 'https://a.com/a']);
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/a', 'https://a.com/m', 'https://a.com/z']);
  });

  it('applies the page cap AFTER ordering, so the same cap selects the same subset', () => {
    const out = select(['https://a.com/z', 'https://a.com/m', 'https://a.com/a'], { pageCap: 2 });
    expect(out.seeds).toEqual(['https://a.com', 'https://a.com/a']);
  });
});

describe('§4.4 — crawl-trap caps', () => {
  it('rejects an over-deep path', () => {
    expect(isCrawlTrap(`https://a.com/${Array.from({ length: 13 }, (_, i) => `s${i}`).join('/')}`).trapped).toBe(true);
    expect(isCrawlTrap(`https://a.com/${Array.from({ length: 12 }, (_, i) => `s${i}`).join('/')}`).trapped).toBe(false);
  });

  it('rejects too many query parameters', () => {
    const q = (n: number) => Array.from({ length: n }, (_, i) => `p${i}=1`).join('&');
    expect(isCrawlTrap(`https://a.com/f?${q(9)}`).trapped).toBe(true);
    expect(isCrawlTrap(`https://a.com/f?${q(8)}`).trapped).toBe(false);
  });

  it('rejects an over-long URL', () => {
    expect(isCrawlTrap(`https://a.com/${'x'.repeat(2100)}`).trapped).toBe(true);
    expect(isCrawlTrap(`https://a.com/${'x'.repeat(100)}`).trapped).toBe(false);
  });

  it('rejects a calendar-shaped path with too many numeric segments', () => {
    expect(isCrawlTrap('https://a.com/cal/2026/03/12/09/30').trapped).toBe(true);
    expect(isCrawlTrap('https://a.com/blog/2026/03/12/my-post').trapped).toBe(false);
  });

  it('rejects a URL carrying multiple high-entropy opaque parameter values', () => {
    expect(isCrawlTrap('https://a.com/f?a=b3f9d2a1c8e77f01&b=91ce77bd4a2f0e13').trapped).toBe(true);
    // ONE opaque value is ordinary (a signed link, a share token); two is a generator signature.
    expect(isCrawlTrap('https://a.com/f?a=b3f9d2a1c8e77f01&b=2').trapped).toBe(false);
    // A long ordinary slug is NOT opaque — it has no digits and must survive.
    expect(isCrawlTrap('https://a.com/f?title=the-quick-brown-fox-jumps').trapped).toBe(false);
  });

  it('names the reason it rejected, so an exclusion is explainable rather than mysterious', () => {
    expect(isCrawlTrap(`https://a.com/${'x'.repeat(2100)}`).reason).toBe('url_length');
    expect(isCrawlTrap('https://a.com/cal/2026/03/12/09/30').reason).toBe('numeric_segments');
  });

  it('treats an unparseable URL as a trap rather than letting it through', () => {
    expect(isCrawlTrap('not a url').trapped).toBe(true);
  });

  it('does not reject an ordinary content URL', () => {
    expect(isCrawlTrap('https://a.com/blog/2026/how-we-built-the-thing?utm_source=x').trapped).toBe(false);
    expect(isCrawlTrap('https://a.com').trapped).toBe(false);
  });
});
