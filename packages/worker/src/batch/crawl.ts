import { canonicalizeUrl } from '@crawlmouse/engine/worker';
import {
  LinkEdgeSchema,
  type Hreflang,
  type LinkEdge,
  type SearchRobots,
} from '@crawlmouse/types/v2';
import type { Clock } from '../clock.js';
import type { LivePage, PageCounts } from './run.js';
import type { FetchOutcome } from '../fetch/fetcher.js';
import { CRAWL } from '../identities.js';
import { oursAllow, PathMatch, searchVerdicts } from '../politeness/robots.js';
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
import { headerDeclaresHreflang } from '../rows/declared.js';
import { linksNotReadNote, type PageLinks } from '../rows/links.js';
import { redirectChain } from '../rows/redirect.js';
import { isHtml } from '../rows/text.js';
import * as say from '../verdict/limitations.js';
import type { ReaderNotRead } from '../verdict/limitations.js';
import { readResponse, type ResponseClass } from '../verdict/response.js';
import { LOCAL_VANTAGE, type Vantage } from '../vantage.js';
import type { Findings } from './findings.js';
import { isNotRead, type PageRead, type PageReader, type StackHeaders } from '../reader/read.js';
import { politeFetch, type FetchContext, type NotRequested } from './polite-fetch.js';
import { pathOf, type BatchRobots, type SiteBlock } from './site-rules.js';
import { jsonBytes } from './json-bytes.js';

/**
 * A crawl batch: each URL is requested once as our crawl identity, two at a time at most (the site's
 * limiter decides when each starts). A served HTML page yields its text, its same-host links as
 * LinkEdges (one per target, the first anchor kept), and its rel=canonical.
 */

/** Edges recorded per page; a page with more says how many were left out. */
export const MAX_EDGES_PER_PAGE = 1000;
/**
 * What one batch may hold in served text and link edges. Pages past it keep their row but not their
 * text or links, and the batch is partial with `result_size`. Counted in the bytes the result's JSON
 * takes (json-bytes.ts), not the text's UTF-8 bytes. Response bytes are a separate budget, set by the
 * caller.
 */
export const MAX_RESULT_TEXT_BYTES = 8 * 1024 * 1024;
const CONCURRENT_PAGES = 2;

export interface CrawlRun {
  ctx: FetchContext;
  robots: BatchRobots;
  findings: Findings;
  clock: Clock;
  reader: PageReader;
  checkId: string;
  /** Set when robots.txt, or the batch itself, keeps every page from being requested. */
  blocked: SiteBlock | NotRequested | null;
  /** Called after each page, for progress. */
  pageDone: (read: PageCounts) => void;
  vantage?: Vantage;
}

export interface CrawlOutput {
  pages: CrawlPage[];
  link_edges: LinkEdge[];
  complete: number;
  /** URLs a page's chain ended on and requested: what the crawl has read, besides its own URLs. */
  landed: string[];
  /** Each edge target (canonical) with its address as first linked, in page order (F-252). */
  linked: Map<string, string>;
}

interface PageOutcome {
  page: CrawlPage;
  edges: LinkEdge[];
  /** Each recorded edge's target with its address as the page linked it. */
  linked?: ReadonlyMap<string, string>;
  complete: boolean;
  /** The URL the chain ended on, when it was requested; null when it stopped short or failed. */
  landed?: string | null;
}

/** Per page, so a page of thousands of links cannot grow a running batch's record. */
const LIVE_EDGES_PER_PAGE = 20;
const LIVE_URL_CHARS = 512;

