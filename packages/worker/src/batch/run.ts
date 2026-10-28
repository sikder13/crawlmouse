import type { AccessTest, LinkEdge } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { Fetcher } from '../fetch/fetcher.js';
import { CANARY, CRAWLERS } from '../identities.js';
import type { Sites } from '../politeness/sites.js';
import { bodyExcerpt, webUrlOrNull } from '../rows/evidence.js';
import type { CrawlPage } from '../rows/crawl-page.js';
import { runAccess } from './access.js';
import { Budget } from './budget.js';
import { runCrawl } from './crawl.js';
import { Findings, type Finding, type PartialReason } from './findings.js';
import type { FetchContext } from './polite-fetch.js';
import { batchIdOf, urlsOf, type BatchRequest } from './request.js';
import { BatchRobots, type OriginRules, type RobotsCache } from './site-rules.js';

/** Runs one batch to its result. Shared state (sites, robots cache) lives in `deps` and outlives it. */

export interface BatchDeps {
  clock: Clock;
  sites: Sites;
  fetcher: Fetcher;
  robotsCache: RobotsCache;
}

export interface RobotsEvidence {
  origin: string;
  state: OriginRules['reading']['state'];
  why: string | null;
  status: number | null;
  final_url: string | null;
  fetched_at: string;
  from_cache: boolean;
  crawl_delay_s: number | null;
  body_excerpt: string | null;
}

interface ResultCommon {
  batch_id: string;
  check_id: string;
  site_id: string;
  started_at: string;
  finished_at: string;
  requests: number;
  bytes: number;
  coverage: { urls_requested: number; urls_complete: number };
  /** Null when the batch did everything it was asked; otherwise why it did not. */
  partial: { reasons: PartialReason[] } | null;
  findings: Finding[];
  robots: RobotsEvidence[];
}

export type BatchResult =
  | (ResultCommon & { kind: 'access'; access_tests: AccessTest[] })
  | (ResultCommon & {
      kind: 'crawl';
      pages: CrawlPage[];
      link_edges: LinkEdge[];
      discovered_urls: string[];
    });

export interface Progress {
  urls_done: number;
  urls_total: number;
  requests: number;
}

export async function runBatch(
  req: BatchRequest,
  deps: BatchDeps,
  onProgress: (p: Progress) => void = () => undefined,
): Promise<BatchResult> {
  const startedAt = deps.clock.now();
  const budget = new Budget(req.budget, deps.clock);
  const ctx: FetchContext = {
    sites: deps.sites,
    fetcher: deps.fetcher,
    budget,
    abort: new AbortController(),
  };
  const findings = new Findings();
  const tokens =
    req.kind === 'access' ? [...CRAWLERS.map((c) => c.robotsToken!), CANARY.robotsToken!] : [];
  const robots = new BatchRobots(ctx, deps.robotsCache, tokens);
  const requested = urlsOf(req);
  let urlsDone = 0;
  const pageDone = () =>
    onProgress({
      urls_done: ++urlsDone,
      urls_total: requested.length,
      requests: budget.used.requests,
    });
  const run = { ctx, robots, findings, clock: deps.clock, checkId: req.check_id, pageDone };

  const done =
    req.kind === 'access' ? await runAccess(run, req.pages) : await runCrawl(run, req.urls);
  const origins = (await robots.all()).filter((o): o is OriginRules => !('reason' in o));
  const reasons = findings.partialReasons();
  const common: ResultCommon = {
    batch_id: batchIdOf(req),
    check_id: req.check_id,
    site_id: req.site_id,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(deps.clock.now()).toISOString(),
    requests: budget.used.requests,
    bytes: budget.used.bytes,
    coverage: { urls_requested: requested.length, urls_complete: done.complete },
    partial: reasons.length ? { reasons } : null,
    findings: findings.list(),
    robots: origins.map(robotsEvidence),
  };
  if ('rows' in done) return { ...common, kind: 'access', access_tests: done.rows };
  const asked = new Set(requested);
  const discovered = [...new Set(done.link_edges.map((e) => e.to_url))].filter(
    (u) => !asked.has(u),
  );
  return {
    ...common,
    kind: 'crawl',
    pages: done.pages,
    link_edges: done.link_edges,
    discovered_urls: discovered,
  };
}

function robotsEvidence(o: OriginRules): RobotsEvidence {
  const f = o.reading.fetch;
  return {
    origin: o.origin,
    state: o.reading.state,
    why: 'why' in o.reading ? o.reading.why : null,
    status: f.status,
    final_url: webUrlOrNull(f.finalUrl),
    fetched_at: new Date(f.startedAt).toISOString(),
    from_cache: o.fromCache,
    crawl_delay_s: o.crawlDelayS,
    body_excerpt: bodyExcerpt(f),
  };
}
