/**
 * Spike harness. Submits batches to a worker, collects per-request timing and verdict inputs, and writes
 * one JSON results file per scenario, built from an allow-list of fields (results.ts).
 *
 * Several scenarios can be named in one invocation, comma-separated. Each runs on its own: a scenario
 * that throws is recorded as an error row in its own file and the next scenario still runs, and each
 * file is written as soon as its scenario ends. When any scenario needs the worker, GET /healthz is
 * checked first with a short timeout and the run stops with a clear message if it fails.
 *
 *   tsx scripts/spike/harness.ts discriminators,metrics --out=DIR --worker=URL
 *   tsx scripts/spike/harness.ts self-test      --out=DIR
 *   tsx scripts/spike/harness.ts throughput     --out=DIR --worker=URL [--sites=a.com,b.com] [--duration=120]
 *   tsx scripts/spike/harness.ts slow-host      --out=DIR --worker=URL
 *   tsx scripts/spike/harness.ts discriminators --out=DIR --worker=URL
 *   tsx scripts/spike/harness.ts ssrf           --out=DIR --worker=URL [--fixture-base=URL]
 *   tsx scripts/spike/harness.ts completion     --out=DIR --completion-url=URL
 *   tsx scripts/spike/harness.ts metrics        --out=DIR --worker=URL
 *
 * Secrets are read from the environment by NAME (SPIKE_INTERNAL_SIGNING_SECRET, SPIKE_WORKER_JWT_SECRET) and
 * are never printed. Console output is counts and verdicts only.
 */
import { pathToFileURL } from 'node:url';
import type http from 'node:http';
import {
  parseArgs,
  extractLocs,
  extractHrefs,
  pickSample,
  runBatchAndWait,
  throughputRow,
  runDiscriminatorSite,
  runSsrfCases,
  runCompletionCases,
  getSigned,
  checkWorkerHealth,
  splitForBudget,
  batchCeilingS,
  errorRow,
  CRAWL_REQUESTS_PER_URL,
  POC2_SITES,
  DISCRIMINATOR_SITES,
  SLOW_HOST_SITE,
  newNonce,
  type Row,
  type Secrets,
} from './harness-lib.js';
import { buildResults, writeResults } from './results.js';
import { createWorker } from './worker/server.js';
import { createFetcher } from './worker/fetcher.js';
import { HostLimiter } from './worker/limiter.js';
import { startAllSiteServers } from './fixtures/decision-server.js';
import { createSsrfFixtureServer, listen, close } from './fixtures/ssrf.js';
import { createCompletionServer } from './fixtures/completion-server.js';
import { SITE_NAMES, SAMPLE_PAGES, pagePath, type SiteName } from './fixtures/shapes.js';

const REHEARSAL_SIGNING = 'rehearsal-signing-value-not-a-credential';
const REHEARSAL_JWT = 'rehearsal-jwt-value-not-a-credential';

function secretsFromEnv(): Secrets {
  const signing = process.env.SPIKE_INTERNAL_SIGNING_SECRET;
  const jwt = process.env.SPIKE_WORKER_JWT_SECRET;
  if (!signing || !jwt) throw new Error('SPIKE_INTERNAL_SIGNING_SECRET and SPIKE_WORKER_JWT_SECRET must be set');
  return { signing, jwt };
}

