import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGET_CEILINGS, type BatchRequest } from './batch/request.js';
import { CRAWLERS } from './identities.js';
import { startServer, type FixtureServer } from './test-support/http.js';

/**
 * The worker under load, as it ships: the probe (test-support/load-probe.ts) bundled the way build.ts
 * bundles main.ts, run in a process with fly.toml's heap limit and environment, with the result store
 * already full. Four batches at once, each on a site of its own serving 10 MB pages, each response
 * dripped over about a second so the requests overlap. The pages hold text outside Latin-1, so each
 * decodes to a two-byte string, twice its UTF-8 size. The process must finish, and its peak resident
 * memory (VmHWM) must fit the VM fly.toml sets, with 10% to spare.
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
const PEAK_RSS_MIB = VM_MIB * 0.9;

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

const dir = mkdtempSync(join(tmpdir(), 'worker-load-'));
const probe = join(dir, 'probe.mjs');
const servers: FixtureServer[] = [];

beforeAll(async () => {
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
        const body = req.url!.startsWith('/dense/') ? PAGES.dense : PAGES.links;
        res.setHeader('content-type', 'text/html; charset=utf-8');
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
  sampled_peak_mib: Record<string, number>;
  results: Array<{ kind: string; complete: number; rows: number; partial: unknown }>;
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
      `load: peak RSS ${report.peak_rss_mib.toFixed(1)} MiB; sampled ${JSON.stringify(report.sampled_peak_mib)}\n`,
    );
  }
  return { code, report, stderr: code === 0 ? '' : stderr.slice(-2000) };
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
  }, 180_000);

  it(`4 crawl batches on 10 MB pages finish within ${PEAK_RSS_MIB} MiB at a ${HEAP_MB} MB heap limit`, async () => {
    const { code, report, stderr } = await runProbe(crawl('/page-', 4));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    for (const r of report!.results) expect(r).toMatchObject({ complete: 4, rows: 4 });
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
  }, 180_000);

  it(`4 crawl batches on 10 MB pages of the densest markup finish within ${PEAK_RSS_MIB} MiB`, async () => {
    const { code, report, stderr } = await runProbe(crawl('/dense/', 4));
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    for (const r of report!.results) expect(r).toMatchObject({ complete: 4, rows: 4 });
    expect(report!.peak_rss_mib).toBeLessThanOrEqual(PEAK_RSS_MIB);
  }, 180_000);
});
