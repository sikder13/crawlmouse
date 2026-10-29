import { canonicalizeUrl } from '@crawlmouse/engine/worker';
import { LinkEdgeSchema, type LinkEdge } from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { oursAllow } from '../politeness/robots.js';
import { siteKeyOf } from '../politeness/site-key.js';
import { CrawlPageSchema, type CrawlPage } from '../rows/crawl-page.js';
import { bounded, CAPS, MAX_URL_LENGTH } from '../rows/bounded.js';
import {
  evidenceHeaders,
  isWebUrl,
  requestHeaders,
  requestLimitations,
  standardStatus,
  storedLimitations,
  storedUrl,
  userAgentOf,
} from '../rows/evidence.js';
import { linksNotReadNote, readLinks, type PageLinks } from '../rows/links.js';
import { countWords, isHtml, readHtml, servedText } from '../rows/text.js';
import * as say from '../verdict/limitations.js';
import { readResponse, type ResponseClass } from '../verdict/response.js';
import type { Findings } from './findings.js';
import { politeFetch, type FetchContext, type NotRequested } from './polite-fetch.js';
import { pathOf, type BatchRobots, type SiteBlock } from './site-rules.js';

/**
 * A crawl batch: each URL is requested once as our crawl identity, two at a time at most (the site's
 * limiter decides when each starts). A served HTML page yields its text, its same-host links as
 * LinkEdges (one per target, the first anchor kept), and its rel=canonical.
 */

/** Edges recorded per page; a page with more says how many were left out. */
export const MAX_EDGES_PER_PAGE = 1000;
/**
 * What one batch may hold in served text and link edges. Pages past it keep their row but not their
 * text or links, and the batch is partial with `result_size`. Response bytes are a separate budget,
 * set by the caller.
 */
export const MAX_RESULT_TEXT_BYTES = 8 * 1024 * 1024;
const CONCURRENT_PAGES = 2;

export interface CrawlRun {
  ctx: FetchContext;
  robots: BatchRobots;
  findings: Findings;
  clock: Clock;
  checkId: string;
  /** Set when robots.txt, or the batch itself, keeps every page from being requested. */
  blocked: SiteBlock | NotRequested | null;
  /** Called after each page, for progress. */
  pageDone: () => void;
}

export interface CrawlOutput {
  pages: CrawlPage[];
  link_edges: LinkEdge[];
  complete: number;
  /** URLs a page's chain ended on and requested: what the crawl has read, besides its own URLs. */
  landed: string[];
}

interface PageOutcome {
  page: CrawlPage;
  edges: LinkEdge[];
  complete: boolean;
  /** The URL the chain ended on, when it was requested; null when it stopped short or failed. */
  landed?: string | null;
}

export async function runCrawl(run: CrawlRun, urls: readonly string[]): Promise<CrawlOutput> {
  const room = { bytes: MAX_RESULT_TEXT_BYTES };
  const outcomes: PageOutcome[] = new Array(urls.length);
  let next = 0;
  // Once a page throws, the batch has failed: the other worker takes no more pages, and requests
  // already queued at the limiter are dropped.
  let failed = false;
  const worker = async () => {
    while (!failed && next < urls.length) {
      const i = next++;
      try {
        outcomes[i] = await crawlPage(run, urls[i]!, room);
      } catch (e) {
        failed = true;
        run.ctx.abort.abort();
        throw e;
      }
      run.pageDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_PAGES, urls.length) }, worker));
  return {
    pages: outcomes.map((o) => o.page),
    link_edges: outcomes.flatMap((o) => o.edges),
    complete: outcomes.filter((o) => o.complete).length,
    landed: outcomes.flatMap((o) => (o.landed ? [o.landed] : [])),
  };
}