/** The page for the live screen; null where the stream could not fill a `page_fetched` from it. */
export function livePageOf(page: CrawlPage, edges: readonly LinkEdge[]): LivePage | null {
  if (page.outcome !== 'fetched' || page.status_code === null || page.timing === null) return null;
  if (!page.links_read || page.links_out === null || page.url.length > LIVE_URL_CHARS) return null;
  return {
    url: page.url,
    status: page.status_code,
    ms: page.timing.total_ms,
    links: page.links_out,
    identity: page.identity_sent,
    edges: edges
      .filter((e) => e.from_url.length <= LIVE_URL_CHARS && e.to_url.length <= LIVE_URL_CHARS)
      .slice(0, LIVE_EDGES_PER_PAGE)
      .map((e) => ({ from: e.from_url, to: e.to_url, js_only: e.js_only })),
  };
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
        outcomes[i] = await crawlPage(run, urls[i]!, room, i === 0);
      } catch (e) {
        failed = true;
        run.ctx.abort.abort();
        throw e;
      }
      const { page, edges } = outcomes[i]!;
      run.pageDone({
        pages: page.outcome === 'fetched' ? 1 : 0,
        links: edges.length,
        live: livePageOf(page, edges),
        homepage: i === 0 && page.response === 'served',
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_PAGES, urls.length) }, worker));
  return {
    pages: outcomes.map((o) => o.page),
    link_edges: outcomes.flatMap((o) => o.edges),
    complete: outcomes.filter((o) => o.complete).length,
    landed: outcomes.flatMap((o) => (o.landed ? [o.landed] : [])),
    linked: firstLinked(outcomes),
  };
}

/** The address each edge target was first linked at, over the batch's pages in order. */
function firstLinked(outcomes: readonly PageOutcome[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of outcomes)
    for (const [to, href] of o.linked ?? []) if (!out.has(to)) out.set(to, href);
  return out;
}

