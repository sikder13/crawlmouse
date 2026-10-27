import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import {
  parseArgs,
  extractLocs,
  extractHrefs,
  pickSample,
  buildBatch,
  throughputRow,
  splitForBudget,
  expectedFetchSeconds,
  batchCeilingS,
  batchDeadlineMs,
  checkWorkerHealth,
  waitOutcome,
  errorReason,
  ACCESS_REQUESTS_PER_URL,
  POLL_TRANSPORT_RETRIES,
  type Outcome,
} from './harness-lib.js';
import { selfTest, runScenarios } from './harness.js';
import { createWorker } from './worker/server.js';
import { buildResults, writeResults } from './results.js';
import { verifyJwt } from './worker/auth.js';

describe('harness-lib', () => {
  it('parses scenario and flags', () => {
    expect(parseArgs(['throughput', '--out=/x', '--sites=a.com,b.com', '--dry'])).toEqual({
      scenario: 'throughput',
      flags: { out: '/x', sites: 'a.com,b.com', dry: 'true' },
    });
  });

  it('extracts sitemap locs and same-host hrefs only', () => {
    expect(extractLocs('<urlset><url><loc> https://a.test/1 </loc></url><loc>https://a.test/2</loc></urlset>')).toEqual(['https://a.test/1', 'https://a.test/2']);
    expect(extractHrefs('<a href="/x#f">1</a><a href=\'https://b.test/y\'>2</a><a href="mailto:z@a.test">3</a>', 'https://a.test/')).toEqual(['https://a.test/x']);
  });

  it('picks the homepage first and the same pages on every run', () => {
    const c = Array.from({ length: 50 }, (_, i) => `https://a.test/p${i}`);
    const one = pickSample('https://a.test', c, 20);
    const two = pickSample('https://a.test', [...c].reverse(), 20);
    expect(one[0]).toBe('https://a.test/');
    expect(one).toHaveLength(20);
    expect(two).toEqual(one);
    expect(new Set(one).size).toBe(20);
  });

  it('mints a per-batch JWT bound to this batch, valid for 15 minutes', () => {
    const now = 1_800_000_000_000;
    const r = buildBatch({ checkId: 'c1', batch: 4, kind: 'crawl', urls: ['https://a.test/'], jwtSecret: 'rehearsal-jwt-value-not-a-credential', now });
    expect(verifyJwt(r.jwt, 'rehearsal-jwt-value-not-a-credential', { now, expect: { check_id: 'c1', batch: 4, nonce: r.nonce } }).ok).toBe(true);
    expect(verifyJwt(r.jwt, 'rehearsal-jwt-value-not-a-credential', { now: now + 900_000, expect: { check_id: 'c1', batch: 4, nonce: r.nonce } })).toEqual({ ok: false, reason: 'expired' });
    expect(r.hostPolicy.rps).toBe(2);
  });

  it('computes req/s from the worker-reported request count and wall time', () => {
    const o = (started: number): Outcome => ({
      counters: { fetched: 25, newUrls: 0, blocked: 0, bytes: 0, partial: false },
      rows: [],
      skipped: {},
      limiter: { 'a.test': { started, maxInFlight: 1, slowRuleFiredAtMs: null, gapMs: 500 } },
      wallMs: 1,
    });
    const row = throughputRow('a.test', [o(25), o(50)], 25_000);
    expect(row).toMatchObject({ requests: 50, seconds: 25, reqPerSec: 2 });
  });
});

describe('batch sizing and deadlines', () => {
  it('splits an access sample so no chunk expects more than 60 s of fetching at 2 req/s', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://a.test/p${i}`);
    const chunks = splitForBudget(urls, ACCESS_REQUESTS_PER_URL);
    expect(ACCESS_REQUESTS_PER_URL).toBe(9);
    expect(chunks.map((c) => c.length)).toEqual([13, 7]);
    for (const c of chunks) expect(expectedFetchSeconds(c.length, ACCESS_REQUESTS_PER_URL, 2)).toBeLessThanOrEqual(60);
    expect(chunks.flat()).toEqual(urls);
  });

  it('never exceeds the worker URL cap for cheap crawl batches, and honours a smaller cap', () => {
    const urls = Array.from({ length: 130 }, (_, i) => `https://a.test/p${i}`);
    expect(splitForBudget(urls, 1).map((c) => c.length)).toEqual([50, 50, 30]);
    expect(splitForBudget(urls, 1, 2, { maxUrls: 25 }).map((c) => c.length)).toEqual([25, 25, 25, 25, 25, 5]);
    expect(splitForBudget([], 1)).toEqual([]);
  });

  it('gives the worker a ceiling above the expected time and the harness a deadline above the ceiling', () => {
    expect(batchCeilingS(13, 9)).toBe(206);
    expect(batchCeilingS(50, 9, 2, 480)).toBe(480);
    expect(batchDeadlineMs(206)).toBeGreaterThan(206_000);
  });
});

