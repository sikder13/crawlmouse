import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runCrawl } from './crawler.js';
import { canonicalizeUrl } from './url-canonical.js';

// ─────────────────────────────────────────────────────────────────────────────
// SPEC 5.1a §6 — B6 FOR THE CRAWL PATH (M5).
//
// The selector's own tests prove selection is a pure function of a discovered set. They do NOT prove
// that a BUDGET-TRUNCATED CRAWL selects reproducibly, and treating them as if they did is exactly the
// substitution that let the incumbent determinism tests pass while duskroute swung 56 points: those
// fixtures are never truncated, so the truncation rule — the thing that actually decides the sample —
// was never exercised.
//
// This fixture is deliberately LARGER THAN THE CAP and duskroute-shaped: one enormous template whose
// children sort alphabetically ahead of everything else, plus a handful of small, important sections.
// Under level-sorted truncation the listing template takes the entire budget and /pricing, /contact,
// /guide and /about are never fetched at all — which is E1, reproduced in a fixture.
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

const LISTINGS = 300;
const GUIDES = 8;
const ABOUTS = 5;
const CAP = 40;

beforeAll(async () => {
  const html = (links: string[]) =>
    `<html><head><title>t</title></head><body>${links.map((h) => `<a href="${h}">${h}</a>`).join('')}` +
    `<p>Body text long enough that this page is a CONTENT page under the thin-content gate, since a ` +
    `thin page would leave the gradeable population and change what this test is measuring.</p></body></html>`;

  // The homepage links EVERYTHING, so the whole site is discovered at depth 1 and the budget must
  // decide the sample. That is the shape that makes truncation the deciding rule.
  const all = [
    ...Array.from({ length: LISTINGS }, (_, i) => `/listing/item-${String(i).padStart(4, '0')}`),
    ...Array.from({ length: GUIDES }, (_, i) => `/guide/topic-${i}`),
    ...Array.from({ length: ABOUTS }, (_, i) => `/about/section-${i}`),
    '/pricing', '/contact',
  ];

  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/robots.txt' || path === '/sitemap.xml') { res.statusCode = 404; res.end(''); return; }
    res.setHeader('content-type', 'text/html');
    if (path === '/' || path === '') { res.end(html(all)); return; }
    res.end(html(['/']));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const INPUT = () => ({
  startUrls: [baseUrl],
  pageCap: CAP,
  perHostConcurrency: 4,
  staggerMs: 0,
  pageTimeoutMs: 5000,
  allowPrivateIpsForTesting: true,
  deterministicFrontier: true,
});

const paths = (urls: string[]) => urls.map((u) => new URL(u).pathname).sort();

describe('M5/B6 — a budget-truncated crawl selects reproducibly and representatively', () => {
  it('reaches the small strata instead of drowning in the giant one', async () => {
    // THE ASSERTION THAT GOES RED ON THE INCUMBENT. Level-sorted truncation admits `/about/*` (which
    // sorts first), then `/guide/*`, then fills the rest with `/listing/*` — and never reaches
    // `/pricing` or `/contact`, which sort last. A crawl that cannot see a site's pricing page is not
    // sampling the site, and whichever slice of one template it happened to take then decides the
    // grade.
    const out = await runCrawl(INPUT());
    const got = new Set(paths(out.pages.map((p) => p.url)));
    expect(got.has('/pricing')).toBe(true);
    expect(got.has('/contact')).toBe(true);
    expect([...got].some((p) => p.startsWith('/guide/'))).toBe(true);
    expect([...got].some((p) => p.startsWith('/about/'))).toBe(true);

    // And the giant template must not have taken the whole budget.
    const listings = [...got].filter((p) => p.startsWith('/listing/')).length;
    expect(listings).toBeLessThan(CAP - 4);
  }, 60000);

  it('produces the SAME page set across two runs of the same truncated crawl', async () => {
    const a = await runCrawl(INPUT());
    const b = await runCrawl(INPUT());
    expect(paths(a.pages.map((p) => p.url))).toEqual(paths(b.pages.map((p) => p.url)));
    // Determinism alone is satisfiable by a collapsed crawl, so pin that truncation actually happened.
    expect(a.pages.length).toBe(CAP);
  }, 60000);

  it('the homepage is always fetched, whatever the budget', async () => {
    const out = await runCrawl({ ...INPUT(), pageCap: 3 });
    expect(paths(out.pages.map((p) => p.url))).toContain(canonicalizeUrl(baseUrl) === baseUrl ? '/' : '/');
  }, 60000);
});
