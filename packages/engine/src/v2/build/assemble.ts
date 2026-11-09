/**
 * From the worker's rows to the check's pages and links: PageResult and LinkEdge, coverage, and the
 * refusal evidence, with v1's graph, classifier and coverage functions (SPEC 5.1a) doing what they
 * already do for v1.
 *
 * Which crawl rows become pages. A row's `outcome` decides it, not its status: a URL robots.txt kept us
 * from carries the robots.txt response as its evidence, status included (worker batch/crawl.ts).
 *   - `fetched`: a PageResult, with the response of its own request.
 *   - `robots_disallowed`: the detectors' `disallowed` list, never a page.
 *   - `not_requested`, `failed`: discovered and not crawled.
 *
 * Links are the worker's, as it recorded them: a redirected page's links are recorded from where it
 * landed (`from_url` is that URL), and the structure detectors file them back under the requested URL
 * themselves (detectors/scope.ts). Only an exact repeat of a (from_url, to_url) pair, the contract's
 * key, is merged, keeping the first in sorted order. A link to a URL the crawl did not fetch is kept:
 * it is how the detectors know the crawl did not see every page it found.
 */
import type { AccessTest, Coverage, CrawlPage, LinkEdge, PageResult } from '@crawlmouse/types/v2';
import type { CmsName } from '@crawlmouse/types';
import { classifyPages } from '../../analysis/classify-pages.js';
import { computeDepth } from '../../analysis/depth.js';
import { templateKeyFor } from '../../analysis/template-key.js';
import { getAdjustments } from '../../cms-adjustments/index.js';
import { estimateSiteTotal } from '../../confidence-band.js';
import { computeCoverageAccounting } from '../../coverage.js';
import { computeCrawlHealth } from '../../crawl-health.js';
import { deriveGradeInputs, type GraphAnalysis } from '../../grade-inputs.js';
import { buildGraph, type SiteGraph } from '../../graph.js';
import { canonicalizeUrl, hashUrl } from '../../url-canonical.js';
import type { ContentFeatures } from '../content/read.js';
import { excludedByRobots } from '../detectors/scope.js';
import type { DetectorInput } from '../detectors/types.js';
import { isGraded, type TechnicalSeoInput } from '../grade/technical-seo.js';
import type { RenderOutcome } from '../render/run.js';
import type { Batches } from './batches.js';
import { fileEdges, landingsOf } from './filing.js';
import { crawlableDiscovered, crawlableSeeds, landedOn, nextCrawlBatch } from './plan.js';
import { decideStatus, type StatusDecision } from './status.js';
import type { BuildInput, Seed } from './types.js';

/** The most pages the staged sample holds (ENGINE-GAP §8.4): Coverage's `sample_strategy.max_pages`. */
export const SAMPLE_MAX_PAGES = 50;

