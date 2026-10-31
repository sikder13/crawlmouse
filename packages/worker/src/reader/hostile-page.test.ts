import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bundleReader } from '../../build.js';
import type { BatchRequest } from '../batch/request.js';
import { runBatch } from '../batch/run.js';
import { RobotsCache } from '../batch/site-rules.js';
import { Sites } from '../politeness/sites.js';
import { TOO_DEEP } from '../rows/text.js';
import { InstantClock } from '../test-support/clock.js';
import { fakeFetcher } from '../test-support/fake-fetcher.js';
import { ThreadReader } from './thread-reader.js';

/**
 * Review round 5's hostile page, through the reader thread as the worker runs it: about 700 KB of
 * unclosed tags with stray close tags, which parsed to the end held the thread for about 57 s on the
 * VM (14.5 s on a workstation), and every other batch's pages waited behind it.
 */

const HOSTILE = `<html><body>${'<em></p>'.repeat(87_500)}</body></html>`;
const PAGES_PER_BATCH = 10;

const dir = mkdtempSync(join(tmpdir(), 'worker-hostile-'));
const entry = join(dir, 'reader.mjs');
const reader = new ThreadReader(pathToFileURL(entry));

beforeAll(async () => {
  await bundleReader(entry);
  await reader.start();
}, 60_000);
afterAll(async () => {
  await reader.close();
  rmSync(dir, { recursive: true, force: true });
});

const crawl = (host: string, paths: string[], i: number): BatchRequest => ({
  kind: 'crawl',
  check_id: `00000000-0000-4000-8000-00000000000${i}`,
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: { max_requests: 100, max_bytes: 64 * 1048576, max_seconds: 600 },
  urls: paths.map((p) => `https://${host}${p}`),
});

it('reads the hostile page in under 2 s, and every page of the batches beside it', async () => {
  const clock = new InstantClock();
  const deps = {
    clock,
    sites: new Sites(clock),
    fetcher: fakeFetcher(clock, (url) =>
      url.endsWith('/robots.txt')
        ? { status: 404, body: '' }
        : {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: url.endsWith('/hostile') ? HOSTILE : `<html><body><p>page ${url}</p></body></html>`,
          },
    ),
    robotsCache: new RobotsCache(clock),
    reader,
  };
  const paths = Array.from({ length: PAGES_PER_BATCH }, (_, i) => `/p${i}`);
  const reqs = [
    crawl('hostile.example', ['/hostile', '/after'], 0),
    ...['a', 'b', 'c'].map((h, i) => crawl(`${h}.example`, paths, i + 1)),
  ];
  const t0 = performance.now();
  const timed = await Promise.all(
    reqs.map(async (req) => {
      const result = await runBatch(req, deps);
      return { result, ms: performance.now() - t0 };
    }),
  );

  const [hostile, ...others] = timed;
  expect(hostile!.ms).toBeLessThan(2_000);
  if (hostile!.result.kind !== 'crawl') throw new Error('crawl');
  const page = hostile!.result.pages.find((p) => p.url.endsWith('/hostile'))!;
  expect(page).toMatchObject({ outcome: 'fetched', raw_text: null });
  expect(page.limitations).toContain(TOO_DEEP);
  expect(hostile!.result.findings).toEqual([
    { kind: 'not_read', reason: 'parse_depth_exceeded', responses: 1 },
  ]);
  for (const { result } of [hostile!, ...others]) {
    if (result.kind !== 'crawl') throw new Error('crawl');
    for (const p of result.pages.filter((p) => !p.url.endsWith('/hostile'))) {
      expect(p.raw_text, p.url).toBe(`page ${p.url}`);
    }
  }
  expect(others.map((o) => (o.result.kind === 'crawl' ? o.result.pages.length : 0))).toEqual([
    PAGES_PER_BATCH,
    PAGES_PER_BATCH,
    PAGES_PER_BATCH,
  ]);
  expect(reader.restarts).toBe(0);
}, 60_000);
