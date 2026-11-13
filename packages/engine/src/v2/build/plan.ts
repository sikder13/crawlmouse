/**
 * What CC-20b fetches next, as pure functions of what the check holds so far. None of them fetches.
 *
 * - nextCrawlBatch: the next crawl batch's URLs, or null when the crawl is done.
 * - sample: the staged access sample (ARCH-2 §4.2 n+2/n+3, ENGINE-GAP §8.4): stage 1 always, and
 *   stage 2 when the stage-1 rows show a difference.
 * - renderCandidates: what CC-14's renderCheck needs besides its client, caps and budget.
 *
 * `buildCheck` recomputes the sample and the empty-root pages from the same rows and refuses an access
 * test or a render the planners would not have asked for.
 */
import type { AccessTest, CrawlBatchResult, Fix, PageResult } from '@crawlmouse/types/v2';
import { inSiteScope } from '../../extract.js';
import { MAX_TEMPLATE_KEY_LENGTH, MAX_URL_LENGTH } from '../batch-bounds.js';
import { canonicalizeUrl } from '../../url-canonical.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import {
  EMPTY_ROOT_MAX_RENDERS,
  emptyRoot,
  type EmptyRootCandidate,
} from '../render/empty-root.js';
import { FREE_MAX_RENDERS, type RenderCandidate } from '../render/sample.js';
import type { RenderCheckInput } from '../render/run.js';
import type { JsTextState } from '../render/state.js';
import type { Assembled } from './assemble.js';
import type { Seed } from './types.js';

/** URLs per crawl batch: the worker's MAX_URLS_PER_BATCH. */
export const CRAWL_BATCH_URLS = 50;
/**
 * Stage 1's bounds (ENGINE-GAP §8.4): at most STAGE1_TEMPLATES templates covered, counting the
 * homepage's and the challenged pages' own; at most STAGE1_CHALLENGED challenged pages; and at most
 * STAGE1_MAX_PAGES pages, which `sample` checks before each template page. The page bound is not
 * implied by the other two: challenged pages can share the homepage's template (a template key leaves
 * the query out). plan.test.ts builds that case.
 */
export const STAGE1_TEMPLATES = 24;
export const STAGE1_CHALLENGED = 2;
export const STAGE1_MAX_PAGES = 25;
/** Stage 2: the sample grows to this many pages in all, starting with these picks. */
export const STAGE2_MAX_PAGES = 50;
export const STAGE2_PICKS = { hubs: 5, deepest: 4, newest: 4 } as const;
/** Fix states in which a client-rendered fix still waits on its rendering (CC-14's open fixes). */
export const AWAITING_FIX_STATUSES: readonly Fix['status'][] = ['open', 'reopened', 'marked_done'];

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The next crawl batch: up to CRAWL_BATCH_URLS URLs nobody has asked for yet, or null when there are
 * none or the crawl has asked for `pageCap` URLs. The homepage seed comes first, then the sitemap
 * seeds as given, then the URLs the batches discovered, batch by batch in the order each found them.
 * Every URL is compared in canonical spelling; a URL a request landed on counts as asked for, and one a
 * stopped redirect only names (its row still answers 3xx) does not. Seeds on another host than the
 * homepage's are not crawled (`crawlableSeeds`).
 */
export function nextCrawlBatch(
  seeds: readonly Seed[],
  crawl: readonly Pick<CrawlBatchResult, 'pages' | 'discovered_urls'>[],
  pageCap: number,
): string[] | null {
  const asked = new Set<string>();
  for (const b of crawl) {
    for (const p of b.pages) {
      asked.add(canonicalizeUrl(p.url));
      const read = landedOn(p);
      if (read !== null) asked.add(read);
    }
  }
  const requested = crawl.reduce((n, b) => n + b.pages.length, 0);
  const room = Math.min(CRAWL_BATCH_URLS, pageCap - requested);
  if (room <= 0) return null;
  const crawlable = crawlableSeeds(seeds);
  const queue = [
    ...crawlable.filter((s) => s.source === 'homepage').map((s) => s.url),
    ...crawlable.filter((s) => s.source === 'sitemap').map((s) => s.url),
    ...crawlableDiscovered(seeds, crawl),
  ];
  const next: string[] = [];
  for (const raw of queue) {
    const url = canonicalizeUrl(raw);
    if (asked.has(url)) continue;
    asked.add(url);
    next.push(url);
    if (next.length === room) break;
  }
  return next.length > 0 ? next : null;
}

