import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { runBatch, type BatchRequest, type BatchDeps } from './batch.js';
import { createFetcher } from './fetcher.js';
import { HostLimiter } from './limiter.js';
import { startAllSiteServers, identityOfUa } from '../fixtures/decision-server.js';
import { listen, close } from '../fixtures/ssrf.js';
import { SITE_NAMES, SAMPLE_PAGES, pagePath, SITE_EXPECTATIONS, matchesExpectation, pageHtml } from '../fixtures/shapes.js';
import { summarize } from './classify.js';
import { CRAWLER_TOKENS, OUR_UA, GOOGLEBOT_TAGGED_UA, BROWSER_UA, crawlerUa } from './identities.js';

const fetcher = createFetcher({ safeFetchOverrides: { bypassSsrf: true } });
const fastDeps = (): BatchDeps => ({
  fetch: fetcher,
  limiters: new Map(),
  robotsCache: new Map(),
});
/** Pre-seeded limiters with the gap removed, so integration tests do not wait in real time. */
const withFastLimiter = (host: string, d: BatchDeps): BatchDeps => {
  d.limiters.set(host, new HostLimiter({ rps: 2, unsafeGapOverrideMs: 0 }));
  return d;
};

const fastDeps2 = (f: ReturnType<typeof createFetcher>): BatchDeps => ({ fetch: f, limiters: new Map(), robotsCache: new Map() });
const mkReq = (over: Partial<BatchRequest>): BatchRequest => ({
  checkId: 'chk1',
  batch: 1,
  batchId: 'chk1:1',
  nonce: 'nonce-aaaaaaaa',
  kind: 'crawl',
  urls: [],
  hostPolicy: { rps: 2 },
  jwt: 'x',
  ...over,
});

describe('identityOfUa', () => {
  it('tells the seven identities apart, with Googlebot taking precedence over our tag', () => {
    expect(identityOfUa(GOOGLEBOT_TAGGED_UA)).toBe('googlebot');
    expect(identityOfUa(OUR_UA)).toBe('crawlmouse');
    expect(identityOfUa(BROWSER_UA)).toBe('browser');
    for (const t of CRAWLER_TOKENS) expect(identityOfUa(crawlerUa(t))).toBe(t);
  });
});

describe('access batch against the five recorded discriminator shapes (spec 2.3, 5 of 5)', () => {
  let servers: http.Server[];
  let bases: Awaited<ReturnType<typeof startAllSiteServers>>['bases'];
  beforeAll(async () => {
    const s = await startAllSiteServers();
    servers = s.servers;
    bases = s.bases;
  });
  afterAll(async () => {
    await Promise.all(servers.map(close));
  });

  for (const site of SITE_NAMES) {
    it(`${site}: verdicts over 20 sampled pages match ENGINE-GAP 3.5a`, async () => {
      const base = bases[site];
      const host = new URL(base).hostname;
      const deps = withFastLimiter(host, fastDeps());
      const urls = Array.from({ length: SAMPLE_PAGES }, (_, i) => ({ url: `${base}${pagePath(i)}`, hash: String(i), depth: 1 }));
      const out = await runBatch(mkReq({ kind: 'access', urls, stage: 1 }), deps);
      const rows = out.rows.filter((r) => r.kind === 'access');
      expect(rows).toHaveLength(SAMPLE_PAGES);
      const pages = rows.map((r) =>
        Object.fromEntries(CRAWLER_TOKENS.map((t) => [t, { verdict: r[`v:${t}`], row: r[`row:${t}`], scored: true }])),
      );
      const summary = summarize(pages as never);
      expect(matchesExpectation(site, summary)).toEqual({ ok: true, misses: [] });
      expect(Object.keys(SITE_EXPECTATIONS)).toContain(site);
    });
  }

  it('cnn.com: robots disallows the six tokens, so none of them is ever requested', async () => {
    const base = bases['cnn.com'];
    const seenUas: string[] = [];
    const spy = createFetcher({ safeFetchOverrides: { bypassSsrf: true } });
    const deps = withFastLimiter(new URL(base).hostname, {
      ...fastDeps(),
      fetch: async (u, who) => {
        seenUas.push(who);
        return spy(u, who);
      },
    });
    await runBatch(mkReq({ kind: 'access', urls: [{ url: `${base}/p/1`, hash: '1', depth: 1 }] }), deps);
    for (const t of CRAWLER_TOKENS) expect(seenUas).not.toContain(t);
    expect(seenUas).toContain('browser');
  });
});

describe('guard refusal of the host itself', () => {
  it('is reported as ssrf_refused, with no request made, not as a robots decision', async () => {
    const f = createFetcher({});
    const out = await runBatch(mkReq({ urls: [{ url: 'http://169.254.169.254/latest/meta-data/', hash: 'a', depth: 1 }] }), fastDeps2(f));
    const row = out.rows.find((r) => r.kind === 'crawl')!;
    expect(row).toMatchObject({ outcome: 'error', error: 'ssrf_refused' });
    expect(out.counters).toMatchObject({ fetched: 0, blocked: 1 });
  });
});