async function crawlPage(
  run: CrawlRun,
  url: string,
  room: { bytes: number },
): Promise<PageOutcome> {
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

  const blocked = run.blocked;
  if (blocked && 'reason' in blocked)
    return without('not_requested', say.notRequested(blocked), null, false);
  if (blocked) {
    const outcome = blocked.block === 'site_refused' ? 'failed' : 'not_requested';
    return without(outcome, say.siteBlocked(blocked), blocked.rules.reading.fetch, false);
  }
  const rules = await run.robots.forUrl(url);
  if ('reason' in rules) return without('not_requested', say.notRequested(rules), null, false);
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  if (!oursAllow(parsed, pathOf(url))) {
    return without('robots_disallowed', say.ROBOTS_DISALLOWS_US, rules.reading.fetch, true);
  }

  const r = await politeFetch(run.ctx, url, CRAWL, {
    offSite: 'stop',
    gate: run.robots.gate(CRAWL),
  });
  if ('notRequested' in r) {
    run.findings.notRequested(r.notRequested);
    return without('not_requested', say.notRequested(r.notRequested), null, false);
  }
  if (r.cut) run.findings.notRequested(r.cut);
  const f = r.fetch;
  // A chain stopped at a redirect never requested its last Location, so it has not landed there.
  const landed = f.redirectStop === null && f.status !== null ? f.finalUrl : null;
  const reading = readResponse(f);
  run.ctx.sites.recordPage(siteKeyOf(url), reading.class === 'challenged');
  const limitations = f.redirectStop ? [say.redirectStopped(f.redirectStop, r.cut ?? null)] : [];
  if (reading.class !== 'served' || !isHtml(f) || f.finalUrl === null) {
    // Complete when a response came back, whatever it was; a request that failed, or a redirect the
    // batch stopped before following, is not.
    return {
      page: pageRow(run, url, f.error ? 'failed' : 'fetched', reading.class, f, limitations),
      edges: [],
      complete: f.error === null && f.redirectStop !== 'batch_stopped',
      landed,
    };
  }

  const { $, note } = readHtml(f);
  if (note) limitations.push(note);
  if (!$)
    return {
      page: pageRow(run, url, 'fetched', reading.class, f, limitations),
      edges: [],
      complete: true,
      landed,
    };
  // As the engine's v2 crawl does: share-action and media links are not pages of the site.
  const extracted = readLinks($, f.finalUrl);
  const text = servedText($);
  const fromUrl = bounded(canonicalizeUrl(f.finalUrl), CAPS.url);
  const edges =
    fromUrl === null
      ? { kept: [], distinct: 0, withheld: 0, tooLong: 0 }
      : edgesFrom(run.checkId, fromUrl, extracted.links);
  if (fromUrl === null) {
    limitations.push(
      `The page's own URL is over ${MAX_URL_LENGTH} characters, so its links were not recorded.`,
    );
  }
  const unread = linksNotReadNote({
    ...extracted.notRead,
    tooLong: extracted.notRead.tooLong + edges.tooLong,
  });
  if (unread) limitations.push(unread);
  if (edges.withheld > 0) {
    limitations.push(
      `${edges.withheld} more same-host links were found on this page and not recorded; ${MAX_EDGES_PER_PAGE} are kept per page.`,
    );
  }
  const rawText = bounded(text, CAPS.rawText);
  const canonical =
    extracted.canonicalUrl === undefined ? null : bounded(extracted.canonicalUrl, CAPS.url);
  if (extracted.canonicalUrl !== undefined && canonical === null) {
    limitations.push(
      `The page's rel=canonical is over ${MAX_URL_LENGTH} characters, so it was not recorded.`,
    );
  }
  const cost = Buffer.byteLength(rawText) + edges.kept.reduce((n, e) => n + edgeBytes(e), 0);
  const recorded = cost <= room.bytes;
  if (recorded) room.bytes -= cost;
  else {
    run.findings.resultSizeLimit(MAX_RESULT_TEXT_BYTES);
    limitations.push(
      `The text and links of this page were not recorded: the batch had used its ${MAX_RESULT_TEXT_BYTES / (1024 * 1024)} MiB for them.`,
    );
  }
  const page = pageRow(run, url, 'fetched', reading.class, f, limitations, 'simulated', {
    raw_text: recorded ? rawText : null,
    word_count: countWords(text),
    canonical_url: canonical,
    links_out: edges.distinct,
  });
  return { page, edges: recorded ? edges.kept : [], complete: true, landed };
}

const edgeBytes = (e: LinkEdge): number =>
  Buffer.byteLength(e.from_url) +
  Buffer.byteLength(e.to_url) +
  Buffer.byteLength(e.anchor_text) +
  128;

/**
 * One edge per distinct same-host target, in page order; only the first MAX_EDGES_PER_PAGE are built.
 * Both ends are canonical (the engine's canonicalizeUrl), the spelling the v1 graph keys pages on.
 */
function edgesFrom(
  checkId: string,
  fromUrl: string,
  links: PageLinks['links'],
): { kept: LinkEdge[]; distinct: number; withheld: number; tooLong: number } {
  const seen = new Set<string>();
  const kept: LinkEdge[] = [];
  let tooLong = 0;
  for (const l of links) {
    // A link to the page itself is not an edge, as in the v1 graph; to_url is already canonical.
    if (l.toUrl === fromUrl || seen.has(l.toUrl) || !isWebUrl(l.toUrl)) continue;
    const toUrl = bounded(l.toUrl, CAPS.url);
    if (toUrl === null) {
      tooLong++;
      continue;
    }
    seen.add(l.toUrl);
    if (kept.length >= MAX_EDGES_PER_PAGE) continue;
    kept.push(
      LinkEdgeSchema.parse({
        check_id: checkId,
        from_url: fromUrl,
        to_url: toUrl,
        anchor_text: bounded(l.anchorText, CAPS.anchorText),
        is_generic_anchor: l.isGenericAnchor,
        // Every link here was read from the HTML as served, before any script ran.
        js_only: false,
      }),
    );
  }
  return { kept, distinct: seen.size, withheld: seen.size - kept.length, tooLong };
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
    // A request URL, which the request schema already holds within this cap.
    url: bounded(url, CAPS.url),
    outcome,
    response,
    evidence_class: evidence,
    identity_sent: userAgentOf(f, CRAWL),
    source_ip_class: 'fly_egress',
    limitations: storedLimitations([...limitations, ...requestLimitations(f)]),
    fetched_at: new Date(f?.startedAt ?? run.clock.now()).toISOString(),
    request_headers: f ? requestHeaders(f) : [],
    status_code: standardStatus(f?.status ?? null),
    final_url: f ? storedUrl(f.finalUrl) : null,
    headers: f ? evidenceHeaders(f) : [],
    byte_count: f && f.status !== null ? f.bytes : null,
    ...read,
  });
}
