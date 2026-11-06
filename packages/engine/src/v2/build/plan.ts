/**
 * What CC-20b fetches next, as pure functions of what the check holds so far. None of them fetches.
 *
 * - nextCrawlBatch: the next crawl batch's URLs, or null when the crawl is done.
 * - sample: the staged access sample (ARCH-2 §4.2 n+2/n+3, ENGINE-GAP §8.4): stage 1 always, and
 *   stage 2 when the stage-1 rows show a difference.
 * - renderCandidates: what CC-14's renderCheck needs besides its client, caps and budget.
 *
 * `buildCheck` recomputes the sample and the render candidates from the same rows and refuses an access
 * test or a render the planners would not have asked for.
 */
import type { AccessTest, CrawlBatchResult, Fix, PageResult } from '@crawlmouse/types/v2';
import { canonicalizeUrl } from '../../url-canonical.js';
import { CRAWLER_REGISTRY_V2 } from '../crawler-registry.js';
import { FREE_MAX_RENDERS, type RenderCandidate } from '../render/sample.js';
import type { RenderCheckInput } from '../render/run.js';
import type { JsTextState } from '../render/state.js';
import type { Assembled } from './assemble.js';
import type { Seed } from './types.js';

/** URLs per crawl batch: the worker's MAX_URLS_PER_BATCH. */
export const CRAWL_BATCH_URLS = 50;
/** Stage 1: at most this many pages, of which at most STAGE1_TEMPLATES templates and STAGE1_CHALLENGED challenged pages. */
export const STAGE1_MAX_PAGES = 25;
export const STAGE1_TEMPLATES = 24;
export const STAGE1_CHALLENGED = 2;
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
 * Every URL is compared in canonical spelling; a URL a page landed on counts as asked for. Seeds on
 * another host than the homepage's are not crawled.
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
      if (p.final_url) asked.add(canonicalizeUrl(p.final_url));
    }
  }
  const requested = crawl.reduce((n, b) => n + b.pages.length, 0);
  const room = Math.min(CRAWL_BATCH_URLS, pageCap - requested);
  if (room <= 0) return null;
  const home = seeds.find((s) => s.source === 'homepage');
  const host = home ? new URL(home.url).hostname : null;
  const queue = [
    ...seeds.filter((s) => s.source === 'homepage').map((s) => s.url),
    ...seeds
      .filter((s) => s.source === 'sitemap' && (host === null || new URL(s.url).hostname === host))
      .map((s) => s.url),
    ...crawl.flatMap((b) => b.discovered_urls),
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
 * highest-PageRank page, until STAGE1_TEMPLATES templates are covered or the stage holds
 * STAGE1_MAX_PAGES. ENGINE-GAP §8.4's 1 + 24 + 2 can reach 27; the 25-page bound it also states wins.
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
  const eligible = pages.filter((p) => p.status_code === 200 && p.is_html);
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
    .filter((p) => rows.get(p.url)?.response === 'challenged')
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
>;

/**
 * The render step's input: the sampled pages (so every render candidate is a sampled page), the
 * templates of the site's client-rendered fixes still waiting on rendering, FREE_MAX_RENDERS, and the
 * pages' states in the previous check, which CC-20b reads from that check's PageResults.
 */
export function renderCandidates(
  assembled: Pick<Assembled, 'pages'>,
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
  return { candidates, openFixTemplates, maxRenders: FREE_MAX_RENDERS, previousStates };
}