/**
 * The seeds the crawl requests: the homepage's, and the sitemap's on the homepage's host and the
 * default port, within the worker's URL limit. A sitemap can list another host (www against the
 * apex), port, or a URL past that limit; those are neither crawled nor counted as discovered.
 */
export function crawlableSeeds(seeds: readonly Seed[]): Seed[] {
  const home = seeds.find((s) => s.source === 'homepage');
  const host = home ? new URL(home.url).hostname : null;
  return seeds.filter((s) => {
    if (s.source === 'homepage' || host === null) return true;
    const url = new URL(s.url);
    return (
      url.hostname === host && url.port === '' && canonicalizeUrl(s.url).length <= MAX_URL_LENGTH
    );
  });
}

/**
 * The URLs the batches discovered that the worker would fetch for the site (`inSiteScope`: its host or
 * the www twin, on the default port; within MAX_URL_LENGTH), batch by batch in the order each found
 * them. Any other link is neither crawled nor counted as discovered: a batch holding it would be
 * refused whole.
 */
export function crawlableDiscovered(
  seeds: readonly Seed[],
  crawl: readonly Pick<CrawlBatchResult, 'discovered_urls'>[],
): string[] {
  const home = seeds.find((s) => s.source === 'homepage');
  const site = home ? new URL(home.url) : null;
  return crawl
    .flatMap((b) => b.discovered_urls)
    .filter(
      (u) =>
        canonicalizeUrl(u).length <= MAX_URL_LENGTH &&
        (site === null || inSiteScope(new URL(u), site)),
    );
}

/**
 * Where a crawl row's request landed, in canonical spelling: its final URL when the row's own status is
 * not a redirect, so the URL was requested and answered. A stopped chain's row keeps the redirect's
 * status and names a Location nobody requested (worker crawl.ts `landed`).
 */
export function landedOn(
  p: Pick<CrawlBatchResult['pages'][number], 'final_url' | 'status_code'>,
): string | null {
  if (p.final_url === null || p.status_code === null) return null;
  if (p.status_code >= 300 && p.status_code < 400) return null;
  return canonicalizeUrl(p.final_url);
}

export type SampleReason =
  | 'homepage'
  | 'challenged'
  | 'template'
  | 'hub'
  | 'deepest'
  | 'newest'
  | 'template_fill';

export interface SampledPage {
  url: string;
  template_key: string;
  stage: 1 | 2;
  picked_for: SampleReason;
}

export interface Sample {
  stage1: SampledPage[];
  /** Null until stage 1's access rows are in; then whether they call for stage 2. */
  stage2_needed: boolean | null;
  /** The stage-2 pages, when stage 2 is needed; otherwise none. */
  stage2: SampledPage[];
}

const SERVED: ReadonlySet<string> = new Set(['allowed', 'allowed_thin']);
const SCORED = CRAWLER_REGISTRY_V2.filter((e) => e.scored).map((e) => e.token);

const byRank = (a: PageResult, b: PageResult) =>
  (b.pagerank_share ?? -1) - (a.pagerank_share ?? -1) || byText(a.url, b.url);

