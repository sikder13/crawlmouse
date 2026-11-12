/**
 * Records the built-site fixture: the crawl worker's own batch results for the synthetic site in
 * site/site.ts, the render outcome over the builder's render candidates, the BuildInput, and the
 * BuiltCheck the builder makes of them (expected.json). Run from the repository root:
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/build/generate.ts
 * and, to rewrite expected.json alone from the recorded batches (no worker run):
 *   pnpm --filter @crawlmouse/engine exec tsx fixtures/v2/build/generate.ts --expected-only
 *
 * How it is recorded, as CC-20b will run it: the worker (`runBatch`, in-process, real HTTP to its
 * test server, shared site state and caches across batches) takes the crawl batches nextCrawlBatch
 * plans until it plans none, then the stage-1 access batch `sample` plans, then stage 2 when stage 1
 * calls for it. Rendering is CC-14's renderCheck over `renderCandidates`, against a fake Browser Run
 * client that answers with the site's own HTML (the guides' rendered side is their text filled in): a
 * recording, not a measurement of a browser. The worker is only read here.
 *
 * The server's loopback address is renamed https://built-site.test, as the access fixtures rename
 * theirs; access test ids are renumbered in row order, so a regeneration changes only what changed.
 *
 * `variant/` holds the same site's crawl with one more link, to the redirect chain's final URL, so the
 * crawl requests that URL as a page of its own. The build tests measure what that does to the
 * structure detectors (the redirect conflict CC-20a reports; see the spec).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import type {
  AccessTest,
  BatchResult,
  CrawlBatchResult,
  FixtureDataset,
} from '@crawlmouse/types/v2';
import { createFetcher } from '../../../../worker/src/fetch/fetcher.js';
import { Sites } from '../../../../worker/src/politeness/sites.js';
import { InstantClock } from '../../../../worker/src/test-support/clock.js';
import { startServer, type FixtureServer } from '../../../../worker/src/test-support/http.js';
import { DeclarationCache } from '../../../../worker/src/batch/declarations.js';
import type { BatchRequest } from '../../../../worker/src/batch/request.js';
import { runBatch } from '../../../../worker/src/batch/run.js';
import { RobotsCache } from '../../../../worker/src/batch/site-rules.js';
import {
  assemble,
  buildCheck,
  nextCrawlBatch,
  readBatches,
  renderCandidates,
  sample,
  serialiseBuilt,
  type BuiltCheck,
} from '../../../src/v2/build/index.js';
import { templateKeyFor } from '../../../src/analysis/template-key.js';
import { fakeClient, memoryDailyBudget } from '../../../src/v2/render/fakes.js';
import { renderCheck, type RenderOutcome } from '../../../src/v2/render/run.js';
import { handler, servedSite, type SiteVariant } from './site/serve.js';
import { CLIENT_RENDERED } from './site/site.js';
import { CHECK, HOST, PAGE_CAP, recordedBuild, recordedInput, SITE_ID } from './recorded.js';

const OUT = new URL('./', import.meta.url);
const BUDGET = { max_requests: 2000, max_bytes: 100_000_000, max_seconds: 1800 };
const STARTED = Date.parse('2026-11-05T02:30:00.000Z');

function request(kind: 'crawl' | 'access', batch: number, urls: string[]): BatchRequest {
  const common = {
    check_id: CHECK,
    site_id: SITE_ID,
    batch,
    nonce: `fixture-nonce-${String(batch).padStart(4, '0')}`,
    jwt: 'not-read-by-run-batch',
    budget: BUDGET,
  };
  return kind === 'crawl'
    ? { ...common, kind, urls }
    : { ...common, kind, pages: urls.map((url) => ({ url, template_key: templateKeyFor(url) })) };
}

/**
 * The worker's batches for the site as `variant` serves it, crawl then access, planned by the
 * builder's own planners, and the render outcome (none when the variant adds the redirect link: that
 * recording is the crawl alone). `open` is a server already serving the variant, which is left open;
 * without it one is started here and closed.
 *
 * The planners plan a site on the default port (plan.ts `crawlableSeeds`, `crawlableDiscovered`), and
 * the test server listens on another. So they are given the batches under the fixture's own name
 * (`renamed`, as the recording is stored), and each URL they plan is requested at the server's
 * address. The batches returned are the worker's, at that address; the render outcome is under HOST.
 */