export interface Assembled {
  homepage_url: string;
  /** Sorted by URL. `is_orphan`, `suggested_parent_url` and `content_failures` are set after grading. */
  pages: PageResult[];
  /** The links as the worker recorded them: LinkEdge rows, and what the structure detectors read. */
  edges: LinkEdge[];
  /** The same links filed under the page they were found on (filing.ts): what the grade reads. */
  filed_edges: LinkEdge[];
  disallowed: DetectorInput['disallowed'];
  access_tests: AccessTest[];
  /** The crawl row behind each page, by URL. */
  rows: ReadonlyMap<string, CrawlPage>;
  /** What readPage read of each page read whole, by URL (the worker's `content_features`). */
  content: ReadonlyMap<string, ContentFeatures>;
  /** The homepage row's CMS; null when the homepage was not read as HTML. */
  cms: CmsName | null;
  /** v1's JS detector read the homepage as an app shell: what v1's grade suppresses orphans on. */
  homepage_client_rendered: boolean;
  /** What the structure detectors hold back on as served for JavaScript to fill in (`clientRenderedOf`). */
  client_rendered: DetectorInput['client_rendered'];
  coverage: Coverage;
  refusal: TechnicalSeoInput['refusal'];
  status: StatusDecision;
  /** v1's analysis of the graph of pages answering 200, as technical-seo.ts structureOf builds it. */
  graph: SiteGraph;
  analysis: GraphAnalysis;
  /** Discovered URLs the crawl has not read, in canonical spelling, sorted. */
  unread: string[];
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One edge per (from_url, to_url), the first of each in sorted order. */
export function distinctEdges(edges: readonly LinkEdge[]): LinkEdge[] {
  const sorted = [...edges].sort(
    (a, b) =>
      byText(a.from_url, b.from_url) ||
      byText(a.to_url, b.to_url) ||
      byText(a.anchor_text, b.anchor_text) ||
      Number(a.is_generic_anchor) - Number(b.is_generic_anchor) ||
      Number(a.js_only) - Number(b.js_only),
  );
  const seen = new Set<string>();
  return sorted.filter((e) => {
    const key = `${e.from_url}\u0000${e.to_url}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

const SERVED = new Set(['allowed', 'allowed_thin']);

export function assemble(
  input: Pick<BuildInput, 'check' | 'homepage_url' | 'seeds' | 'render'>,
  batches: Batches,
): Assembled {
  const homepage = input.homepage_url;
  if (homepage !== canonicalizeUrl(homepage)) {
    throw new Error(`buildCheck: the homepage ${homepage} is not in canonical spelling`);
  }
  const allRows = batches.crawl.flatMap((b) => b.pages);
  const pageRows = allRows
    .filter((r) => r.outcome === 'fetched')
    .sort((a, b) => byText(a.url, b.url));
  for (const r of pageRows) {
    if (r.status_code === null) throw new Error(`buildCheck: ${r.url} was fetched with no status`);
  }
  const rows = new Map(pageRows.map((r) => [r.url, r]));
  const disallowed = allRows
    .filter((r) => r.outcome === 'robots_disallowed')
    .map((r) => ({ url: r.url, robots_search: r.robots_search }))
    .sort((a, b) => byText(a.url, b.url));
  const edges = distinctEdges(batches.crawl.flatMap((b) => b.link_edges));
  // The graph, depth, inbound counts and grade read the links filed under the page they were found on.
  const filed = fileEdges(
    edges,
    landingsOf(
      pageRows.map((r) => ({ url: r.url, final_url: r.final_url, status_code: r.status_code! })),
    ),
  );
  // By id, so the order the rows arrive in does not reach the output.
  const access_tests = batches.access
    .flatMap((b) => b.access_tests)
    .sort((a, b) => byText(a.id, b.id));
  for (const t of access_tests) {
    if (!rows.has(t.page_url)) {
      throw new Error(`buildCheck: an access test of ${t.page_url}, which the crawl did not fetch`);
    }
    if (t.template_key !== templateKeyFor(t.page_url)) {
      throw new Error(
        `buildCheck: access test ${t.id} names template ${t.template_key} for ${t.page_url}`,
      );
    }
  }

  const home = rows.get(homepage);
  const cms = home?.stack_signals?.cms ?? null;
  const content = new Map<string, ContentFeatures>();
  for (const r of pageRows) if (r.content_features) content.set(r.url, r.content_features);
  const homepage_client_rendered = content.get(homepage)?.client_rendered ?? false;

  // SPEC 5.1a §5: every page is classified; the homepage is always content.
  const adjust = getAdjustments(cms ?? 'custom');
  const classes = classifyPages(
    pageRows.map((r) => ({
      url: r.url,
      urlHash: hashUrl(r.url),
      mainTextChars: r.main_text_chars ?? undefined,
      simhash: r.content_simhash,
      noindex: r.noindex === true,
    })),
    { homepageUrl: homepage, isCmsExcluded: (u) => adjust.excludeFromOrphans(u) },
  );
  const kindOf = (url: string) => classes.get(url)!.kind;

  // v1's graph of the pages answering 200 (technical-seo.ts structureOf), titled for v1's relevance.
  const ok = pageRows.filter((r) => r.status_code === 200);
  const graded = new Set(
    ok
      .filter((r) => isGraded({ kind: kindOf(r.url), status_code: 200, is_html: r.is_html }))
      .map((r) => r.url),
  );
  const toLinks = (es: readonly LinkEdge[]) =>
    es.map((e) => ({
      fromUrl: e.from_url,
      toUrl: e.to_url,
      anchorText: e.anchor_text,
      isGenericAnchor: e.is_generic_anchor,
    }));
  const graph = buildGraph(
    ok.map((r) => ({
      url: r.url,
      urlHash: r.url,
      statusCode: 200,
      title: r.title?.text ?? undefined,
    })),
    toLinks(filed),
  );
  const analysis = deriveGradeInputs(graph, {
    homepageUrl: homepage,
    isGradeable: (u) => graded.has(u),
    jsRendered: homepage_client_rendered,
  });
  const rankTotal = [...analysis.ranks.values()].reduce((n, v) => n + v, 0);

  // Depth over every page: a link path through a 404 is still a path. Without the homepage among the
  // pages there is no root, so no page has a depth (v1's fallback roots would give orphans depth 0).
  const linkGraph = buildGraph(
    pageRows.map((r) => ({ url: r.url, urlHash: r.url, statusCode: r.status_code! })),
    toLinks(filed),
  );
  const depths = linkGraph.hasNode(homepage)
    ? computeDepth(linkGraph, homepage)
    : new Map<string, number>();

  const inbound = new Map<string, Set<string>>();
  for (const e of filed)
    (inbound.get(e.to_url) ?? inbound.set(e.to_url, new Set()).get(e.to_url)!).add(e.from_url);

  const crawlerRows = new Map<string, AccessTest[]>();
  for (const t of access_tests) {
    if (t.identity_role !== 'crawler') continue;
    (crawlerRows.get(t.page_url) ?? crawlerRows.set(t.page_url, []).get(t.page_url)!).push(t);
  }
  const rendered = renderedPages(input.render, rows);
  const client_rendered = clientRenderedOf(homepage, content, rendered);
  const seeds = seedMap(input.seeds);

  const pages: PageResult[] = pageRows.map((r) => {
    const tests = crawlerRows.get(r.url) ?? null;
    const known = measured(tests);
    const rank = analysis.ranks.get(r.url);
    return {
      check_id: input.check.id,
      url: r.url,
      template_key: templateKeyFor(r.url),
      kind: kindOf(r.url),
      status_code: r.status_code!,
      depth: depths.get(r.url) ?? null,
      links_in: inbound.get(r.url)?.size ?? 0,
      links_out: r.links_out ?? 0,
      pagerank_share: rank === undefined || rankTotal <= 0 ? null : rank / rankTotal,
      is_orphan: false,
      js_only: false,
      found_via: seeds.get(r.url)?.source === 'sitemap' ? 'sitemap' : 'link',
      sitemap_lastmod: seeds.get(r.url)?.lastmod ?? null,
      suggested_parent_url: null,
      sampled: tests !== null,
      without_js: rendered.get(r.url) ?? null,
      // Unknown, not zero, when a crawler test on the page measured nothing (a stopped access batch).
      crawlers_reached: known && distinctUas(known.filter((t) => SERVED.has(t.verdict))),
      crawlers_reading_text: known && distinctUas(known.filter((t) => t.verdict === 'allowed')),
      content_failures: null,
      final_url: r.final_url,
      redirect: r.redirect,
      canonical_declared: r.canonical_declared,
      hreflang: r.hreflang,
      content_simhash: r.content_simhash,
      is_html: r.is_html,
      links_read: r.links_read,
      robots_search: r.robots_search,
      title: r.title,
      meta_description: r.meta_description,
    };
  });

  // Coverage. A URL a row landed on was read, under the row's URL, so it is not left unread.
  const landed = new Set(allRows.flatMap((r) => landedOn(r) ?? []));
  const rowUrls = new Set(allRows.map((r) => r.url));
  const crawlable = crawlableSeeds(input.seeds);
  const found = [
    ...crawlableDiscovered(input.seeds, batches.crawl),
    ...crawlable.map((s) => canonicalizeUrl(s.url)),
  ];
  const unread = [...new Set(found)].filter((u) => !rowUrls.has(u) && !landed.has(u)).sort();
  const pages_discovered = rowUrls.size + unread.length;
  // A crawl the planner would go on with was not run to its end (CC-20b stopped it, or lost a batch).
  const crawlOpen = nextCrawlBatch(input.seeds, batches.crawl, input.check.page_cap) !== null;
  const status = decideStatus(batches, crawlOpen ? ['crawl'] : []);
  const sitemap = crawlable
    .filter((s) => s.source === 'sitemap')
    .map((s) => canonicalizeUrl(s.url));
  // v1's crawl health: a failed request was attempted (status 0, blocked), and a URL robots.txt keeps
  // from every search engine as well as from us is outside the crawlable site (scope.ts).
  const robotsExcluded = excludedByRobots(disallowed).size;
  const health = computeCrawlHealth(
    [
      ...pages.map((p) => ({ statusCode: p.status_code })),
      ...allRows.filter((r) => r.outcome === 'failed').map(() => ({ statusCode: 0 })),
    ],
    pages_discovered - robotsExcluded,
  );
  const estimate = estimateSiteTotal(health, sitemap.length > 0 ? sitemap.length : null);
  // The exclusion tally is over the pages answering 200, as v1's (refusal.ts: gradeable + excluded is
  // the same-host 200 population). A 404 at /tag/x is not an excluded archive page.
  const accounting = computeCoverageAccounting({
    fetchedCount: pages.length,
    gradeableCount: analysis.gradeableCount,
    classifications: ok.map((r) => classes.get(r.url)!),
    sitemapDeclaredUrls: sitemap.length > 0 ? sitemap : null,
    robotsExcludedSitemapUrls: disallowed.map((d) => d.url),
    estimate,
  });
  const sampled = pages.filter((p) => p.sampled);
  const sampleable = pages.filter((p) => p.status_code === 200 && p.is_html);
  const coverage: Coverage = {
    pages_discovered,
    pages_crawled: pages.length,
    pages_sampled: sampled.length,
    templates: templatesOf(pages),
    sample_strategy: {
      method:
        sampleable.length > 0 && sampleable.every((p) => p.sampled)
          ? 'census'
          : 'stratified_by_template',
      max_pages: SAMPLE_MAX_PAGES,
    },
    gradeable: accounting.gradeable,
    excluded: accounting.excluded,
    excluded_by_robots: robotsExcluded,
  };
  return {
    homepage_url: homepage,
    pages,
    edges,
    filed_edges: filed,
    disallowed,
    access_tests,
    rows,
    content,
    cms,
    homepage_client_rendered,
    client_rendered,
    coverage,
    refusal: {
      excludedPageCount: accounting.excluded.reduce((n, e) => n + e.count, 0),
      estimateSource: estimate.method,
      crawlTruncated: health.partial || status.crawl_partial,
    },
    status,
    graph,
    analysis,
    unread,
  };
}

const distinctUas = (tests: readonly AccessTest[]): number => new Set(tests.map((t) => t.ua)).size;

/** The page's crawler tests, when every one of them measured something; else null. */
const measured = (tests: readonly AccessTest[] | null): readonly AccessTest[] | null =>
  tests !== null && tests.every((t) => t.verdict !== 'not_measured') ? tests : null;

function seedMap(seeds: readonly Seed[]): Map<string, Seed> {
  const out = new Map<string, Seed>();
  // A URL listed as the homepage and in the sitemap was found in the sitemap: sitemap seeds go last,
  // so they are the ones kept. Within a source, URL then lastmod order makes the one kept a function
  // of the seeds, not of their order.
  const order = (a: Seed, b: Seed) =>
    byText(a.source, b.source) || byText(a.url, b.url) || byText(a.lastmod ?? '', b.lastmod ?? '');
  for (const s of [...seeds].sort(order)) {
    out.set(canonicalizeUrl(s.url), s);
  }
  return out;
}

function templatesOf(pages: readonly PageResult[]): Coverage['templates'] {
  const count = new Map<string, number>();
  for (const p of pages) count.set(p.template_key, (count.get(p.template_key) ?? 0) + 1);
  return (
    [...count.entries()]
      .sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
      // No labeller exists yet: the label is the template key (SPEC 20a).
      .map(([template_key, pages]) => ({ template_key, label: template_key, pages }))
  );
}

/**
 * What the check holds as served for JavaScript to fill in (OPERATING-RULES §5): a page v1's JS
 * detector reads as an app shell on the bytes the worker read (`content_features.client_rendered`,
 * content/read.ts), or one the render found an `empty_shell` (render/state.ts). It says whether the
 * homepage is one, and lists the template key of every one, sorted. The render's state widens v1's
 * signal here only: the grade still reads `homepage_client_rendered`, v1's alone.
 */
function clientRenderedOf(
  homepage: string,
  content: ReadonlyMap<string, ContentFeatures>,
  rendered: ReadonlyMap<string, NonNullable<PageResult['without_js']>>,
): DetectorInput['client_rendered'] {
  const shell = (url: string) =>
    content.get(url)?.client_rendered === true || rendered.get(url)?.state === 'empty_shell';
  const urls = [...new Set([...content.keys(), ...rendered.keys()])].filter(shell);
  return {
    homepage: shell(homepage),
    templates: [...new Set(urls.map(templateKeyFor))].sort(byText),
  };
}

function renderedPages(
  render: RenderOutcome | null,
  rows: ReadonlyMap<string, CrawlPage>,
): Map<string, NonNullable<PageResult['without_js']>> {
  const out = new Map<string, NonNullable<PageResult['without_js']>>();
  for (const p of render?.pages ?? []) {
    if (!rows.has(p.url))
      throw new Error(`buildCheck: a render of ${p.url}, which the crawl did not fetch`);
    if (p.rendered) out.set(p.url, p.without_js);
  }
  return out;
}