/**
 * The staged sample from the crawl. Only pages answering 200 with HTML are tested as crawlers, except
 * the challenged ones, which are the point. Stage 1: the homepage; up to STAGE1_CHALLENGED pages our
 * crawler was challenged on, by URL; then one page of each template, largest template first, its
 * highest-PageRank page, until STAGE1_TEMPLATES templates are covered (STAGE1_MAX_PAGES says why
 * that holds the stage to 25 pages).
 *
 * Stage 2 is needed when, on the stage-1 pages, a scored crawler's verdict on some page differs from
 * its verdict on the homepage (on the first stage-1 page when the homepage is not in the sample), or
 * a browser control was not served. It adds the top hubs by PageRank, the deepest pages, the newest by
 * sitemap lastmod, then one page per template round-robin, largest template first, to STAGE2_MAX_PAGES.
 */
export function sample(
  assembled: Pick<Assembled, 'pages' | 'rows' | 'homepage_url' | 'access_tests'>,
): Sample {
  const { pages, rows, homepage_url } = assembled;
  // A page whose template key the worker would refuse in an access batch is not tested, whichever
  // way it would be picked.
  const testable = (p: PageResult) => p.template_key.length <= MAX_TEMPLATE_KEY_LENGTH;
  const eligible = pages.filter((p) => p.status_code === 200 && p.is_html && testable(p));
  const picked: SampledPage[] = [];
  const taken = new Set<string>();
  const covered = new Set<string>();
  const take = (p: PageResult, stage: 1 | 2, picked_for: SampleReason) => {
    if (taken.has(p.url)) return;
    taken.add(p.url);
    covered.add(p.template_key);
    picked.push({ url: p.url, template_key: p.template_key, stage, picked_for });
  };
  const home = eligible.find((p) => p.url === homepage_url);
  if (home) take(home, 1, 'homepage');
  pages
    .filter((p) => rows.get(p.url)?.response === 'challenged' && testable(p))
    .slice(0, STAGE1_CHALLENGED)
    .forEach((p) => take(p, 1, 'challenged'));
  const templates = templatesBySize(eligible);
  for (const [key, members] of templates) {
    if (picked.length >= STAGE1_MAX_PAGES || covered.size >= STAGE1_TEMPLATES) break;
    if (!covered.has(key)) take(members[0]!, 1, 'template');
  }
  const stage1 = [...picked];

  const stage2_needed = stage2Needed(stage1, assembled.access_tests, homepage_url);
  if (!stage2_needed) return { stage1, stage2_needed, stage2: [] };

  const room = () => picked.length < STAGE2_MAX_PAGES;
  const rest = () => eligible.filter((p) => !taken.has(p.url));
  const pick = (list: PageResult[], n: number, why: SampleReason) =>
    list.slice(0, n).forEach((p) => room() && take(p, 2, why));
  pick([...rest()].sort(byRank), STAGE2_PICKS.hubs, 'hub');
  pick(
    rest()
      .filter((p) => p.depth !== null)
      .sort((a, b) => b.depth! - a.depth! || byText(a.url, b.url)),
    STAGE2_PICKS.deepest,
    'deepest',
  );
  pick(
    rest()
      .filter((p) => p.sitemap_lastmod !== null)
      .sort((a, b) => byText(b.sitemap_lastmod!, a.sitemap_lastmod!) || byText(a.url, b.url)),
    STAGE2_PICKS.newest,
    'newest',
  );
  const queues = templatesBySize(rest()).map(([, members]) => [...members]);
  while (room() && queues.some((q) => q.length > 0)) {
    for (const q of queues) if (room() && q.length > 0) take(q.shift()!, 2, 'template_fill');
  }
  return { stage1, stage2_needed, stage2: picked.slice(stage1.length) };
}

/** Templates largest first (ties by key), each with its pages by PageRank. */
function templatesBySize(pages: readonly PageResult[]): [string, PageResult[]][] {
  const groups = new Map<string, PageResult[]>();
  for (const p of pages) groups.set(p.template_key, [...(groups.get(p.template_key) ?? []), p]);
  return [...groups.entries()]
    .map(([k, ms]) => [k, ms.sort(byRank)] as [string, PageResult[]])
    .sort((a, b) => b[1].length - a[1].length || byText(a[0], b[0]));
}

