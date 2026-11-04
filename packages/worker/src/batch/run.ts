import { canonicalizeUrl } from '@crawlmouse/engine/worker';
import {
  BatchPartialSchema,
  type AccessTest,
  type BatchPartial,
  type DeclarationFetch,
  type LinkEdge,
} from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { Fetcher } from '../fetch/fetcher.js';
import { CANARY, CRAWL, CRAWLERS } from '../identities.js';
import { siteKeyOf } from '../politeness/site-key.js';
import type { Sites } from '../politeness/sites.js';
import { bounded, CAPS } from '../rows/bounded.js';
import { bodyExcerpt, storedUrl, userAgentOf } from '../rows/evidence.js';
import { LOCAL_VANTAGE, type Vantage } from '../vantage.js';
import type { CrawlPage } from '../rows/crawl-page.js';
import { runAccess } from './access.js';
import { Budget } from './budget.js';
import { runCrawl } from './crawl.js';
import { fetchDeclarations } from './declarations.js';
import { Findings, type Finding } from './findings.js';
import { inlineReader, type PageReader } from '../reader/read.js';
import type { FetchContext } from './polite-fetch.js';
import { batchIdOf, urlsOf, type BatchRequest } from './request.js';
import { BatchRobots, type OriginRules, type RobotsCache } from './site-rules.js';

/** Runs one batch to its result. Shared state (sites, robots cache) lives in `deps` and outlives it. */

export interface BatchDeps {
  clock: Clock;
  sites: Sites;
  fetcher: Fetcher;
  robotsCache: RobotsCache;
  /** Reads pages; the server passes the reader thread. Inline when not given, as tests run it. */
  reader?: PageReader;
  /** Where requests leave from; off Fly and unreleased when not given, as tests run it. */
  vantage?: Vantage;
}

export interface RobotsEvidence {
  origin: string;
  /** The user agent robots.txt was requested with: always our crawler's. */
  identity_sent: string;
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
  /** Null when the batch did everything it was asked; otherwise why it did not (the contract's). */
  partial: BatchPartial;
  findings: Finding[];
  robots: RobotsEvidence[];
  /** The declaration files a crawl batch requested, once each (declarations.ts); none for access. */
  declarations: DeclarationFetch[];
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
  // robots.txt for every origin first: one that blocks the site keeps the whole batch from fetching.
  const blocked = await robots.preload(requested);
  if (blocked && 'reason' in blocked) findings.notRequested(blocked);
  const run = {
    ctx,
    robots,
    findings,
    clock: deps.clock,
    reader: deps.reader ?? inlineReader,
    checkId: req.check_id,
    blocked,
    pageDone,
    vantage: deps.vantage ?? LOCAL_VANTAGE,
  };

  const done =
    req.kind === 'access' ? await runAccess(run, req.pages) : await runCrawl(run, req.urls);
  const origins = (await robots.all()).filter((o): o is OriginRules => !('reason' in o));
  for (const o of origins) findings.origin(o);
  if (budget.exhausted) findings.budgetSpent(budget.exhausted);
  for (const site of new Set(requested.map(siteKeyOf))) {
    const stop = deps.sites.stopOf(site);
    if (stop && stop.at >= startedAt) findings.stopped(site, stop);
  }
  const reasons = findings.partialReasons();
  // After the pages and after their accounting: a declaration takes from the same budget and limiter,
  // so a spent budget leaves a declaration unrequested, never a page, and what became of each is on
  // its own record, not in the batch's coverage, findings or partial reasons.
  const declarations = req.kind === 'crawl' ? await fetchDeclarations(run, req.urls[0]!) : [];
  const common: ResultCommon = {
    batch_id: batchIdOf(req),
    check_id: req.check_id,
    site_id: req.site_id,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(deps.clock.now()).toISOString(),
    requests: budget.used.requests,
    bytes: budget.used.bytes,
    coverage: { urls_requested: requested.length, urls_complete: done.complete },
    partial: BatchPartialSchema.parse(reasons.length ? { reasons } : null),
    findings: findings.list(),
    robots: origins.map(robotsEvidence),
    declarations,
  };
  if ('rows' in done) return { ...common, kind: 'access', access_tests: done.rows };
  // Compared in the canonical spelling the edges use, so a page already crawled is not rediscovered.
  // A chain's last Location counts only when it was requested: a stopped redirect's was not.
  const crawled = new Set([...requested, ...done.landed].map((u) => canonicalizeUrl(u)));
  const discovered = [...new Set(done.link_edges.map((e) => e.to_url))].filter(
    (u) => !crawled.has(u),
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
    origin: bounded(o.origin, CAPS.origin),
    identity_sent: userAgentOf(f, CRAWL),
    state: o.reading.state,
    why: 'why' in o.reading ? o.reading.why : null,
    status: f.status,
    final_url: storedUrl(f.finalUrl),
    fetched_at: new Date(f.startedAt).toISOString(),
    from_cache: o.fromCache,
    crawl_delay_s: o.crawlDelayS,
    body_excerpt: bodyExcerpt(f),
  };
}
