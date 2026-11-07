/**
 * A batch result as the worker returns it parses with the contract's BatchResultSchema
 * (packages/types/src/v2/worker-batch.ts), for both kinds and for the rows and findings that come from
 * a robots.txt block, a redirect, a refusal and a spent budget. The schema is strict, so a field the
 * worker adds without adding it to the contract fails here.
 */
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BatchResultSchema, CRAWL_RAW_TEXT_BYTES } from '@crawlmouse/types/v2';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';
import { RAW_TEXT_BYTES } from '../rows/crawl-page.js';
import { InstantClock } from '../test-support/clock.js';
import { startServer, type FixtureServer } from '../test-support/http.js';
import type { BatchRequest } from './request.js';
import { runBatch } from './run.js';
import { RobotsCache } from './site-rules.js';

const CHECK = '00000000-0000-4000-8000-0000000000c3';
const SITE_ID = '00000000-0000-4000-8000-0000000000a3';
const roomy = { max_requests: 1000, max_bytes: 50_000_000, max_seconds: 1800 };

let server: FixtureServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

function site(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = req.url ?? '/';
  if (path === '/robots.txt') {
    res.setHeader('content-type', 'text/plain');
    return res.end('User-agent: *\nDisallow: /private\nCrawl-delay: 0\n');
  }
  if (path === '/moved') {
    res.statusCode = 301;
    res.setHeader('location', '/');
    return res.end();
  }
  if (path === '/gone') {
    res.statusCode = 404;
    return res.end('not here');
  }
  if (path === '/file.pdf') {
    res.setHeader('content-type', 'application/pdf');
    return res.end('%PDF-1.4');
  }
  res.setHeader('content-type', 'text/html');
  res.end(
    `<html><head><title>t ${path}</title></head><body><h1>h</h1><p>page ${path}</p>` +
      '<a href="/">home</a><a href="/next">next</a><a href="/private/x">private</a></body></html>',
  );
}

const common = {
  check_id: CHECK,
  site_id: SITE_ID,
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: roomy,
};

async function run(req: BatchRequest) {
  const clock = new InstantClock();
  return runBatch(req, {
    clock,
    sites: new Sites(clock),
    fetcher: createFetcher(clock, { bypassSsrf: true }),
    robotsCache: new RobotsCache(clock),
  });
}

describe('BatchResultSchema against the worker', () => {
  it('parses a crawl batch with fetched, redirected, gone, non-HTML and disallowed rows', async () => {
    server = await startServer(site);
    const result = await run({
      ...common,
      kind: 'crawl',
      urls: ['/', '/moved', '/gone', '/file.pdf', '/private/x'].map((p) => `${server!.base}${p}`),
    });
    const outcomes = result.kind === 'crawl' ? result.pages.map((p) => p.outcome) : [];
    expect(outcomes).toContain('robots_disallowed');
    expect(BatchResultSchema.parse(result)).toEqual(result);
  });

  it('parses an access batch', async () => {
    server = await startServer(site);
    const result = await run({
      ...common,
      kind: 'access',
      pages: [{ url: `${server!.base}/`, template_key: '/' }],
    });
    expect(result.kind).toBe('access');
    expect(BatchResultSchema.parse(result)).toEqual(result);
  });

  it('parses a batch whose budget ran out, with its findings and partial reasons', async () => {
    server = await startServer(site);
    const result = await run({
      ...common,
      budget: { ...roomy, max_requests: 2 },
      kind: 'crawl',
      urls: ['/', '/a', '/b'].map((p) => `${server!.base}${p}`),
    });
    expect(result.partial?.reasons).toContain('budget_requests');
    expect(result.findings.map((f) => f.kind)).toContain('budget_spent');
    expect(BatchResultSchema.parse(result)).toEqual(result);
  });

  it('keeps the served text to the size the contract allows', () => {
    expect(RAW_TEXT_BYTES).toBe(CRAWL_RAW_TEXT_BYTES);
  });
});