/** Candidate URLs for a real site: homepage links plus the first sitemap. Plain GETs, a handful per site. */
async function discover(site: string, n: number): Promise<string[]> {
  const origin = `https://${site}`;
  const urls: string[] = [];
  try {
    const home = await fetch(`${origin}/`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (home.ok) urls.push(...extractHrefs(await home.text(), home.url || `${origin}/`));
  } catch {
    /* fall through to sitemap */
  }
  try {
    const sm = await fetch(`${origin}/sitemap.xml`, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (sm.ok) urls.push(...extractLocs(await sm.text()).filter((u) => !u.endsWith('.xml')));
  } catch {
    /* none */
  }
  return pickSample(origin, urls, n);
}

/** Sites run in parallel; a site that throws becomes an error row and the others still report. */
async function throughput(worker: string, secrets: Secrets, sites: string[], durationS: number, slowHost: boolean): Promise<Row[]> {
  const rows: Row[] = [];
  const checkId = `tp${newNonce().replace(/[^A-Za-z0-9]/g, 'x').slice(0, 10)}`;
  const settled = await Promise.allSettled(
    sites.map(async (site, idx) => {
      const pool = await discover(site, 400);
      const t0 = Date.now();
      const outcomes = [];
      let batch = idx * 100;
      for (const chunk of splitForBudget(pool, CRAWL_REQUESTS_PER_URL, 2, { maxUrls: 25 })) {
        if (Date.now() - t0 >= durationS * 1000) break;
        batch++;
        const remainingS = Math.max(10, durationS - Math.floor((Date.now() - t0) / 1000));
        outcomes.push(
          await runBatchAndWait(worker, secrets, {
            checkId,
            batch,
            kind: 'crawl',
            urls: chunk,
            hostPolicy: { rps: 2, ceilingS: slowHost ? batchCeilingS(chunk.length, CRAWL_REQUESTS_PER_URL, 2, 480) : Math.min(remainingS, batchCeilingS(chunk.length, CRAWL_REQUESTS_PER_URL)) },
          }),
        );
      }
      return outcomes.length ? throughputRow(site, outcomes, Date.now() - t0) : null;
    }),
  );
  settled.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      if (r.value) rows.push(r.value);
    } else rows.push(errorRow(slowHost ? 'slow-host' : 'throughput', r.reason, { site: sites[idx] }));
  });
  return rows;
}

/** Sites run one after another; a site that throws becomes an error row and the next site still runs. */
async function discriminators(worker: string, secrets: Secrets): Promise<Row[]> {
  const rows: Row[] = [];
  for (const site of DISCRIMINATOR_SITES) {
    try {
      const urls = await discover(site, SAMPLE_PAGES);
      rows.push(...(await runDiscriminatorSite(worker, secrets, site, urls, `ds${newNonce().replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8)}`)));
    } catch (e) {
      rows.push(errorRow('discriminators', e, { site }));
    }
  }
  return rows;
}

/** Offline rehearsal: every fixture, an in-process worker, no network beyond loopback. Proves the plumbing, not throughput. */
async function selfTest(): Promise<Row[]> {
  const secrets: Secrets = { signing: REHEARSAL_SIGNING, jwt: REHEARSAL_JWT };
  const rows: Row[] = [];
  const toClose: http.Server[] = [];
  const startWorker = async (bypass: boolean) => {
    const w = createWorker({
      config: { port: 0, signingSecret: secrets.signing, maxConcurrentBatches: 5 },
      fetch: createFetcher({ safeFetchOverrides: bypass ? { bypassSsrf: true } : {} }),
      limiterFactory: () => new HostLimiter({ rps: 2, unsafeGapOverrideMs: 0 }),
      log: () => undefined,
    });
    const base = await listen(w.server);
    toClose.push(w.server);
    return base;
  };
  try {
    const loopbackWorker = await startWorker(true);
    const guardedWorker = await startWorker(false);

    const sites = await startAllSiteServers();
    toClose.push(...sites.servers);
    for (const site of SITE_NAMES) {
      const urls = Array.from({ length: SAMPLE_PAGES }, (_, i) => `${sites.bases[site as SiteName]}${pagePath(i)}`);
      rows.push(...(await runDiscriminatorSite(loopbackWorker, secrets, site, urls, `st${site.replace(/\W/g, '').slice(0, 6)}${Date.now() % 100000}`, { pollMs: 50 })));
    }

    const fx = createSsrfFixtureServer();
    toClose.push(fx);
    const fxBase = await listen(fx);
    // Literal-address cases against a worker whose guard is intact.
    const literal = (await runSsrfCases(guardedWorker, secrets, undefined, `sl${Date.now() % 1000000}`, { pollMs: 50 })).filter((r) => r.result !== 'not_run');
    // Size-cap cases need a reachable fixture, so they run against the loopback worker. The redirect cases
    // are deliberately NOT run there: with the guard bypassed they would be followed.
    const sizeCases = (await runSsrfCases(loopbackWorker, secrets, fxBase, `sz${Date.now() % 1000000}`, { pollMs: 50 })).filter((r) => r.case === 'gzip-bomb' || r.case === 'body-11mb');
    rows.push(...literal, ...sizeCases);

    const comp = createCompletionServer(secrets.jwt);
    toClose.push(comp.server);
    const compBase = await listen(comp.server);
    rows.push(
      ...(await runCompletionCases(
        compBase,
        secrets.jwt,
        async (i) => void (await fetch(`${compBase}/__open`, { method: 'POST', body: JSON.stringify(i) }).then((r) => r.arrayBuffer())),
        async () => comp.events.length,
      )),
    );
  } finally {
    await Promise.all(toClose.map(close));
  }
  return rows;
}

