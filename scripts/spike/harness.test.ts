import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, extractLocs, extractHrefs, pickSample, buildBatch, throughputRow, type Outcome } from './harness-lib.js';
import { selfTest } from './harness.js';
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
