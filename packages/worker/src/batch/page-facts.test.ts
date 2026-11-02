/**
 * The page facts a crawl row records (CC-12b): redirect hops and loops, the declared canonical,
 * hreflang, the main-content simhash, links_read and the search engines' robots.txt verdicts. Each
 * through a whole crawl batch, hostile pages included, and each row through the row schema.
 */
import { MAX_HREFLANG_LINKS } from '@crawlmouse/types/v2';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createFetcher, MAX_KEPT_BYTES } from '../fetch/fetcher.js';
import { MAX_ROBOTS_RULES } from '../politeness/robots.js';
import { Sites } from '../politeness/sites.js';
import { MAX_URL_LENGTH } from '../rows/bounded.js';
import { CrawlPageSchema, type CrawlPage } from '../rows/crawl-page.js';
import { CANONICAL_NOT_KEPT } from '../rows/declared.js';
import { MAX_LINKS_READ } from '../rows/links.js';
import { MAX_DOM_DEPTH, READ_IN_PART } from '../rows/text.js';
import { InstantClock } from '../test-support/clock.js';
import { fakeFetcher, type FakeResponse } from '../test-support/fake-fetcher.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { MAX_REDIRECTS } from './polite-fetch.js';
import type { BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

const BASE = 'https://example.com';
const roomy = { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 };

const crawl = (urls: string[]): BatchRequest => ({
  kind: 'crawl',
  check_id: '00000000-0000-4000-8000-0000000000c3',
  site_id: '00000000-0000-4000-8000-0000000000a3',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: roomy,
  urls,
});

/** The crawl rows for `paths`, answered by `respond` (robots.txt answers 404 unless it says). */
async function rows(
  paths: string[],
  respond: (url: string) => FakeResponse | undefined,
): Promise<Map<string, CrawlPage>> {
  const clock = new InstantClock();
  const fetcher = fakeFetcher(clock, (url) => {
    const r = respond(url);
    if (r) return r;
    if (url.endsWith('/robots.txt')) return { status: 404, body: '' };
    return { body: '<html><body><p>ok</p></body></html>' };
  });
  const result = await runBatch(crawl(paths.map((p) => `${BASE}${p}`)), {
    clock,
    sites: new Sites(clock),
    fetcher,
    robotsCache: new RobotsCache(clock),
  });
  if (result.kind !== 'crawl') throw new Error('crawl');
  for (const p of result.pages) CrawlPageSchema.parse(p);
  return new Map(result.pages.map((p) => [p.url.slice(BASE.length), p]));
}

const redirect = (to: string, status = 301): FakeResponse => ({
  status,
  headers: { location: to },
  body: '',
});
const page = (head: string, body = '<p>ok</p>'): FakeResponse => ({
  body: `<html><head>${head}</head><body>${body}</body></html>`,
});
const at = (path: string) => `${BASE}${path}`;

describe('redirect hops', () => {
  it('records each hop as (from, status, location), and no loop', async () => {
    const r = await rows(['/a'], (url) =>
      url === at('/a') ? redirect('/b') : url === at('/b') ? redirect('/c', 302) : undefined,
    );
    expect(r.get('/a')).toMatchObject({
      final_url: at('/c'),
      redirect: {
        hops: [
          { from: at('/a'), status: 301, location: at('/b') },
          { from: at('/b'), status: 302, location: at('/c') },
        ],
        loop: false,
      },
    });
  });

  it('flags a loop, and keeps the hops up to the cap', async () => {
    const r = await rows(['/a'], (url) =>
      url === at('/a') ? redirect('/b') : url === at('/b') ? redirect('/a') : undefined,
    );
    const chain = r.get('/a')!.redirect!;
    expect(chain.loop).toBe(true);
    expect(chain.hops).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('flags a page that redirects to itself', async () => {
    const r = await rows(['/s'], (url) => (url === at('/s') ? redirect('/s#top') : undefined));
    expect(r.get('/s')!.redirect).toMatchObject({ loop: true });
  });

  it('does not call a long chain that never repeats a loop, nor /a to /a/', async () => {
    const r = await rows(['/r1', '/a'], (url) => {
      const m = /\/r(\d+)$/.exec(url);
      if (m) return redirect(`/r${Number(m[1]) + 1}`);
      return url === at('/a') ? redirect('/a/') : undefined;
    });
    expect(r.get('/r1')!.redirect).toMatchObject({ loop: false });
    expect(r.get('/r1')!.redirect!.hops).toHaveLength(MAX_REDIRECTS + 1);
    expect(r.get('/a')!.redirect).toMatchObject({
      hops: [{ from: at('/a'), status: 301, location: at('/a/') }],
      loop: false,
    });
  });

  it('keeps no Location over the URL cap, and says the hop happened', async () => {
    const long = `/${'x'.repeat(MAX_URL_LENGTH)}`;
    const r = await rows(['/a'], (url) => (url === at('/a') ? redirect(long) : undefined));
    expect(r.get('/a')!.redirect).toEqual({
      hops: [{ from: at('/a'), status: 301, location: null }],
      loop: false,
    });
  });

  it('records no redirect, rather than none, when nothing answered', async () => {
    const r = await rows(['/a'], (url) => (url === at('/a') ? { error: 'timeout' } : undefined));
    expect(r.get('/a')!.redirect).toBeNull();
    expect((await rows(['/b'], () => undefined)).get('/b')!.redirect).toEqual({
      hops: [],
      loop: false,
    });
  });
});

describe('the declared canonical', () => {
  const declared = async (head: string, path = '/p') =>
    (await rows([path], (url) => (url === at(path) ? page(head) : undefined))).get(path)!;

  it('keeps the href as written, resolved against the page, for any host and for itself', async () => {
    expect((await declared('<link rel="canonical" href="../c?x=1">')).canonical_declared).toEqual({
      href: '../c?x=1',
      url: at('/c?x=1'),
    });
    expect(
      (await declared('<link rel="canonical" href="https://other.test/p">')).canonical_declared,
    ).toEqual({ href: 'https://other.test/p', url: 'https://other.test/p' });
    const self = await declared('<link rel="canonical" href="/p">');
    expect(self.canonical_declared).toEqual({ href: '/p', url: at('/p') });
    // The canonical the extractor adopts is the same host and not the page: none here.
    expect(self.canonical_url).toBeNull();
  });

  it('reads the first canonical, and none as none', async () => {
    const two = await declared(
      '<link rel="canonical" href="/one"><link rel="canonical" href="/two">',
    );
    expect(two.canonical_declared).toEqual({ href: '/one', url: at('/one') });
    expect((await declared('')).canonical_declared).toEqual({ href: null, url: null });
    expect((await declared('<link rel="canonical">')).canonical_declared).toEqual({
      href: null,
      url: null,
    });
  });

  it('keeps an href that names no web URL, with no URL', async () => {
    expect(
      (await declared('<link rel="canonical" href="javascript:void(0)">')).canonical_declared,
    ).toEqual({ href: 'javascript:void(0)', url: null });
  });

  it('records an href over the URL cap, or with a control character, as not read, and says so once', async () => {
    // Over the cap on this host: the adopted canonical's note says it, for both.
    const long = await declared(`<link rel="canonical" href="/${'c'.repeat(MAX_URL_LENGTH)}">`);
    expect(long.canonical_declared).toBeNull();
    expect(long.limitations.filter((l) => /rel=canonical/.test(l))).toEqual([
      `The page's rel=canonical is over ${MAX_URL_LENGTH} characters, so it was not recorded.`,
    ]);
    // On another host the extractor adopts nothing, so the declared one's note is the one.
    const other = await declared(
      `<link rel="canonical" href="https://other.test/${'c'.repeat(MAX_URL_LENGTH)}">`,
    );
    expect(other.canonical_declared).toBeNull();
    expect(other.limitations).toContain(CANONICAL_NOT_KEPT);
    const control = await declared('<link rel="canonical" href="/c\u0001d">');
    expect(control.canonical_declared).toBeNull();
    expect(control.limitations).toContain(CANONICAL_NOT_KEPT);
  });

  it('records a canonical past where a cut body was read as not read, not as none', async () => {
    const body = `<html><head>${'<meta name="x" content="y">'.repeat(100_000)}<link rel="canonical" href="/c"></head></html>`;
    expect(body.length).toBeGreaterThan(MAX_KEPT_BYTES);
    const r = await rows(['/p'], (url) =>
      url === at('/p') ? { body: body.slice(0, MAX_KEPT_BYTES + 10) } : undefined,
    );
    const row = r.get('/p')!;
    expect(row.limitations).toContain(READ_IN_PART);
    expect(row.canonical_declared).toBeNull();
    expect(row.links_read).toBe(false);
  });
});

describe('hreflang', () => {
  const alternates = async (head: string, headers: http.OutgoingHttpHeaders = {}) =>
    (
      await rows(['/p'], (url) =>
        url === at('/p')
          ? {
              body: `<html><head>${head}</head><body>x</body></html>`,
              headers: { 'content-type': 'text/html', ...headers } as never,
            }
          : undefined,
      )
    ).get('/p')!.hreflang;

  it('reads every link[rel=alternate][hreflang] as (hreflang, href), in page order', async () => {
    expect(
      await alternates(
        '<link rel="alternate" hreflang="en" href="/en"><link REL="Alternate Foo" hreflang="x-default" href="https://a.test/">' +
          '<link rel="stylesheet" hreflang="fr" href="/s.css"><link rel="alternate" href="/no-lang">',
      ),
    ).toEqual({
      links: [
        { hreflang: 'en', href: at('/en') },
        { hreflang: 'x-default', href: 'https://a.test/' },
      ],
      complete: true,
    });
  });

  it('keeps the first MAX_HREFLANG_LINKS of 5,000, and says the list is incomplete', async () => {
    const head = Array.from(
      { length: 5000 },
      (_, i) => `<link rel="alternate" hreflang="l${i}" href="/l/${i}">`,
    ).join('');
    const h = (await alternates(head))!;
    expect(h.links).toHaveLength(MAX_HREFLANG_LINKS);
    expect(h.links[0]).toEqual({ hreflang: 'l0', href: at('/l/0') });
    expect(h.complete).toBe(false);
  });

  it('marks the list incomplete for an alternate not kept, or a Link header that declares more', async () => {
    const long = `<link rel="alternate" hreflang="${'x'.repeat(65)}" href="/l">`;
    expect(await alternates(long)).toEqual({ links: [], complete: false });
    expect(await alternates('<link rel="alternate" hreflang="en" href="mailto:a@b.test">')).toEqual(
      { links: [], complete: false },
    );
    expect(
      await alternates('<link rel="alternate" hreflang="en" href="/en">', {
        link: '<https://example.com/fr>; rel="alternate"; hreflang="fr"',
      }),
    ).toMatchObject({ complete: false });
  });
});

describe('the main-content simhash', () => {
  const prose = (n: number) =>
    Array.from({ length: n }, (_, i) => `word${i} sentence ${i % 7} more text`).join(' ');
  const hash = async (body: string) =>
    (await rows(['/p'], (url) => (url === at('/p') ? page('', body) : undefined))).get('/p')!
      .content_simhash;

  it('hashes the main content as 16 hex digits, the same behind different navigation', async () => {
    const a = await hash(`<nav><a href="/x">Home</a></nav><main>${prose(80)}</main>`);
    const b = await hash(
      `<nav><a href="/y">Shop</a><a href="/z">Blog</a></nav><main>${prose(80)}</main>`,
    );
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it('records none for main content under the token floor', async () => {
    expect(await hash('<p>A few words only.</p>')).toBeNull();
  });
});

describe('links_read', () => {
  const linksRead = async (body: string) =>
    (await rows(['/p'], (url) => (url === at('/p') ? { body } : undefined))).get('/p')!;

  it('is true for a page read whole with every link read', async () => {
    expect((await linksRead('<body><a href="/a">a</a></body>')).links_read).toBe(true);
    expect((await linksRead('<body>no links</body>')).links_read).toBe(true);
  });

  it('is false for links past the read limit, an href over the URL cap, or a page nested too deep', async () => {
    const many = `<body>${'<a href="/l">l</a>'.repeat(MAX_LINKS_READ + 1)}</body>`;
    expect((await linksRead(many)).links_read).toBe(false);
    const long = `<body><a href="/${'h'.repeat(MAX_URL_LENGTH)}">x</a></body>`;
    expect((await linksRead(long)).links_read).toBe(false);
    const deep = `<body>${'<div>'.repeat(MAX_DOM_DEPTH + 1)}x</body>`;
    const row = await linksRead(deep);
    expect(row.links_read).toBe(false);
    expect(row.links_out).toBeNull();
  });

  it('is false, with links_out 0 not taken for "no links", when the reader gave no answer', async () => {
    const clock = new InstantClock();
    const result = await runBatch(crawl([at('/p')]), {
      clock,
      sites: new Sites(clock),
      fetcher: fakeFetcher(clock, (url) =>
        url.endsWith('/robots.txt') ? { status: 404, body: '' } : { body: '<a href="/a">a</a>' },
      ),
      robotsCache: new RobotsCache(clock),
      reader: {
        words: async () => ({ failed: 'reader_deadline' }),
        page: async () => ({ failed: 'reader_deadline' }),
      },
    });
    if (result.kind !== 'crawl') throw new Error('crawl');
    expect(result.pages[0]).toMatchObject({ links_read: false, links_out: null });
  });
});

describe('robots.txt verdicts for the search engines', () => {
  const robots = (text: string) => (url: string) =>
    url.endsWith('/robots.txt')
      ? { body: text, headers: { 'content-type': 'text/plain' } }
      : undefined;
  const verdicts = (row: CrawlPage) =>
    Object.fromEntries(row.robots_search.map((v) => [v.ua, v.verdict]));

  it('reads each search engine its own group, or *, from the file the crawl obeyed', async () => {
    const r = await rows(
      ['/g', '/b', '/open'],
      robots('User-agent: Googlebot\nDisallow: /g\n\nUser-agent: bingbot\nDisallow: /b\n'),
    );
    expect(verdicts(r.get('/g')!)).toEqual({
      Googlebot: 'disallowed_by_robots',
      Bingbot: 'allowed',
    });
    expect(verdicts(r.get('/b')!)).toEqual({
      Googlebot: 'allowed',
      Bingbot: 'disallowed_by_robots',
    });
    expect(verdicts(r.get('/open')!)).toEqual({ Googlebot: 'allowed', Bingbot: 'allowed' });
  });

  it('records them on a URL robots.txt kept our crawler from too', async () => {
    const r = await rows(['/cart'], robots('User-agent: *\nDisallow: /cart\n'));
    expect(r.get('/cart')).toMatchObject({ outcome: 'robots_disallowed' });
    expect(verdicts(r.get('/cart')!)).toEqual({
      Googlebot: 'disallowed_by_robots',
      Bingbot: 'disallowed_by_robots',
    });
  });

  it('allows everything without a robots.txt', async () => {
    expect(verdicts((await rows(['/p'], () => undefined)).get('/p')!)).toEqual({
      Googlebot: 'allowed',
      Bingbot: 'allowed',
    });
  });

  it('a bingbot group over the rule limit leaves Bingbot unmeasured, and the crawl goes on', async () => {
    const big = `User-agent: bingbot\n${'Disallow: /x\n'.repeat(MAX_ROBOTS_RULES + 1)}`;
    const r = await rows(['/p'], robots(big));
    expect(r.get('/p')).toMatchObject({ outcome: 'fetched', status_code: 200 });
    expect(verdicts(r.get('/p')!)).toEqual({ Googlebot: 'allowed', Bingbot: 'not_measured' });
  });

  it('measures nothing when robots.txt could not be read, and nothing is fetched', async () => {
    const r = await rows(['/p'], (url) =>
      url.endsWith('/robots.txt') ? { status: 503, body: '' } : undefined,
    );
    expect(r.get('/p')).toMatchObject({ outcome: 'not_requested' });
    expect(verdicts(r.get('/p')!)).toEqual({ Googlebot: 'not_measured', Bingbot: 'not_measured' });
  });
});

describe('the request line, as a real server receives it', () => {
  let server: FixtureServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('is GET over HTTP/1.1 for every request, and access rows say so', async () => {
    const seen: string[] = [];
    server = await startServer((req, res) => {
      seen.push(`${req.method} HTTP/${req.httpVersion}`);
      res.statusCode = req.url === '/robots.txt' ? 404 : 200;
      res.setHeader('content-type', 'text/html');
      res.end('<html><body><p>ok</p></body></html>');
    });
    const clock = new InstantClock();
    const req: BatchRequest = {
      kind: 'access',
      check_id: '00000000-0000-4000-8000-0000000000c3',
      site_id: '00000000-0000-4000-8000-0000000000a3',
      batch: 1,
      nonce: 'n'.repeat(16),
      jwt: 'x',
      budget: roomy,
      pages: [{ url: `${server.base}/a`, template_key: '/' }],
    };
    const result = await runBatch(req, {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock, { bypassSsrf: true }),
      robotsCache: new RobotsCache(clock),
    });
    if (result.kind !== 'access') throw new Error('access');
    expect(new Set(seen)).toEqual(new Set(['GET HTTP/1.1']));
    const sent = result.access_tests.filter((t) => t.raw_status !== null);
    expect(sent.length).toBeGreaterThan(0);
    for (const t of sent) expect([t.method, t.http_version]).toEqual(['GET', '1.1']);
  });
});

describe('a hostile page through the real fetcher', () => {
  let server: FixtureServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('a 10 MB canonical href is read only to the kept bytes, recorded as not read, and nothing stored is long', async () => {
    const href = `/${'c'.repeat(10 * 1024 * 1024)}`;
    server = await startServer((req, res) => {
      if (req.url === '/robots.txt') return void ((res.statusCode = 404), res.end());
      res.setHeader('content-type', 'text/html');
      res.end(
        `<html><head><link rel="canonical" href="${href}"></head><body><a href="/a">a</a></body></html>`,
      );
    });
    const clock = new InstantClock();
    const result = await runBatch(
      { ...crawl([`${server.base}/p`]) },
      {
        clock,
        sites: new Sites(clock),
        fetcher: createFetcher(clock, { bypassSsrf: true }),
        robotsCache: new RobotsCache(clock),
      },
    );
    if (result.kind !== 'crawl') throw new Error('crawl');
    const row = CrawlPageSchema.parse(result.pages[0]);
    expect(row).toMatchObject({ outcome: 'fetched', canonical_declared: null, links_read: false });
    expect(row.limitations).toContain(READ_IN_PART);
    const longest = (v: unknown): number =>
      typeof v === 'string'
        ? v.length
        : v && typeof v === 'object'
          ? Math.max(0, ...Object.values(v).map(longest))
          : 0;
    expect(longest({ ...row, raw_text: null })).toBeLessThanOrEqual(MAX_URL_LENGTH);
  }, 60_000);
});

describe('what a row stores, against the batch room', () => {
  it('charges hreflang alternates to the room: past it, a page keeps none, and says so', async () => {
    // 256 alternates of about 2,000 characters: about 0.5 MB a page, so 20 pages pass 8 MiB.
    const head = Array.from(
      { length: MAX_HREFLANG_LINKS },
      (_, i) => `<link rel="alternate" hreflang="l${i}" href="/l/${i}?${'q'.repeat(2000)}">`,
    ).join('');
    const paths = Array.from({ length: 20 }, (_, i) => `/p${i}`);
    const r = await rows(paths, (url) => (url.includes('/p') ? page(head) : undefined));
    const kept = paths.filter((p) => r.get(p)!.hreflang !== null);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(paths.length);
    const dropped = r.get(paths.find((p) => r.get(p)!.hreflang === null)!)!;
    expect(
      dropped.limitations.some((l) => /hreflang alternates of this page were not recorded/.test(l)),
    ).toBe(true);
  });

  it('a redirect to a URL that is not http(s) keeps the hop and no location', async () => {
    const r = await rows(['/a'], (url) =>
      url === at('/a') ? redirect('ftp://example.com/x') : undefined,
    );
    expect(r.get('/a')!.redirect).toEqual({
      hops: [{ from: at('/a'), status: 301, location: null }],
      loop: false,
    });
  });
});