describe('worker self-check and polling failures', () => {
  it('fails fast with a clear message when the worker is unreachable', async () => {
    const srv = http.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    await new Promise<void>((r) => srv.close(() => r()));
    const t0 = Date.now();
    await expect(checkWorkerHealth(`http://127.0.0.1:${port}`, 2000)).rejects.toThrow(/worker unreachable .*healthz/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('rejects a worker whose health route does not answer 200', async () => {
    const srv = http.createServer((_q, res) => {
      res.statusCode = 503;
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    try {
      await expect(checkWorkerHealth(`http://127.0.0.1:${port}`, 2000)).rejects.toThrow(/answered 503/);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('treats 404 on a poll as final and gives up after repeated transport failures', async () => {
    const secret = 'rehearsal-signing-value-not-a-credential';
    const w = createWorker({ config: { port: 0, signingSecret: secret, maxConcurrentBatches: 1 }, log: () => undefined });
    await new Promise<void>((r) => w.server.listen(0, '127.0.0.1', r));
    const port = (w.server.address() as { port: number }).port;
    try {
      await expect(waitOutcome(`http://127.0.0.1:${port}`, secret, 'never:1', 10_000, 10)).rejects.toThrow(/no longer knows batch never:1/);
    } finally {
      w.server.closeAllConnections();
      await new Promise<void>((r) => w.server.close(() => r()));
    }
    await expect(waitOutcome(`http://127.0.0.1:${port}`, secret, 'gone:1', 10_000, 10)).rejects.toThrow(new RegExp(`failed ${POLL_TRANSPORT_RETRIES + 1} times in a row`));
  });

  it('error reasons are short and carry no URL', () => {
    const r = errorReason(new Error(`fetch failed for https://a.test/secret?x=1 ${'y'.repeat(200)}`, { cause: new Error('terminated') }));
    expect(r).not.toMatch(/https?:/);
    expect(r).toContain('<url>');
    expect(r.length).toBeLessThanOrEqual(120);
  });
});

describe('scenario isolation', () => {
  it('records a failing scenario as an error row, writes its file at once, and runs the next scenario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spike-iso-'));
    const written: string[] = [];
    const { failed, paths } = await runScenarios(['bogus-one', 'bogus-two'], {}, dir, (d, f) => {
      const p = writeResults(d, f);
      written.push(f.scenario);
      return p;
    });
    expect(failed).toBe(2);
    expect(paths).toHaveLength(2);
    expect(written).toEqual(['bogus-one', 'bogus-two']);
    expect(readdirSync(dir)).toHaveLength(2);
    const file = JSON.parse(readFileSync(paths[0]!, 'utf8')) as { rows: Array<Record<string, unknown>> };
    expect(file.rows).toEqual([{ kind: 'error', scenario: 'bogus-one', reason: 'unknown scenario bogus-one', pass: false }]);
  });
});

describe('self-test rehearsal: every offline fixture through the real worker over HTTP', () => {
  it('passes all cases and its results file contains only allow-listed fields', async () => {
    const started = new Date();
    const rows = await selfTest();
    const failed = rows.filter((r) => r.pass === false);
    expect(failed).toEqual([]);
    const summaries = rows.filter((r) => r.kind === 'summary');
    expect(summaries).toHaveLength(5);
    expect(summaries.every((r) => r.pass === true)).toBe(true);
    expect(rows.filter((r) => r.kind === 'ssrf').map((r) => r.case).sort()).toEqual(['body-11mb', 'gzip-bomb', 'metadata-literal', 'v4-mapped-loopback']);
    expect(rows.filter((r) => r.kind === 'completion')).toHaveLength(6);

    const dir = mkdtempSync(join(tmpdir(), 'spike-self-'));
    const path = writeResults(dir, buildResults('self-test', started, new Date(), rows));
    expect(readdirSync(dir)).toHaveLength(1);
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/authorization|bearer|user-agent|set-cookie/i);
    expect(text).not.toContain('rehearsal-');
  }, 60_000);
});
