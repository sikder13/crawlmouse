import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib } from 'node:zlib';
import { build } from 'esbuild';
import { bundleReader } from '../build.js';
import { MAX_BATCH_CONCURRENCY } from './config.js';
import { READER_FILE } from './reader/file.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGET_CEILINGS, MAX_URLS_PER_BATCH, type BatchRequest } from './batch/request.js';
import { MAX_RESULT_BYTES } from './batch/store.js';
import { loadCapacity, loadLevels } from './spec/capacity.js';
import { MAX_TIMING_MS } from './fetch/timing.js';
import { CRAWLERS } from './identities.js';
import { startServer, type FixtureServer } from './test-support/http.js';

/**
 * The worker under load, as it ships: the probe (test-support/load-probe.ts) bundled the way build.ts
 * bundles main.ts, run in a process with fly.toml's heap limit and environment, with the result store
 * already full. Batches at once up to MAX_BATCH_CONCURRENCY (the most BATCH_CONCURRENCY may set, and
 * what fly.toml sets), and at 4 and 8 below it, each on a site of its own serving 10 MB pages, each response dripped over about a second so the requests overlap: access batches,
 * crawl batches of the most URLs a batch may hold on brotli-compressed pages (a decoder's window on
 * top of each page), and crawl batches on the densest markup measured. The pages hold text outside Latin-1, so each
 * decodes to a two-byte string, twice its UTF-8 size. The process must finish, and its peak resident
 * memory (VmHWM) must stay under that level's bound in PEAK_RSS_MIB.
 */

const flyToml = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
const HEAP_MB = Number(/--max-old-space-size=(\d+)/.exec(flyToml)![1]);
const VM_MIB = Number(/memory = "(\d+)mb"/.exec(flyToml)![1]);
const ENV = Object.fromEntries(
  [...flyToml.slice(flyToml.indexOf('[env]')).matchAll(/^\s*([A-Z_]+) = "([^"]*)"$/gm)].map((m) => [
    m[1]!,
    m[2]!,
  ]),
);
/**
 * The levels this file runs and the bound on peak resident memory at each, read from
 * src/spec/capacity-measured.json, the file the runbook's capacity section is rendered from. A level's
 * bound is its highest measured peak × 1.35, rounded up to 10 MiB (src/spec/spec.test.ts checks the
 * file against that rule). Fixed rather than a share of the VM, because the test is here to catch a
 * memory regression; the VM must still hold the largest with room to spare (pinned below).
 *
 * At 8 and 16 the highest peak is from one run of the cut-short cases with the full time budget,
 * which reads longer and so peaks higher; that run is not repeated here (it takes 4 minutes a case).
 * What runs here at 16 peaks lower than that bound, so this file holds a regression of the cut-short
 * shape, and the full-budget figure is re-measured by hand when the bound changes.
 */
const CAPACITY = loadCapacity();
const PEAK_RSS_MIB: Readonly<Record<number, number>> = Object.fromEntries(
  Object.entries(CAPACITY.worst_case.bound_mib).map(([n, b]) => [Number(n), b]),
);
const LEVELS = loadLevels(CAPACITY);

const PAGE_BYTES = 10_000_000;
const DRIP_MS = 1000;
/** One loopback address per batch, so each batch is a site of its own to the politeness limiter. */
const HOSTS = Array.from({ length: MAX_BATCH_CONCURRENCY }, (_, i) => `127.0.0.${i + 2}`);

/** About PAGE_BYTES of HTML, from repeating `unit(i)`. */
function page(unit: (i: number) => string): Buffer {
  const parts = ['<!doctype html><html><head><title>load →</title></head><body>'];
  let size = Buffer.byteLength(parts[0]!);
  for (let i = 0; size < PAGE_BYTES - 64; i++) {
    const u = unit(i);
    parts.push(u);
    size += Buffer.byteLength(u);
  }
  parts.push('</body></html>');
  return Buffer.from(parts.join(''));
}

