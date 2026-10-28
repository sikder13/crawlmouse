import { readFileSync } from 'node:fs';
import type { BatchRequest } from '../batch/request.js';
import { runBatch, type BatchResult } from '../batch/run.js';
import { RobotsCache } from '../batch/site-rules.js';
import { BatchStore, MAX_RESULT_BYTES } from '../batch/store.js';
import { systemClock } from '../clock.js';
import { createFetcher } from '../fetch/fetcher.js';
import { Sites } from '../politeness/sites.js';

/**
 * Run by load.test.ts as a bundle, in a process of its own with the heap limit fly.toml sets: the
 * batches in argv[2] (JSON) at once, through the real fetcher, into a result store already holding
 * MAX_RESULT_BYTES of results. Prints the process's peak resident memory (VmHWM) and each batch's
 * shape as one JSON line.
 */

const reqs = JSON.parse(process.argv[2]!) as BatchRequest[];
const store = new BatchStore(() => systemClock.now());
const progress = { urls_done: 0, urls_total: 0, requests: 0 };

// Full, as it can be when the batches start: results of 1 MiB each, up to the store's limit.
const filler = { pad: 'x'.repeat(1024 * 1024 - 16) } as unknown as BatchResult;
for (let i = 0; i < MAX_RESULT_BYTES / (1024 * 1024); i++) {
  store.start(`filler:${i}`, progress);
  store.finish(`filler:${i}`, filler);
}

const peak = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
const sampler = setInterval(() => {
  const m = process.memoryUsage();
  for (const k of Object.keys(peak) as Array<keyof typeof peak>) peak[k] = Math.max(peak[k], m[k]);
}, 20);
const deps = {
  clock: systemClock,
  sites: new Sites(systemClock),
  fetcher: createFetcher(systemClock, { bypassSsrf: true }),
  robotsCache: new RobotsCache(systemClock),
};
const results = await Promise.all(
  reqs.map(async (req, i) => {
    store.start(`batch:${i}`, progress);
    const result = await runBatch(req, deps);
    store.finish(`batch:${i}`, result);
    return {
      kind: result.kind,
      requests: result.requests,
      bytes: result.bytes,
      complete: result.coverage.urls_complete,
      partial: result.partial,
      rows: result.kind === 'access' ? result.access_tests.length : result.pages.length,
    };
  }),
);
clearInterval(sampler);
const status = readFileSync('/proc/self/status', 'utf8');
const vmhwmKiB = Number(/^VmHWM:\s+(\d+) kB$/m.exec(status)![1]);
const mib = (n: number) => Math.round((n / 1048576) * 10) / 10;
process.stdout.write(
  `${JSON.stringify({
    peak_rss_mib: vmhwmKiB / 1024,
    sampled_peak_mib: Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, mib(v)])),
    results,
  })}\n`,
);