function stage2Needed(
  stage1: readonly SampledPage[],
  tests: readonly AccessTest[],
  homepage: string,
): boolean | null {
  const on = new Set(stage1.map((p) => p.url));
  const rows = tests.filter((t) => on.has(t.page_url));
  if (rows.length === 0) return null;
  if (rows.some((t) => t.identity_role === 'control' && !SERVED.has(t.verdict))) return true;
  const reference = on.has(homepage) ? homepage : stage1[0]!.url;
  return SCORED.some((ua) => {
    const verdicts = rows.filter((t) => t.identity_role === 'crawler' && t.ua === ua);
    const at = verdicts.find((t) => t.page_url === reference)?.verdict;
    return at !== undefined && verdicts.some((t) => t.verdict !== at);
  });
}

/** CC-14's RenderCheckInput, less what only the network step holds: client, caps, budget, pacing. */
export type RenderPlan = Pick<
  RenderCheckInput,
  'candidates' | 'openFixTemplates' | 'maxRenders' | 'previousStates'
> &
  Required<Pick<RenderCheckInput, 'emptyRootCandidates' | 'maxEmptyRootRenders'>>;

/**
 * Every crawled page as a candidate for the empty-root phase (render/empty-root.ts), with its crawl
 * row's `content_features.client_rendered` (false when the row has none). A page is a PageResult only
 * when our crawler fetched it under our robots.txt group.
 */
export function emptyRootPool(
  assembled: Pick<Assembled, 'pages' | 'content'>,
): EmptyRootCandidate[] {
  return assembled.pages.map((p) => ({
    url: p.url,
    template_key: p.template_key,
    kind: p.kind,
    status_code: p.status_code,
    is_html: p.is_html,
    pagerank_share: p.pagerank_share,
    fetched_under_our_robots: true,
    client_rendered: assembled.content.get(p.url)?.client_rendered === true,
  }));
}

/** The URLs of the crawled pages `emptyRoot` holds for, the one rule the render, guard and detector read. */
export const emptyRootUrls = (assembled: Pick<Assembled, 'pages' | 'content'>): Set<string> =>
  new Set(
    emptyRootPool(assembled)
      .filter(emptyRoot)
      .map((p) => p.url),
  );

/**
 * The render step's input: the sampled pages (so every graded-phase candidate is a sampled page), the
 * templates of the site's client-rendered fixes still waiting on rendering, FREE_MAX_RENDERS, the
 * pages' states in the previous check, which CC-20b reads from that check's PageResults, and, for the
 * empty-root phase, every crawled page with EMPTY_ROOT_MAX_RENDERS.
 */
export function renderCandidates(
  assembled: Pick<Assembled, 'pages' | 'content'>,
  sampled: readonly SampledPage[],
  fixes: readonly Pick<Fix, 'type' | 'status' | 'template_key'>[],
  previousStates: ReadonlyMap<string, JsTextState>,
): RenderPlan {
  const inSample = new Set(sampled.map((s) => s.url));
  const candidates: RenderCandidate[] = assembled.pages
    .filter((p) => inSample.has(p.url))
    .map((p) => ({
      url: p.url,
      template_key: p.template_key,
      kind: p.kind,
      status_code: p.status_code,
      is_html: p.is_html,
      pagerank_share: p.pagerank_share,
      // A page is a PageResult only when our crawler fetched it under our robots.txt group.
      fetched_under_our_robots: true,
    }));
  const openFixTemplates = [
    ...new Set(
      fixes
        .filter(
          (f) => f.type === 'client_rendered_template' && AWAITING_FIX_STATUSES.includes(f.status),
        )
        .flatMap((f) => (f.template_key === null ? [] : [f.template_key])),
    ),
  ].sort();
  return {
    candidates,
    openFixTemplates,
    maxRenders: FREE_MAX_RENDERS,
    previousStates,
    emptyRootCandidates: emptyRootPool(assembled),
    maxEmptyRootRenders: EMPTY_ROOT_MAX_RENDERS,
  };
}
