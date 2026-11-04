import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { DeclarationFetchSchema, DECLARATION_PATHS } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { InstantClock } from '../test-support/clock.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import { DECLARATION_KEEP_BYTES } from './declarations.js';
import type { BatchRequest } from './request.js';
import { runBatch, type BatchResult } from './run.js';
import { RobotsCache } from './site-rules.js';

/**
 * The declaration files (CC-15's follow-up, PR #54): once per site per crawl batch, after the
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
    ? { kind, check_id: CHECK, site_id: SITE_ID, batch: 1, nonce: 'n'.repeat(16), jwt: 'x', budget, urls: paths.map((p) => `${base}${p}`) }
    : { kind, check_id: CHECK, site_id: SITE_ID, batch: 1, nonce: 'n'.repeat(16), jwt: 'x', budget, pages: paths.map((p) => ({ url: `${base}${p}`, template_key: '/' })) };

async function run(r: BatchRequest): Promise<BatchResult> {
  const clock = new InstantClock();
  return runBatch(r, {
    clock,
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    robotsCache: new RobotsCache(clock),
  });
}

const declarationRequests = (s: FixtureServer) =>
  s.requests.filter((r) => (DECLARATION_PATHS as readonly string[]).includes(r.url));

const plain = (body: string, type = 'text/plain'): Handler => (_p, res) => {
  res.setHeader('content-type', type);
  res.end(body);
};

describe('declaration fetches', () => {
  it('requests each of the seven paths once per site, after the pages, and records status, type and bytes', async () => {
    const s = await serve('User-agent: *\nAllow: /\n', (path, res) => {
      if (path === '/llms.txt') return plain('# Site\n> about')(path, res);
      res.statusCode = 404;
      res.end();
    });
    const result = await run(req('crawl', s.base, ['/', '/a', '/b']));
    expect(declarationRequests(s).map((r) => r.url).sort()).toEqual([...DECLARATION_PATHS].sort());
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
    const s = await serve('User-agent: *\nAllow: /\n', plain('x', `text/plain; ${'p=1; '.repeat(400)}`));
    const result = await run(req('crawl', s.base, ['/']));
    for (const d of result.declarations) {
      if (d.media_type !== null) expect(Buffer.byteLength(d.media_type)).toBeLessThanOrEqual(128);
    }
  });
});
