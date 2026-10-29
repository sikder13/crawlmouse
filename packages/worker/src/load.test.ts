import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib } from 'node:zlib';
import { build } from 'esbuild';
import { bundleReader } from '../build.js';
import { DEFAULT_BATCH_CONCURRENCY } from './config.js';
import { READER_FILE } from './reader/file.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGET_CEILINGS, MAX_URLS_PER_BATCH, type BatchRequest } from './batch/request.js';
import { CRAWLERS } from './identities.js';
import { startServer, type FixtureServer } from './test-support/http.js';

/**
 * The worker under load, as it ships: the probe (test-support/load-probe.ts) bundled the way build.ts
 * bundles main.ts, run in a process with fly.toml's heap limit and environment, with the result store
 * already full. Four batches at once (as many as fly.toml lets run), each on a site of its own serving
 * 10 MB pages, each response dripped over about a second so the requests overlap: access batches,
 * crawl batches of the most URLs a batch may hold on brotli-compressed pages (a decoder's window on
 * top of each page), and crawl batches on the densest markup measured. The pages hold text outside Latin-1, so each
 * decodes to a two-byte string, twice its UTF-8 size. The process must finish, and its peak resident
 * memory (VmHWM) must stay under PEAK_RSS_MIB.
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
 * The bound on peak resident memory: the highest peak measured on this branch, 473.7 MiB (four
 * 50-URL crawl batches of brotli pages, 2026-10-28), plus about 35%. Fixed rather than a share of
 * the VM, because the test is here to catch a memory regression, and 90% of the 1 GB VM would let
 * the peak almost double before it failed. The VM must still hold it with room to spare (pinned
 * below).
 */
const PEAK_RSS_MIB = 640;

const PAGE_BYTES = 10_000_000;
const DRIP_MS = 1000;
const HOSTS = ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5'];

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
};
/**
 * The links page compressed with brotli's largest window (2^24 bytes), which is what a decoder's
 * buffer grows toward: round 4 measured 50-URL batches of it at 530 to 546 MiB.
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
        const body = brotli ? BROTLI : req.url!.startsWith('/dense/') ? PAGES.dense : PAGES.links;
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
 * out against sites that were answering. With the reader thread they measured at most 10% and 429 ms.
 */
const MAX_LOOP_UTILIZATION = 0.5;
const MAX_LOOP_STALL_MS = 1000;
function expectLoopFree(report: ProbeReport): void {
  expect(report.loop_utilization).toBeLessThan(MAX_LOOP_UTILIZATION);
  expect(report.loop_delay_max_ms).toBeLessThan(MAX_LOOP_STALL_MS);
  expect(report.reader_restarts).toBe(0);
}

const common = (i: number) => ({
  check_id: `00000000-0000-4000-8000-00000000000${i}`,
  site_id: '00000000-0000-4000-8000-0000000000a1',
  batch: 1,
  nonce: 'n'.repeat(16),
  jwt: 'x',
  budget: BUDGET_CEILINGS,
});

const crawl = (path: string, urls: number): BatchRequest[] =>
  servers.map((s, i) => ({
    ...common(i),
    kind: 'crawl',
    urls: Array.from({ length: urls }, (_, u) => `${s.base}${path}${u}`),
  }));

describe.runIf(process.platform === 'linux')('memory under load', () => {
  it(`4 access batches on 10 MB pages finish within ${PEAK_RSS_MIB} MiB at a ${HEAP_MB} MB heap limit`, async () => {
    const pages = 2;
    const reqs: BatchRequest[] = servers.map((s, i) => ({
      ...common(i),
      kind: 'access',
      pages: Array.from({ length: pages }, (_, p) => ({
        url: `${s.base}/page-${p}`,
        template_key: '/',
      })),
    }));
    const { code, report, stderr } = await runProbe(reqs);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    // The control and every crawler on each page, all served and read.
    for (const r of report!.results) {
      expect(r).toMatchObject({
        complete: pages,
        rows: pages * (1 + CRAWLERS.length),
        partial: null,
      });
    }
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
    expectLoopFree(report!);
  }, 180_000);

  it('bounds the peak well inside the VM fly.toml sets', () => {
    expect(PEAK_RSS_MIB).toBeLessThanOrEqual(VM_MIB * 0.9);
  });

  it('runs more batches at once than the worker is configured to', () => {
    expect(ENV.BATCH_CONCURRENCY).toBe(String(DEFAULT_BATCH_CONCURRENCY));
    expect(HOSTS.length).toBe(4);
    expect(HOSTS.length).toBeGreaterThan(Number(ENV.BATCH_CONCURRENCY));
  });

  it(`4 crawl batches of ${MAX_URLS_PER_BATCH} URLs on 10 MB pages finish within ${PEAK_RSS_MIB} MiB`, async () => {
    const { code, report, stderr } = await runProbe(crawl('/page-', MAX_URLS_PER_BATCH));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    for (const r of report!.results) {
      expect(r).toMatchObject({
        complete: MAX_URLS_PER_BATCH,
        rows: MAX_URLS_PER_BATCH,
        // Fifty pages of a thousand links each pass the batch's 8 MiB for text and links: the pages
        // past it keep their rows without their text and edges, and say so.
        partial: { reasons: ['result_size'] },
        not_served: [],
      });
    }
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
    expectLoopFree(report!);
  }, 480_000);

  it(`4 crawl batches of ${MAX_URLS_PER_BATCH} URLs on 10 MB brotli pages finish within ${PEAK_RSS_MIB} MiB`, async () => {
    const { code, report, stderr } = await runProbe(crawl('/br/', MAX_URLS_PER_BATCH));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    for (const r of report!.results) {
      expect(r).toMatchObject({
        complete: MAX_URLS_PER_BATCH,
        rows: MAX_URLS_PER_BATCH,
        // Fifty pages of a thousand links each pass the batch's 8 MiB for text and links: the pages
        // past it keep their rows without their text and edges, and say so.
        partial: { reasons: ['result_size'] },
        not_served: [],
      });
    }
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
    expectLoopFree(report!);
  }, 480_000);

  it(`4 crawl batches on 10 MB pages of the densest markup finish within ${PEAK_RSS_MIB} MiB`, async () => {
    const { code, report, stderr } = await runProbe(crawl('/dense/', 4));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    for (const r of report!.results) {
      expect(r).toMatchObject({ complete: 4, rows: 4, partial: null, not_served: [] });
    }
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
    expectLoopFree(report!);
  }, 180_000);
});