const PAGES = {
  // Paragraphs of text, each with a link to a page of its own.
  links: page((i) => `<p>→ item ${i} <a href="/p/${i}">link → ${i}</a></p>\n`),
  // The densest document measured: an element and a text node for every four bytes.
  dense: page(() => '<p>w'),
  // Text and anchors of double quotes, each a byte in UTF-8 and two in the result's JSON.
  quotes: page((i) => `<p>${'"'.repeat(40)} <a href="/q/${i}">${'"'.repeat(20)}</a></p>\n`),
};
/**
 * The links page compressed with brotli's largest window (2^24 bytes), which is what a decoder's
 * buffer grows toward: round 4 measured 50-URL batches of it at 530 to 546 MiB, before pages were read
on a thread of their own; 472.7 MiB on 2026-10-31.
 */
const BROTLI = brotliCompressSync(PAGES.links, {
  params: { [zlib.BROTLI_PARAM_LGWIN]: 24, [zlib.BROTLI_PARAM_QUALITY]: 5 },
});

const dir = mkdtempSync(join(tmpdir(), 'worker-load-'));
const probe = join(dir, 'probe.mjs');
const servers: FixtureServer[] = [];

beforeAll(async () => {
  await bundleReader(join(dir, READER_FILE));
  await build({
    entryPoints: [fileURLToPath(new URL('test-support/load-probe.ts', import.meta.url))],
    outfile: probe,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'warning',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
  for (const host of HOSTS) {
    servers.push(
      await startServer((req, res) => {
        if (req.url === '/robots.txt') return void ((res.statusCode = 404), res.end());
        const brotli = req.url!.startsWith('/br/');
        const body = brotli
          ? BROTLI
          : req.url!.startsWith('/dense/')
            ? PAGES.dense
            : req.url!.startsWith('/quotes/')
              ? PAGES.quotes
              : PAGES.links;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        if (brotli) res.setHeader('content-encoding', 'br');
        res.setHeader('content-length', body.length);
        const chunks = 10;
        const size = Math.ceil(body.length / chunks);
        let i = 0;
        const next = () => {
          if (res.destroyed) return;
          res.write(body.subarray(i * size, (i + 1) * size));
          if (++i < chunks) setTimeout(next, DRIP_MS / chunks);
          else res.end();
        };
        next();
      }, host),
    );
  }
}, 120_000);
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
  rmSync(dir, { recursive: true, force: true });
});

interface ProbeReport {
  peak_rss_mib: number;
  loop_delay_max_ms: number;
  loop_utilization: number;
  reader_restarts: number;
  sampled_peak_mib: Record<string, number>;
  results: Array<{
    kind: string;
    /** The result as the store holds it: UTF-8 JSON, in bytes. */
    json_bytes: number;
    complete: number;
    rows: number;
    partial: unknown;
    not_served: unknown[];
  }>;
}

