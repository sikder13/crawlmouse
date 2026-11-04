import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DeclarationFetchSchema, DECLARATION_PATHS } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import {
  DECLARATION_BACKOFF_MS,
  DECLARATION_KEEP_BYTES,
  DeclarationCache,
  keepFor,
  retryAfterMs,
} from './declarations.js';
import type { BatchRequest } from './request.js';
import { runBatch, type BatchResult } from './run.js';
import { RobotsCache } from './site-rules.js';

/**
 * The declaration files (CC-15's follow-up, PR #54): in each crawl batch, after the
 * batch's pages, each path is requested as our crawler and recorded as status, media type and byte
 * count only. The body is read no further than DECLARATION_KEEP_BYTES and never stored.
 */

const CHECK = '00000000-0000-4000-8000-0000000000c4';
const SITE_ID = '00000000-0000-4000-8000-0000000000a4';
const roomy = { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 };

let server: FixtureServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

type Handler = (path: string, res: http.ServerResponse) => void;

async function serve(robots: string, files: Handler): Promise<FixtureServer> {
  server = await startServer((req, res) => {
    const path = req.url ?? '/';
    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      return res.end(robots);
    }
    if ((DECLARATION_PATHS as readonly string[]).includes(path)) return files(path, res);
    res.setHeader('content-type', 'text/html');
    res.end('<html><body><p>page</p></body></html>');
  });
  return server;
}

const req = (
  kind: 'crawl' | 'access',
  base: string,
  paths: string[],
  budget = roomy,
): BatchRequest =>
  kind === 'crawl'
    ? {
        kind,
        check_id: CHECK,
        site_id: SITE_ID,
        batch: 1,
        nonce: 'n'.repeat(16),
        jwt: 'x',
        budget,
        urls: paths.map((p) => `${base}${p}`),
      }
    : {
        kind,
        check_id: CHECK,
        site_id: SITE_ID,
        batch: 1,
        nonce: 'n'.repeat(16),
        jwt: 'x',
        budget,
        pages: paths.map((p) => ({ url: `${base}${p}`, template_key: '/' })),
      };

async function run(r: BatchRequest): Promise<BatchResult> {
  const clock = new InstantClock();
  return runBatch(r, {
    clock,
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    robotsCache: new RobotsCache(clock),
  });
}

/** Several batches sharing what a worker shares between them: sites, robots.txt and declarations. */
function worker() {
  const clock = new InstantClock();
  const deps = {
    clock,
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    robotsCache: new RobotsCache(clock),
    declarationCache: new DeclarationCache(clock),
  };
  return { clock, run: (r: BatchRequest) => runBatch(r, deps) };
}

const declarationRequests = (s: FixtureServer) =>
  s.requests.filter((r) => (DECLARATION_PATHS as readonly string[]).includes(r.url));

const plain =
  (body: string, type = 'text/plain'): Handler =>
  (_p, res) => {
    res.setHeader('content-type', type);
    res.end(body);
  };

