import { extractPage, toPersistableText } from '@crawlmouse/engine/worker';
import { LinkEdgeSchema, type LinkEdge } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { oursAllow } from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { CrawlPageSchema, RAW_TEXT_BYTES, type CrawlPage } from '../rows/crawl-page.js';
import {
  evidenceHeaders,
  requestHeaders,
  requestLimitations,
  standardStatus,
  webUrlOrNull,
} from '../rows/evidence.js';
import { TOO_DEEP, countWords, isHtml, parseHtml, servedText } from '../rows/text.js';
import * as say from '../verdict/limitations.js';
import { readResponse, type ResponseClass } from '../verdict/response.js';
import type { Findings } from './findings.js';
import { politeFetch, type FetchContext } from './polite-fetch.js';
import { MAX_CRAWL_DELAY_S, originBlock, pathOf, type BatchRobots } from './site-rules.js';

/**
 * A crawl batch: each URL is requested once as our crawl identity, two at a time at most (the site's
 * limiter decides when each starts). A served HTML page yields its text, its same-site links as
 * LinkEdges (one per target, the first anchor kept), and its rel=canonical.
 */

/** Edges recorded per page; a page with more says how many were left out. */
export const MAX_EDGES_PER_PAGE = 1000;
const ANCHOR_TEXT_BYTES = 2000;
const CONCURRENT_PAGES = 2;

export interface CrawlRun {
  ctx: FetchContext;
  robots: BatchRobots;
  findings: Findings;
  clock: Clock;
  checkId: string;
  /** Called after each page, for progress. */
  pageDone: () => void;
}

export interface CrawlOutput {
  pages: CrawlPage[];
  link_edges: LinkEdge[];
  complete: number;
}

interface PageOutcome {
  page: CrawlPage;
  edges: LinkEdge[];
  complete: boolean;
}

export async function runCrawl(run: CrawlRun, urls: readonly string[]): Promise<CrawlOutput> {
  const outcomes: PageOutcome[] = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      outcomes[i] = await crawlPage(run, urls[i]!);
      run.pageDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_PAGES, urls.length) }, worker));
  return {
    pages: outcomes.map((o) => o.page),
    link_edges: outcomes.flatMap((o) => o.edges),
    complete: outcomes.filter((o) => o.complete).length,
  };
}

async function crawlPage(run: CrawlRun, url: string): Promise<PageOutcome> {
  const without = (
    outcome: CrawlPage['outcome'],
    why: string,
    evidence: FetchOutcome | null,
    complete: boolean,
  ): PageOutcome => ({
    page: pageRow(
      run,
      url,
      outcome,
      null,
      evidence,
      [why],
      outcome === 'robots_disallowed' ? 'declared' : 'simulated',
    ),
    edges: [],
    complete,
  });

  const rules = await run.robots.forUrl(url);
  if ('reason' in rules) {
    run.findings.notRequested(rules);
    return without('not_requested', say.notRequested(rules), null, false);
  }
  run.findings.origin(rules);
  const block = originBlock(rules);
  if (block === 'robots_unreachable' && rules.reading.state === 'unreachable') {
    return without(
      'not_requested',
      say.robotsUnreachable(rules.reading.why),
      rules.reading.fetch,
      false,
    );
  }
  if (block === 'site_refused')
    return without('failed', say.SITE_REFUSED, rules.reading.fetch, false);
  if (block === 'crawl_delay_over_limit') {
    const why = say.crawlDelayOverLimit(rules.crawlDelayS!, MAX_CRAWL_DELAY_S);
    return without('not_requested', why, rules.reading.fetch, false);
  }
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  if (!oursAllow(parsed, pathOf(url))) {
    return without('robots_disallowed', say.ROBOTS_DISALLOWS_US, rules.reading.fetch, true);
  }

  const r = await politeFetch(run.ctx, url, CRAWL, {
    offSite: 'stop',
    mayRequest: run.robots.mayRequest(CRAWL),
  });
  if ('notRequested' in r) {
    run.findings.notRequested(r.notRequested);
    return without('not_requested', say.notRequested(r.notRequested), null, false);
  }
  const f = r.fetch;
  const reading = readResponse(f);
  run.ctx.sites.recordPage(siteKeyOf(url), reading.class === 'challenged');
  const limitations = f.redirectStop ? [say.redirectStopped(f.redirectStop)] : [];
  if (reading.class !== 'served' || !isHtml(f) || f.finalUrl === null) {
    return {
      page: pageRow(run, url, f.error ? 'failed' : 'fetched', reading.class, f, limitations),
      edges: [],
      complete: true,
    };
  }

  const $ = parseHtml(f.body);
  if (!$) {
    return {
      page: pageRow(run, url, 'fetched', reading.class, f, [...limitations, TOO_DEEP]),
      edges: [],
      complete: true,
    };
  }
  // As the engine's v2 crawl does: share-action and media links are not pages of the site.
  const extracted = extractPage($, f.finalUrl, { excludeNonContentLinks: true });
  const text = servedText($);
  const edges = edgesFrom(run.checkId, f.finalUrl, extracted.links);
  if (edges.withheld > 0) {
    limitations.push(
      `${edges.withheld} more same-site links were found on this page and not recorded; ${MAX_EDGES_PER_PAGE} are kept per page.`,
    );
  }
  const page = pageRow(run, url, 'fetched', reading.class, f, limitations, 'simulated', {
    raw_text: toPersistableText(text, RAW_TEXT_BYTES),
    word_count: countWords(text),
    canonical_url: extracted.canonicalUrl ?? null,
    links_out: edges.distinct,
  });
  return { page, edges: edges.kept, complete: true };
}