async function crawlPage(
  run: CrawlRun,
  url: string,
  room: { bytes: number },
  first: boolean,
): Promise<PageOutcome> {
  const path = pathOf(url);
  const without = (
    outcome: CrawlPage['outcome'],
    why: string,
    evidence: FetchOutcome | null,
    complete: boolean,
    search: SearchRobots,
  ): PageOutcome => ({
    page: pageRow(
      run,
      url,
      outcome,
      null,
      evidence,
      [why],
      outcome === 'robots_disallowed' ? 'declared' : 'simulated',
      notRead(null, search),
    ),
    edges: [],
    complete,
  });

  const blocked = run.blocked;
  if (blocked && 'reason' in blocked) {
    return without(
      'not_requested',
      say.notRequested(blocked),
      null,
      false,
      searchVerdicts(null, path),
    );
  }
  if (blocked) {
    const outcome = blocked.block === 'site_refused' ? 'failed' : 'not_requested';
    const search = searchVerdicts(blocked.rules.reading, path);
    return without(outcome, say.siteBlocked(blocked), blocked.rules.reading.fetch, false, search);
  }
  const rules = await run.robots.forUrl(url);
  if ('reason' in rules) {
    return without(
      'not_requested',
      say.notRequested(rules),
      null,
      false,
      searchVerdicts(null, path),
    );
  }
  // What robots.txt says to the search engines, from the same reading our requests obey, each group
  // matched once for both.
  const parsed = rules.reading.state === 'rules' ? rules.reading.rules : null;
  const match = parsed ? new PathMatch(parsed, path) : null;
  const search = searchVerdicts(rules.reading, path, match);
  if (!oursAllow(parsed, path, match)) {
    return without('robots_disallowed', say.ROBOTS_DISALLOWS_US, rules.reading.fetch, true, search);
  }

  const r = await politeFetch(run.ctx, url, CRAWL, {
    offSite: 'stop',
    gate: run.robots.gate(CRAWL),
    retryOn429: true,
  });
  if ('notRequested' in r) {
    run.findings.notRequested(r.notRequested);
    return without('not_requested', say.notRequested(r.notRequested), null, false, search);
  }
  if (r.cut) run.findings.notRequested(r.cut);
  const f = r.fetch;
  // A chain stopped at a redirect never requested its last Location, so it has not landed there.
  const landed = f.redirectStop === null && f.status !== null ? f.finalUrl : null;
  const reading = readResponse(f);
  run.ctx.sites.recordPage(run.ctx.sites.keyOf(r.answeredBy), reading.class === 'challenged');
  const limitations = [
    ...(f.error ? [say.requestFailed(f)] : []),
    ...(f.redirectStop ? [say.redirectStopped(f.redirectStop, r.cut ?? null)] : []),
  ];
  if (reading.class !== 'served' || !isHtml(f) || f.finalUrl === null) {
    // Complete when a response came back, whatever it was; a request that failed, or a redirect the
    // batch stopped before following, is not.
    const outcome = f.error ? 'failed' : 'fetched';
    return {
      page: pageRow(
        run,
        url,
        outcome,
        reading.class,
        f,
        limitations,
        'simulated',
        notRead(f, search),
      ),
      edges: [],
      complete: f.error === null && f.redirectStop !== 'batch_stopped',
      landed,
    };
  }

  // The stack is read on the batch's first URL only, from its HTML and its raw response headers: the
  // CMS signatures name headers (x-shopid, ...) the row's evidence headers do not keep.
  const pageRead = await readPage(
    run,
    f.body,
    f.bodyCut,
    f.finalUrl,
    first ? stackHeaders(f) : null,
  );
  if (typeof pageRead === 'string') limitations.push(say.NOT_READ[pageRead]);
  else if (pageRead.note) limitations.push(pageRead.note);
  if (typeof pageRead === 'string' || !pageRead.read) {
    // Fetched and not read, so not measured: the batch goes on, and nothing here is the site's doing.
    if (typeof pageRead !== 'string') run.findings.notRead('parse_depth_exceeded');
    return {
      page: pageRow(
        run,
        url,
        'fetched',
        reading.class,
        f,
        limitations,
        'simulated',
        notRead(f, search),
      ),
      edges: [],
      complete: false,
      landed,
    };
  }
  const { read } = pageRead;
  // As the engine's v2 crawl does: share-action and media links are not pages of the site.
  const extracted = read.links;
  const fromUrl = bounded(canonicalizeUrl(f.finalUrl), CAPS.url);
  const edges =
    fromUrl === null
      ? { kept: [], linked: new Map<string, string>(), distinct: 0, withheld: 0, tooLong: 0 }
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
  const rawText = read.rawText;
  if (read.featuresNote) limitations.push(read.featuresNote);
  // Cut to the URL cap on the reader: null there when it was over it.
  const canonical = extracted.canonicalUrl ?? null;
  if (extracted.canonicalUrl === null) {
    limitations.push(
      `The page's rel=canonical is over ${MAX_URL_LENGTH} characters, so it was not recorded.`,
    );
  }
  const declared = extracted.declaredCanonical;
  // One note for a canonical too long to keep: the adopted one's, when it is the same link.
  const adoptedTooLong = extracted.canonicalUrl === null;
  if (declared.note && !adoptedTooLong) limitations.push(declared.note);
  // Read in part (the reader's note): a canonical not found may be past where reading stopped, so
  // none found is not "declares none", and the hreflang alternates found are not all of them.
  const inPart = pageRead.note !== null;
  const canonicalDeclared = inPart && declared.canonical?.href === null ? null : declared.canonical;
  const hreflang: Hreflang = {
    links: extracted.hreflang.links,
    complete: extracted.hreflang.complete && !inPart && !headerDeclaresHreflang(f.headers.link),
  };
  // Every link on the page read: the whole response parsed (no note from the reader), and none left
  // unread for its length or past the read limit, and the page's own URL kept so they could be.
  const linksRead =
    !inPart &&
    fromUrl !== null &&
    extracted.notRead.tooLong + edges.tooLong + extracted.notRead.pastLimit === 0;
  const cost = pageCost(rawText, read.features, edges.kept, hreflang.links);
  const recorded = cost <= room.bytes;
  if (recorded) room.bytes -= cost;
  else {
    run.findings.resultSizeLimit(MAX_RESULT_TEXT_BYTES);
    limitations.push(
      `The text, links, content features and hreflang alternates of this page were not recorded: the batch had used its ${MAX_RESULT_TEXT_BYTES / (1024 * 1024)} MiB for them.`,
    );
  }
  const page = pageRow(run, url, 'fetched', reading.class, f, limitations, 'simulated', {
    raw_text: recorded ? rawText : null,
    word_count: read.words,
    canonical_url: canonical,
    links_out: edges.distinct,
    redirect: redirectChain(f),
    canonical_declared: canonicalDeclared,
    hreflang: recorded ? hreflang : null,
    content_simhash: read.simhash,
    is_html: true,
    // B's question 025: true only when the record holds every link read, so a reader can trust it.
    // Not when links past MAX_EDGES_PER_PAGE were withheld, or the batch's room left this page's out.
    links_read: linksRead && edges.withheld === 0 && recorded,
    robots_search: search,
    title: read.title,
    meta_description: read.description,
    content_features: recorded ? read.features : null,
    stack_signals: read.stack
      ? {
          cms: read.stack.cms,
          detected_from: STACK_SOURCE,
          frontend_markers: read.stack.frontendMarkers,
        }
      : null,
    main_text_chars: read.mainTextChars,
    noindex: headerNoindex(f) || read.metaNoindex,
  });
  return {
    page,
    edges: recorded ? edges.kept : [],
    linked: recorded ? edges.linked : undefined,
    complete: true,
    landed,
  };
}