describe('declaration fetches', () => {
  it('requests each of the seven paths once in a batch, after the pages, and records status, type and bytes', async () => {
    const s = await serve('User-agent: *\nAllow: /\n', (path, res) => {
      if (path === '/llms.txt') return plain('# Site\n> about')(path, res);
      res.statusCode = 404;
      res.end();
    });
    const result = await run(req('crawl', s.base, ['/', '/a', '/b']));
    expect(
      declarationRequests(s)
        .map((r) => r.url)
        .sort(),
    ).toEqual([...DECLARATION_PATHS].sort());
    // After every page of the batch.
    const order = s.requests.map((r) => r.url).filter((u) => u !== '/robots.txt');
    expect(order.slice(0, 3)).toEqual(['/', '/a', '/b']);
    const llms = result.declarations.find((d) => d.path === '/llms.txt')!;
    expect(llms).toEqual({
      origin: s.base,
      path: '/llms.txt',
      state: 'answered',
      status: 200,
      media_type: 'text/plain',
      bytes: 14,
      bytes_complete: true,
      not_requested: null,
      from_cache: false,
    });
    expect(result.declarations.find((d) => d.path === '/rsl.xml')).toMatchObject({
      state: 'answered',
      status: 404,
    });
    for (const d of result.declarations) DeclarationFetchSchema.parse(d);
  });

  it('stores no body: nothing of a declaration file reaches the result', async () => {
    const marker = 'DECLARATION-BODY-MARKER';
    const s = await serve('User-agent: *\nAllow: /\n', plain(`${marker} `.repeat(10)));
    const result = await run(req('crawl', s.base, ['/']));
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it(`reads a body no further than ${DECLARATION_KEEP_BYTES} bytes, and says the count is not the whole`, async () => {
    const s = await serve('User-agent: *\nAllow: /\n', plain('a'.repeat(5 * 1024 * 1024)));
    const result = await run(req('crawl', s.base, ['/']));
    const d = result.declarations.find((x) => x.path === '/llms-full.txt')!;
    expect(d).toMatchObject({ state: 'answered', status: 200, bytes_complete: false });
    expect(d.bytes!).toBeLessThanOrEqual(DECLARATION_KEEP_BYTES + 64 * 1024);
    // Charged to the batch as any request is, and no more than what was read.
    expect(result.bytes).toBeLessThan(7 * (DECLARATION_KEEP_BYTES + 64 * 1024) + 100_000);
  });

  it('records a redirect as it answered and does not follow it', async () => {
    const s = await serve('User-agent: *\nAllow: /\n', (_p, res) => {
      res.statusCode = 301;
      res.setHeader('location', '/elsewhere');
      res.end();
    });
    const result = await run(req('crawl', s.base, ['/']));
    expect(s.requests.some((r) => r.url === '/elsewhere')).toBe(false);
    expect(result.declarations.every((d) => d.status === 301)).toBe(true);
  });

  it('does not request a path robots.txt disallows us, and says so', async () => {
    const s = await serve('User-agent: *\nDisallow: /.well-known/\n', plain('x'));
    const result = await run(req('crawl', s.base, ['/']));
    expect(declarationRequests(s).map((r) => r.url)).not.toContain('/.well-known/mcp');
    expect(result.declarations.find((d) => d.path === '/.well-known/mcp')).toMatchObject({
      state: 'not_requested',
      not_requested: 'robots_disallowed',
      status: null,
    });
  });

  it("is taken from the batch's request budget, and the pages come first", async () => {
    const s = await serve('User-agent: *\nAllow: /\n', plain('x'));
    // robots.txt, three pages, then two of the seven declarations.
    const result = await run(
      req('crawl', s.base, ['/', '/a', '/b'], { ...roomy, max_requests: 6 }),
    );
    expect(result.requests).toBe(6);
    expect(declarationRequests(s)).toHaveLength(2);
    expect(result.coverage.urls_complete).toBe(3);
    // The pages were all done, so the batch is not partial: the spent budget is on the records.
    expect(result.partial).toBeNull();
    const skipped = result.declarations.filter((d) => d.state === 'not_requested');
    expect(skipped).toHaveLength(5);
    expect(skipped.every((d) => d.not_requested === 'budget')).toBe(true);
  });

  it('a batch that robots.txt blocks requests no declaration either', async () => {
    const s = await serve('User-agent: *\nCrawl-delay: 120\n', plain('x'));
    const result = await run(req('crawl', s.base, ['/']));
    expect(declarationRequests(s)).toHaveLength(0);
    expect(result.declarations.every((d) => d.state === 'not_requested')).toBe(true);
  });

  it('an access batch makes no declaration request', async () => {
    const s = await serve('User-agent: *\nAllow: /\n', plain('x'));
    const result = await run(req('access', s.base, ['/']));
    expect(declarationRequests(s)).toHaveLength(0);
    expect(result.declarations).toEqual([]);
  });

  it('a media type is bounded like every stored header value', async () => {
    const s = await serve(
      'User-agent: *\nAllow: /\n',
      plain('x', `text/plain; ${'p=1; '.repeat(400)}`),
    );
    const result = await run(req('crawl', s.base, ['/']));
    for (const d of result.declarations) {
      if (d.media_type !== null) expect(Buffer.byteLength(d.media_type)).toBeLessThanOrEqual(128);
    }
  });

  it("a site that answers 429 on declaration paths does not stop the next batch's pages", async () => {
    const s = await serve('User-agent: *\nAllow: /\n', (_p, res) => {
      res.statusCode = 429;
      res.end();
    });
    const w = worker();
    for (let i = 0; i < 4; i++) {
      const result = await w.run({ ...req('crawl', s.base, ['/', '/a']), batch: i + 1 });
      expect(result.coverage.urls_complete).toBe(2);
      expect(result.partial).toBeNull();
      expect(result.findings.filter((f) => f.kind === 'site_stopped')).toEqual([]);
    }
  });

  it('asks an origin once while its answers are kept, and says which were kept', async () => {
    const s = await serve('User-agent: *\nAllow: /\n', plain('x'));
    const w = worker();
    const first = await w.run({ ...req('crawl', s.base, ['/']), batch: 1 });
    const second = await w.run({ ...req('crawl', s.base, ['/a']), batch: 2 });
    expect(declarationRequests(s)).toHaveLength(DECLARATION_PATHS.length);
    expect(first.declarations.every((d) => !d.from_cache)).toBe(true);
    expect(second.declarations.every((d) => d.from_cache && d.status === 200)).toBe(true);
    expect(second.requests).toBe(1); // its one page: robots.txt and the declarations are kept
    // Past the time robots.txt is kept, they are asked again.
    w.clock.advance(10 * 60_000);
    await w.run({ ...req('crawl', s.base, ['/b']), batch: 3 });
    expect(declarationRequests(s)).toHaveLength(2 * DECLARATION_PATHS.length);
  });

  it('a 429 or a 5xx is kept for its Retry-After, at least a minute; a 404 for ten', async () => {
    const asked: Record<string, number> = {};
    const s = await serve('User-agent: *\nAllow: /\n', (path, res) => {
      asked[path] = (asked[path] ?? 0) + 1;
      if (path === '/llms.txt')
        res.statusCode = 429; // no Retry-After: the one-minute floor
      else if (path === '/rsl.xml') {
        res.statusCode = 503;
        res.setHeader('retry-after', '300');
      } else res.statusCode = 404;
      res.end();
    });
    const w = worker();
    for (let i = 1; i <= 4; i++) await w.run({ ...req('crawl', s.base, [`/${i}`]), batch: i });
    expect([asked['/llms.txt'], asked['/rsl.xml'], asked['/sitemap.xml']]).toEqual([1, 1, 1]);
    w.clock.advance(DECLARATION_BACKOFF_MS);
    await w.run({ ...req('crawl', s.base, ['/5']), batch: 5 });
    expect([asked['/llms.txt'], asked['/rsl.xml'], asked['/sitemap.xml']]).toEqual([2, 1, 1]);
    w.clock.advance(300_000);
    const later = await w.run({ ...req('crawl', s.base, ['/6']), batch: 6 });
    expect([asked['/rsl.xml'], asked['/sitemap.xml']]).toEqual([2, 1]);
    expect(later.declarations.find((d) => d.path === '/sitemap.xml')).toMatchObject({
      status: 404,
      from_cache: true,
    });
  });

  it('reads Retry-After as delta-seconds or an HTTP date, and nothing else', () => {
    const now = Date.parse('2026-11-04T00:00:00Z');
    expect(retryAfterMs('120', now)).toBe(120_000);
    expect(retryAfterMs('Wed, 04 Nov 2026 00:02:00 GMT', now)).toBe(120_000);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(undefined, now)).toBeNull();
    expect(keepFor(429, null)).toBe(DECLARATION_BACKOFF_MS);
    expect(keepFor(503, 10 * 3_600_000)).toBe(10 * 60_000);
    expect(keepFor(200, null)).toBe(10 * 60_000);
    expect(keepFor(404, null)).toBe(10 * 60_000);
    expect(keepFor(408, null)).toBe(DECLARATION_BACKOFF_MS);
    expect(keepFor(425, 120_000)).toBe(120_000);
  });

  it('a request that got no answer is asked again by the next batch', async () => {
    let calls = 0;
    const s = await serve('User-agent: *\nAllow: /\n', (path, res) => {
      if (path === '/rsl.xml' && calls++ === 0) return res.destroy();
      plain('x')(path, res);
    });
    const w = worker();
    const first = await w.run({ ...req('crawl', s.base, ['/']), batch: 1 });
    expect(first.declarations.find((d) => d.path === '/rsl.xml')!.state).toBe('no_response');
    const second = await w.run({ ...req('crawl', s.base, ['/a']), batch: 2 });
    expect(second.declarations.find((d) => d.path === '/rsl.xml')).toMatchObject({
      state: 'answered',
      from_cache: false,
    });
  });
});