function edgesFrom(
  checkId: string,
  fromUrl: string,
  links: ReadonlyArray<{ toUrl: string; anchorText: string; isGenericAnchor: boolean }>,
): { kept: LinkEdge[]; distinct: number; withheld: number } {
  const byTarget = new Map<string, LinkEdge>();
  for (const l of links) {
    if (byTarget.has(l.toUrl) || webUrlOrNull(l.toUrl) === null) continue;
    byTarget.set(
      l.toUrl,
      LinkEdgeSchema.parse({
        check_id: checkId,
        from_url: fromUrl,
        to_url: l.toUrl,
        anchor_text: toPersistableText(l.anchorText, ANCHOR_TEXT_BYTES),
        is_generic_anchor: l.isGenericAnchor,
        // Every link here was read from the HTML as served, before any script ran.
        js_only: false,
      }),
    );
  }
  const all = [...byTarget.values()];
  return {
    kept: all.slice(0, MAX_EDGES_PER_PAGE),
    distinct: all.length,
    withheld: Math.max(0, all.length - MAX_EDGES_PER_PAGE),
  };
}

function pageRow(
  run: CrawlRun,
  url: string,
  outcome: CrawlPage['outcome'],
  response: ResponseClass | null,
  f: FetchOutcome | null,
  limitations: string[],
  evidence: 'declared' | 'simulated' = 'simulated',
  read: Pick<CrawlPage, 'raw_text' | 'word_count' | 'canonical_url' | 'links_out'> = {
    raw_text: null,
    word_count: null,
    canonical_url: null,
    links_out: null,
  },
): CrawlPage {
  return CrawlPageSchema.parse({
    check_id: run.checkId,
    url,
    outcome,
    response,
    evidence_class: evidence,
    identity_sent: (f?.identity ?? CRAWL).userAgent,
    source_ip_class: 'fly_egress',
    limitations: [...limitations, ...requestLimitations(f)],
    fetched_at: new Date(f?.startedAt ?? run.clock.now()).toISOString(),
    request_headers: f ? requestHeaders(f) : [],
    status_code: standardStatus(f?.status ?? null),
    final_url: f ? webUrlOrNull(f.finalUrl) : null,
    headers: f ? evidenceHeaders(f) : [],
    byte_count: f && f.status !== null ? f.bytes : null,
    ...read,
  });
}