/**
 * A fixed charge per edge for its other fields and its keys, below what they take in the JSON; the
 * gap is measured and pinned in page-cost.test.ts. Unchanged by CC-42B, so where an ordinary batch is
 * cut stays where it was.
 */
export const EDGE_OVERHEAD = 128;

/**
 * What a page's text, content features, edges and hreflang alternates take from the batch's room.
 * The page's strings are counted as the result's JSON holds them (json-bytes.ts), so a page of
 * quotes or backslashes is charged what it costs there, and content features as their JSON. What
 * is not counted exactly: each edge's other fields and keys (EDGE_OVERHEAD), each hreflang alternate's keys, and the page's row (its title, description, redirects
 * and limitations), which every page keeps whether or not its text is recorded. So a result can
 * pass the room by those. src/load.test.ts measures the largest result its own cases produce, not the
 * largest a batch can.
 */
export function pageCost(
  rawText: string,
  features: unknown,
  edges: readonly LinkEdge[],
  hreflang: Hreflang['links'],
): number {
  const featuresBytes = features ? Buffer.byteLength(JSON.stringify(features)) : 0;
  return (
    jsonBytes(rawText) +
    featuresBytes +
    edges.reduce(
      (n, e) =>
        n + jsonBytes(e.from_url) + jsonBytes(e.to_url) + jsonBytes(e.anchor_text) + EDGE_OVERHEAD,
      0,
    ) +
    hreflang.reduce((n, l) => n + jsonBytes(l.hreflang) + jsonBytes(l.href), 0)
  );
}

/**
 * One edge per distinct same-host target, in page order; only the first MAX_EDGES_PER_PAGE are built.
 * Both ends are canonical (the engine's canonicalizeUrl), the spelling the v1 graph keys pages on.
 */
function edgesFrom(
  checkId: string,
  fromUrl: string,
  links: PageLinks['links'],
): {
  kept: LinkEdge[];
  linked: Map<string, string>;
  distinct: number;
  withheld: number;
  tooLong: number;
} {
  const seen = new Set<string>();
  const kept: LinkEdge[] = [];
  const linked = new Map<string, string>();
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
    // The address to ask it at; its canonical spelling when the written one is past the URL cap.
    linked.set(toUrl, l.href.length <= MAX_URL_LENGTH ? l.href : toUrl);
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
  return { kept, linked, distinct: seen.size, withheld: seen.size - kept.length, tooLong };
}

/**
 * The page read on the reader, or why the reader gave nothing for it (recorded as a finding): only
 * this page fails, and the batch reads on.
 */
async function readPage(
  run: CrawlRun,
  body: string,
  bodyCut: boolean,
  finalUrl: string,
  stack: StackHeaders | null,
): Promise<PageRead | ReaderNotRead> {
  const r = await run.reader.page(body, bodyCut, finalUrl, stack).catch(() => null);
  if (r !== null && !isNotRead(r)) return r;
  const why = r?.failed ?? 'reader_error';
  run.findings.notRead(why);
  return why;
}