export async function record(
  variant: SiteVariant,
  open?: FixtureServer,
): Promise<{ base: string; batches: BatchResult[]; render: RenderOutcome | null }> {
  const server = open ?? (await startServer(handler(variant)));
  try {
    const clock = new InstantClock(STARTED);
    const deps = {
      clock,
      sites: new Sites(clock),
      fetcher: createFetcher(clock, { bypassSsrf: true }),
      robotsCache: new RobotsCache(clock),
      declarationCache: new DeclarationCache(clock),
    };
    // No page is rendered yet while the batches are planned.
    const input = { ...recordedInput(), render: null };
    const atServer = (urls: readonly string[]) => urls.map((u) => u.replace(HOST, server.base));
    const batches: BatchResult[] = [];
    const named = () => renamed(batches, server.base);
    let n = 0;
    for (;;) {
      const crawl = named().filter((b): b is CrawlBatchResult => b.kind === 'crawl');
      const urls = nextCrawlBatch(input.seeds, crawl, PAGE_CAP);
      if (urls === null) break;
      batches.push(await runBatch(request('crawl', n++, atServer(urls)), deps));
    }
    if (variant.linkRedirectTarget) return { base: server.base, batches, render: null };
    const planned = () => {
      const a = assemble(input, readBatches(named(), input.check, input.lineage.worker_release));
      return { a, s: sample(a) };
    };
    let { s } = planned();
    batches.push(
      await runBatch(request('access', n++, atServer(s.stage1.map((p) => p.url))), deps),
    );
    ({ s } = planned());
    if (s.stage2_needed)
      batches.push(
        await runBatch(request('access', n++, atServer(s.stage2.map((p) => p.url))), deps),
      );
    const { a, s: last } = planned();
    const plan = renderCandidates(a, [...last.stage1, ...last.stage2], [], new Map());
    const site = servedSite(variant);
    const replies = plan.candidates.map((c) => {
      const path = c.url.slice(HOST.length) || '/';
      const html = site.pages.get(path)!.body;
      const rendered = (CLIENT_RENDERED as readonly string[]).includes(path)
        ? site.renderedGuide(path)
        : html;
      return {
        provenance: 'built-site',
        url: c.url,
        static: { html, browser_ms: 1200 },
        rendered: { html: rendered, browser_ms: 2400 },
      };
    });
    const render = await renderCheck({
      ...plan,
      client: fakeClient(replies),
      admit: async () => undefined,
      caps: { perCheckMs: 600_000, perDayMs: 3_600_000 },
      daily: memoryDailyBudget(),
    });
    return { base: server.base, batches, render };
  } finally {
    if (!open) await server.close();
  }
}

/** JSON with the loopback base renamed, as the access fixtures rename theirs. */
export function renamed<T>(value: T, base: string): T {
  const loopback = base.replace(/^http:\/\//, '');
  return JSON.parse(
    JSON.stringify(value)
      .replaceAll(base, HOST)
      .replaceAll(loopback, HOST.replace(/^https:\/\//, '')),
  ) as T;
}

const renumbered = (batches: BatchResult[]): BatchResult[] => {
  let i = 0;
  return batches.map((b) =>
    b.kind !== 'access'
      ? b
      : {
          ...b,
          access_tests: b.access_tests.map(
            (t): AccessTest => ({
              ...t,
              id: `e0000000-0000-4000-8000-${String(++i).padStart(12, '0')}`,
            }),
          ),
        },
  );
};

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

function writeBatches(dir: string, batches: BatchResult[]): void {
  const at = new URL(`${dir}/`, OUT);
  rmSync(at, { recursive: true, force: true });
  mkdirSync(at, { recursive: true });
  batches.forEach((b, i) =>
    writeFileSync(new URL(`${String(i).padStart(2, '0')}-${b.kind}.json`, at), json(b)),
  );
}

async function main(): Promise<void> {
  if (!process.argv.includes('--expected-only')) {
    const golden = await record({ linkRedirectTarget: false });
    writeBatches('batches', renumbered(renamed(golden.batches, golden.base)));
    writeFileSync(new URL('render.json', OUT), json(golden.render));
    const variant = await record({ linkRedirectTarget: true });
    writeBatches('variant', renamed(variant.batches, variant.base));
  }
  const built = buildCheck(recordedBuild());
  writeFileSync(new URL('expected.json', OUT), serialiseBuilt(built));
  // The web fixtures are Prettier-formatted, as the repository's format check reads them.
  const path = WEB_FIXTURE.pathname;
  const options = { ...(await resolveConfig(path)), filepath: path };
  writeFileSync(WEB_FIXTURE, await format(json(webFixture(built)), options));
}

const WEB_FIXTURE = new URL(
  '../../../../../apps/web/lib/fixtures/v2/built-site.json',
  import.meta.url,
);

/**
 * The built check as a web FixtureDataset (apps/web/lib/fixtures/v2/built-site.json), so the screens
 * render what the builder produces. An anonymous site, so no account, seat or usage event; the whole
 * check is held, so nothing is withheld. `engine_derived` names the collections the builder filled.
 */
function webFixture(built: BuiltCheck): FixtureDataset {
  return {
    provenance: 'fixture',
    as_of: built.check.finished_at!,
    description:
      "built-site.test (a reserved, fictional host), audited without an account: the rows the check builder (CC-20a) made from the crawl worker's own batches for the synthetic shop in packages/engine/fixtures/v2/build/site, with one of each planted defect. Nothing here was written by hand.",
    engine_derived: [
      '/checks/0',
      '/page_results',
      '/link_edges',
      '/access_tests',
      '/fixes',
      '/fix_events',
      '/changes',
      '/lineages',
    ],
    accounts: [],
    seats: [],
    sites: [recordedInput().site],
    checks: [built.check],
    page_results: built.page_results,
    link_edges: built.link_edges,
    access_tests: built.access_tests,
    fixes: built.fixes,
    fix_events: built.fix_events,
    changes: built.changes,
    alert_rules: [],
    reports: [],
    lineages: [built.lineages.grading, built.lineages.fetching],
    usage_events: built.usage_event ? [built.usage_event] : [],
    withheld: [],
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await main();