describe('crawl batch: robots, caps, pauses', () => {
  let server: http.Server;
  let base: string;
  const log: Array<{ path: string; ua: string }> = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      log.push({ path, ua: String(req.headers['user-agent']) });
      if (path === '/robots.txt') {
        res.setHeader('content-type', 'text/plain');
        res.end('User-agent: CrawlmouseBot\nDisallow: /private\nUser-agent: *\nDisallow: /\n');
      } else if (path.startsWith('/limited')) {
        res.statusCode = 429;
        res.end('');
      } else {
        res.setHeader('content-type', 'text/html');
        res.end(pageHtml(50).replace('<p>', '<a href="/a">a</a><a href="/b#x">b</a><a href="https://other.test/z">z</a><p>'));
      }
    });
    base = await listen(server);
  });
  afterAll(() => close(server));
  const host = () => new URL(base).hostname;
  const u = (p: string) => ({ url: `${base}${p}`, hash: p, depth: 1 });

  it('honours CrawlmouseBot over *, never requests a disallowed path, and counts it as blocked', async () => {
    log.length = 0;
    const out = await runBatch(mkReq({ urls: [u('/ok1'), u('/private/x'), u('/ok2')] }), withFastLimiter(host(), fastDeps()));
    expect(log.map((l) => l.path)).not.toContain('/private/x');
    expect(out.counters.fetched).toBe(2);
    expect(out.counters.blocked).toBe(1);
    expect(out.counters.newUrls).toBe(2); // /a and /b; the off-host link is not counted
    expect(log.every((l) => l.ua.includes('Crawlmouse/2.0'))).toBe(true);
  });

  it('stops at the request cap and reports a partial batch', async () => {
    const out = await runBatch(
      mkReq({ urls: [u('/1'), u('/2'), u('/3'), u('/4')], hostPolicy: { rps: 2, requestCap: 3 } }),
      withFastLimiter(host(), fastDeps()),
    );
    // robots.txt counts as one request.
    expect(out.counters.fetched).toBe(2);
    expect(out.counters.partial).toBe(true);
    expect(out.skipped.request_cap).toBe(2);
  });

  it('skips everything once the ceiling has passed', async () => {
    let t = 1_000_000;
    const deps = { ...withFastLimiter(host(), fastDeps()), now: () => (t += 400_000) };
    const out = await runBatch(mkReq({ urls: [u('/1'), u('/2')], hostPolicy: { rps: 2, ceilingS: 60 } }), deps);
    expect(out.counters.fetched).toBe(0);
    expect(out.counters.partial).toBe(true);
    expect(out.skipped.ceiling).toBeGreaterThanOrEqual(2);
  });

  it('a 429 pauses the host: the remaining URLs are skipped, not fetched', async () => {
    // The robots rule allows only CrawlmouseBot paths; /limited is not under /private.
    const out = await runBatch(mkReq({ urls: [u('/limited/1'), u('/limited/2'), u('/limited/3')] }), withFastLimiter(host(), fastDeps()));
    expect(out.skipped.host_429).toBeGreaterThanOrEqual(1);
    expect(out.counters.partial).toBe(true);
  });

  it('pauseUntil in the future skips the whole batch without any request', async () => {
    log.length = 0;
    const out = await runBatch(
      mkReq({ urls: [u('/1')], hostPolicy: { rps: 2, pauseUntil: Date.now() + 60_000 } }),
      withFastLimiter(host(), fastDeps()),
    );
    expect(log).toHaveLength(0);
    expect(out.skipped.host_paused).toBe(1);
  });

  it('caps a requested rate above 2 req/s at 2', async () => {
    const deps = fastDeps();
    await runBatch(mkReq({ urls: [u('/1')], hostPolicy: { rps: 50 } }), deps);
    expect(deps.limiters.get(host())!.gapMs()).toBe(500);
  });

  it('applies a declared Crawl-delay from robots.txt to the host limiter', async () => {
    const s = http.createServer((req, res) => {
      res.setHeader('content-type', req.url === '/robots.txt' ? 'text/plain' : 'text/html');
      res.end(req.url === '/robots.txt' ? 'User-agent: *\nCrawl-delay: 3\n' : '<html>ok</html>');
    });
    const b = await listen(s);
    const deps = fastDeps();
    // No pre-seeded limiter: the real gap logic must engage. One URL plus robots.txt = two starts, 3 s apart.
    const t0 = Date.now();
    await runBatch(mkReq({ urls: [{ url: `${b}/x`, hash: 'x', depth: 1 }] }), deps);
    const took = Date.now() - t0;
    await close(s);
    expect(deps.limiters.get(new URL(b).hostname)!.gapMs()).toBe(3000);
    expect(took).toBeGreaterThanOrEqual(2900);
  }, 15_000);
});