/** What reading the page gives a row, and the page facts. */
type ReadFields = Pick<
  CrawlPage,
  | 'raw_text'
  | 'word_count'
  | 'canonical_url'
  | 'links_out'
  | 'redirect'
  | 'canonical_declared'
  | 'hreflang'
  | 'content_simhash'
  | 'is_html'
  | 'links_read'
  | 'robots_search'
  | 'title'
  | 'meta_description'
  | 'content_features'
  | 'stack_signals'
  | 'main_text_chars'
  | 'noindex'
>;

/**
 * A row's read fields for a page that was not read: its redirects and whether it was HTML, from its
 * own response when one came back (`f`; null for a URL not requested, whose row may still show the
 * robots.txt response as evidence).
 */
function notRead(f: FetchOutcome | null, search: SearchRobots): ReadFields {
  return {
    raw_text: null,
    word_count: null,
    canonical_url: null,
    links_out: null,
    redirect: f ? redirectChain(f) : null,
    canonical_declared: null,
    hreflang: null,
    content_simhash: null,
    // An errored fetch carries no headers and no body, so it is not HTML.
    is_html: f !== null && isHtml(f),
    links_read: false,
    robots_search: search,
    title: null,
    meta_description: null,
    content_features: null,
    stack_signals: null,
    main_text_chars: null,
    // The header is read whenever a response came back; the meta tags only from a page read whole.
    noindex: f !== null && headerNoindex(f) ? true : null,
  };
}

/** What a row's stack signals were read from. */
const STACK_SOURCE = 'HTML and response headers';

/** The response headers as v1's detectCms reads them: lower-cased names, repeated values joined. */
function stackHeaders(f: FetchOutcome): StackHeaders {
  const out: StackHeaders = {};
  for (const [name, v] of Object.entries(f.headers)) {
    if (v !== undefined) out[name.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/**
 * v1's readHeaderNoindex (packages/engine/src/crawler.ts, private to the crawler, which loads crawlee):
 * an X-Robots-Tag value, each comma-separated token with any `agent:` prefix removed, that is
 * `noindex` or `none`.
 */
export function headerNoindex(f: Pick<FetchOutcome, 'headers'>): boolean {
  const raw = f.headers['x-robots-tag'];
  if (!raw) return false;
  for (const v of Array.isArray(raw) ? raw : [raw]) {
    for (const part of String(v).toLowerCase().split(',')) {
      const token = part.includes(':') ? part.slice(part.indexOf(':') + 1) : part;
      if (token.trim() === 'noindex' || token.trim() === 'none') return true;
    }
  }
  return false;
}

function pageRow(
  run: CrawlRun,
  url: string,
  outcome: CrawlPage['outcome'],
  response: ResponseClass | null,
  f: FetchOutcome | null,
  limitations: string[],
  evidence: 'declared' | 'simulated',
  read: ReadFields,
): CrawlPage {
  const v = run.vantage ?? LOCAL_VANTAGE;
  return CrawlPageSchema.parse({
    check_id: run.checkId,
    // Keyed on the canonical spelling (F-252): the crawl may ask `/about/` where pages are compared
    // as `/about`. The request schema holds the URL within this cap, and the planner plans only URLs
    // whose canonical spelling is within it too.
    url: bounded(canonicalizeUrl(url), CAPS.url),
    outcome,
    response,
    evidence_class: evidence,
    identity_sent: userAgentOf(f, CRAWL),
    source_ip_class: v.sourceIpClass,
    limitations: storedLimitations([...limitations, ...requestLimitations(f)]),
    fetched_at: new Date(f?.startedAt ?? run.clock.now()).toISOString(),
    request_headers: f ? requestHeaders(f) : [],
    status_code: standardStatus(f?.status ?? null),
    final_url: f ? storedUrl(f.finalUrl) : null,
    headers: f ? evidenceHeaders(f) : [],
    byte_count: f && f.status !== null ? f.bytes : null,
    ...read,
    fly_region: v.flyRegion,
    request_signing: 'unsigned',
    signature_verified: 'not_observable',
    worker_release: v.release,
    timing: f ? f.timing : null,
  });
}