const WORKER_SCENARIOS = new Set(['throughput', 'slow-host', 'discriminators', 'ssrf', 'metrics']);

async function runScenario(scenario: string, flags: Record<string, string>): Promise<Row[]> {
  switch (scenario) {
    case 'self-test':
      return selfTest();
    case 'throughput': {
      const sites = flags.sites ? flags.sites.split(',') : [...POC2_SITES].filter((s) => s !== SLOW_HOST_SITE);
      return throughput(need(flags, 'worker'), secretsFromEnv(), sites, Number(flags.duration ?? 120), false);
    }
    case 'slow-host':
      return throughput(need(flags, 'worker'), secretsFromEnv(), [SLOW_HOST_SITE], Number(flags.duration ?? 480), true);
    case 'discriminators':
      return discriminators(need(flags, 'worker'), secretsFromEnv());
    case 'ssrf':
      return runSsrfCases(need(flags, 'worker'), secretsFromEnv(), flags['fixture-base'], `ss${newNonce().replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8)}`);
    case 'completion':
      return runCompletionCases(need(flags, 'completion-url'), secretsFromEnv().jwt);
    case 'metrics': {
      const s = secretsFromEnv();
      const r = await getSigned(need(flags, 'worker'), s.signing, '/metrics', 'metrics');
      return [{ kind: 'metrics', httpStatus: r.status, ...(r.ok ? ((await r.json()) as Row) : {}) }];
    }
    default:
      throw new Error(`unknown scenario ${scenario}`);
  }
}

/**
 * Runs each named scenario in turn. Returns the number of scenarios with a failed or error row. A scenario
 * that throws is recorded as one error row; its file is still written, and the next scenario still runs.
 */
export async function runScenarios(scenarios: string[], flags: Record<string, string>, out: string, write = writeResults): Promise<{ failed: number; paths: string[] }> {
  let failed = 0;
  const paths: string[] = [];
  for (const scenario of scenarios) {
    const startedAt = new Date();
    let rows: Row[];
    try {
      rows = await runScenario(scenario, flags);
    } catch (e) {
      rows = [errorRow(scenario, e)];
    }
    const path = write(out, buildResults(scenario, startedAt, new Date(), rows));
    paths.push(path);
    const bad = rows.filter((r) => r.pass === false).length;
    if (bad) failed++;
    process.stdout.write(`${scenario}: ${rows.length} rows, ${bad} failed, written to ${path}\n`);
  }
  return { failed, paths };
}

async function main(): Promise<void> {
  const { scenario, flags } = parseArgs(process.argv.slice(2));
  const out = flags.out;
  const scenarios = scenario.split(',').map((x) => x.trim()).filter(Boolean);
  if (!scenarios.length || !out) throw new Error('usage: harness.ts <scenario>[,<scenario>...] --out=DIR [...]');
  if (scenarios.some((x) => WORKER_SCENARIOS.has(x))) await checkWorkerHealth(need(flags, 'worker'));
  const { failed } = await runScenarios(scenarios, flags, out);
  if (failed) process.exitCode = 1;
}

function need(flags: Record<string, string>, name: string): string {
  const v = flags[name];
  if (!v) throw new Error(`--${name} is required`);
  return v.replace(/\/$/, '');
}

export { selfTest };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`harness error: ${e instanceof Error ? e.message : 'unknown'}\n`);
    process.exit(2);
  });
}