/** Runs the probe; its exit code, its report, and the end of its stderr when it failed. */
async function runProbe(
  reqs: BatchRequest[],
): Promise<{ code: number | null; report: ProbeReport | null; stderr: string }> {
  const child = spawn(
    process.execPath,
    // fly.toml's NODE_OPTIONS reach the probe through ENV, as they reach the worker.
    [probe, JSON.stringify(reqs)],
    { env: { PATH: process.env.PATH, ...ENV }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
  const line = stdout.trim().split('\n').at(-1);
  const report = code === 0 && line ? (JSON.parse(line) as ProbeReport) : null;
  if (report) {
    process.stdout.write(
      `load: peak RSS ${report.peak_rss_mib.toFixed(1)} MiB; longest event-loop stall ${report.loop_delay_max_ms} ms; loop busy ${report.loop_utilization}; reader restarts ${report.reader_restarts}; sampled ${JSON.stringify(report.sampled_peak_mib)}\n`,
    );
  }
  return { code, report, stderr: code === 0 ? '' : stderr.slice(-2000) };
}

/**
 * The event loop that times requests stays free while pages are read: with reading on it, these
 * cases kept it 90 to 100% busy with stalls of 2.2 to 2.5 s, and under CPU contention requests timed
 * out against sites that were answering. With the reader thread they measured at most 12% busy and an
80 ms stall (2026-10-31, a workstation).
 */
const MAX_LOOP_UTILIZATION = 0.5;
const MAX_LOOP_STALL_MS = 1000;
function expectLoopFree(report: ProbeReport): void {
  expect(report.loop_utilization).toBeLessThan(MAX_LOOP_UTILIZATION);
  expect(report.loop_delay_max_ms).toBeLessThan(MAX_LOOP_STALL_MS);
  expect(report.reader_restarts).toBe(0);
}

const common = (i: number) => ({
  check_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: BUDGET_CEILINGS,
});

/**
 * The shortest time budget the pipeline posts a batch with (MIN_BATCH_S, apps/web/lib/v2/pipeline/
 * limits.ts). Above 4 batches at once, fifty 10 MB pages per batch take longer to read than a batch
 * may run (one reader thread; docs/ops/worker-runbook.md), so those cases run as such a batch does:
 * until its time is spent, every batch reading, then all finishing together.
 */
const SHORT_BUDGET = { ...BUDGET_CEILINGS, max_seconds: 60 };

const crawl = (
  n: number,
  path: string,
  urls: number,
  budget: BatchRequest['budget'] = BUDGET_CEILINGS,
): BatchRequest[] =>
  servers.slice(0, n).map((s, i) => ({
    ...common(i),
    budget,
    kind: 'crawl',
    urls: Array.from({ length: urls }, (_, u) => `${s.base}${path}${u}`),
  }));

const access = (n: number, pages: number): BatchRequest[] =>
  servers.slice(0, n).map((s, i) => ({
    ...common(i),
    kind: 'access',
    pages: Array.from({ length: pages }, (_, p) => ({
      url: `${s.base}/page-${p}`,
      template_key: '/',
    })),
  }));

/**
 * How much the same result can differ between two runs. A row holds four timings in milliseconds
 * (dns, connect, ttfb, total), each printed in as many digits as it takes, so a run that was slower
 * by chance is longer by a few bytes: results of 8,762,392 to 8,762,395 bytes have been measured on
 * unchanged code. `boundedMs` caps a timing at MAX_TIMING_MS, six digits, and it has at least one, so
 * a row can differ by at most 4 x 5 bytes. A change that adds more than 20 bytes to every row of a
 * full batch is past this, and fails.
 */
const TIMING_DIGITS = String(MAX_TIMING_MS).length;
const RESULT_TIMING_MARGIN_BYTES = MAX_URLS_PER_BATCH * 4 * (TIMING_DIGITS - 1);
const LARGEST_RESULT_ALLOWED =
  CAPACITY.worst_case.largest_result_bytes + RESULT_TIMING_MARGIN_BYTES;

/** The largest result any case below produced, in bytes; read by the store-bound case at the end. */
let largestResult = 0;

/** Runs the batches, and checks what every case checks: exit 0, the level's memory bound, a free loop. */
async function underLoad(reqs: BatchRequest[]): Promise<ProbeReport> {
  const { code, report, stderr } = await runProbe(reqs);
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  expect(report!.results).toHaveLength(reqs.length);
  for (const r of report!.results) largestResult = Math.max(largestResult, r.json_bytes);
  expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB[reqs.length]!);
  // The heap limit kills the process, every batch with it, before resident memory does.
  expect(report!.sampled_peak_mib.heapUsed!).toBeLessThan(HEAP_MB * 0.9);
  expectLoopFree(report!);
  return report!;
}

const mib = (n: number) => `${PEAK_RSS_MIB[n]} MiB`;

/** A batch cut short by its time: a row for every URL, fewer read, and the time budget among its reasons. */
function expectCutShort(r: ProbeReport['results'][number]): void {
  expect(r.rows).toBe(MAX_URLS_PER_BATCH);
  expect(r.complete).toBeLessThan(MAX_URLS_PER_BATCH);
  const reasons = (r.partial as { reasons: string[] } | null)?.reasons ?? [];
  expect(reasons).toContain('budget_seconds');
  for (const reason of reasons) expect(['budget_seconds', 'result_size']).toContain(reason);
}

describe.runIf(process.platform === 'linux')('memory under load', () => {
  it('runs as many batches at once as fly.toml configures, the most the worker allows', () => {
    expect(ENV.BATCH_CONCURRENCY).toBe(String(MAX_BATCH_CONCURRENCY));
    expect(HOSTS.length).toBe(MAX_BATCH_CONCURRENCY);
    expect(LEVELS.at(-1)).toBe(Number(ENV.BATCH_CONCURRENCY));
    expect(LEVELS).toEqual([4, 8, MAX_BATCH_CONCURRENCY]);
  });

  it("bounds every level's peak well inside the VM fly.toml sets", () => {
    for (const n of LEVELS) expect(PEAK_RSS_MIB[n]).toBeLessThanOrEqual(VM_MIB * 0.9);
  });

  for (const n of [4, MAX_BATCH_CONCURRENCY]) {
    it(`${n} access batches on 10 MB pages finish within ${mib(n)} at a ${HEAP_MB} MB heap limit`, async () => {
      const pages = 2;
      const report = await underLoad(access(n, pages));
      // The control and every crawler on each page, all served and read.
      for (const r of report.results) {
        expect(r).toMatchObject({
          complete: pages,
          rows: pages * (1 + CRAWLERS.length),
          partial: null,
        });
      }
    }, 300_000);

    it(`${n} crawl batches on 10 MB pages of the densest markup finish within ${mib(n)}`, async () => {
      const report = await underLoad(crawl(n, '/dense/', 4));
      for (const r of report.results) {
        expect(r).toMatchObject({ complete: 4, rows: 4, partial: null, not_served: [] });
      }
    }, 300_000);
  }

  for (const path of ['/page-', '/br/']) {
    const what = path === '/br/' ? '10 MB brotli pages' : '10 MB pages';
    it(`4 crawl batches of ${MAX_URLS_PER_BATCH} URLs on ${what} finish within ${mib(4)}`, async () => {
      const report = await underLoad(crawl(4, path, MAX_URLS_PER_BATCH));
      for (const r of report.results) {
        expect(r).toMatchObject({
          complete: MAX_URLS_PER_BATCH,
          rows: MAX_URLS_PER_BATCH,
          // Fifty pages of a thousand links each pass the batch's 8 MiB for text and links: the pages
          // past it keep their rows without their text and edges, and say so.
          partial: { reasons: ['result_size'] },
          not_served: [],
        });
      }
    }, 600_000);
  }

  // A page can make its batch's result no larger by what it serves: the room counts the text as the
  // result's JSON holds it, so a page of quotes, two bytes each there, is cut at the same size.
  it(`4 crawl batches of ${MAX_URLS_PER_BATCH} URLs on 10 MB pages of quotes keep each result within the largest recorded`, async () => {
    const report = await underLoad(crawl(4, '/quotes/', MAX_URLS_PER_BATCH));
    for (const r of report.results) {
      expect(r).toMatchObject({
        complete: MAX_URLS_PER_BATCH,
        rows: MAX_URLS_PER_BATCH,
        partial: { reasons: ['result_size'] },
        not_served: [],
      });
      expect(r.json_bytes).toBeLessThanOrEqual(LARGEST_RESULT_ALLOWED);
    }
  }, 600_000);

  for (const [n, path] of [
    [8, '/br/'],
    [MAX_BATCH_CONCURRENCY, '/page-'],
    [MAX_BATCH_CONCURRENCY, '/br/'],
  ] as const) {
    const what = path === '/br/' ? '10 MB brotli pages' : '10 MB pages';
    it(`${n} crawl batches of ${MAX_URLS_PER_BATCH} URLs on ${what}, cut short at ${SHORT_BUDGET.max_seconds} s, stay within ${mib(n)}`, async () => {
      const report = await underLoad(crawl(n, path, MAX_URLS_PER_BATCH, SHORT_BUDGET));
      for (const r of report.results) expectCutShort(r);
    }, 300_000);
  }

  it('holds BATCH_CONCURRENCY of the largest result recorded, twice over, in the result store', () => {
    expect(Number(ENV.BATCH_CONCURRENCY) * LARGEST_RESULT_ALLOWED * 2).toBeLessThanOrEqual(
      MAX_RESULT_BYTES,
    );
  });

  // Runs last: it reads the results the cases above measured. Under a filter that skips the cases
  // that make the largest results it passes on less, and the recorded figure above still holds.
  it('measures no result larger than the one recorded', () => {
    process.stdout.write(
      `load: largest result ${largestResult} bytes (${(largestResult / 1048576).toFixed(2)} MiB)\n`,
    );
    expect(RESULT_TIMING_MARGIN_BYTES).toBe(1000);
    expect(largestResult).toBeLessThanOrEqual(LARGEST_RESULT_ALLOWED);
  });
});
