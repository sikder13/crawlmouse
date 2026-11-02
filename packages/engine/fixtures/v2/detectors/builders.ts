/**
 * Inputs for the structure detectors' tests. Every PageResult, LinkEdge and Coverage here is parsed
 * by the contract's schema, so a fixture cannot be a shape the contract rejects. A spec's `facts` are
 * written into the PageResult's own fields (`contractFields`), which the detectors read back through
 * `pageFacts`, so every test goes through the contract.
 *
 * Deliberately misleading defaults: `links_in`, `is_orphan` and `depth` on each PageResult say
 * "linked, not an orphan, on the homepage". The detectors must compute those from the edges, and a
 * detector that read these fields instead would fail the tests.
 */
import {
  CoverageSchema,
  HttpUrlSchema,
  LinkEdgeSchema,
  PageResultSchema,
  type Coverage,
  type LinkEdge,
  type PageResult,
  type SearchRobots,
} from '@crawlmouse/types/v2';
import { excludedByRobots, SEARCH_ENGINES } from '../../../src/v2/detectors/scope.js';
import type { DetectorInput, PageFacts } from '../../../src/v2/detectors/types.js';

export const HOST = 'https://a.test';
export const CHECK_ID = 'c0000000-0000-4000-8000-0000000000c1';

/** A URL on the fixture host; `/` is the homepage, spelled as `canonicalizeUrl` spells it. */
export const u = (path: string): string => (path === '/' ? HOST : `${HOST}${path}`);

type PageKind = PageResult['kind'];

export interface LinkSpec {
  to: string;
  anchor?: string;
  generic?: boolean;
}

export interface PageSpec {
  /** A path on HOST, or a full URL. */
  path: string;
  status?: number;
  kind?: PageKind;
  template?: string;
  pr?: number | null;
  links?: readonly (string | LinkSpec)[];
  /** Distinct links found on the page; defaults to the links recorded. */
  links_out?: number;
  /**
   * Overrides the page's facts. By default a 200 page was fetched at its own URL with its links read
   * (`final_url` itself, `links_read: true`), and nothing else about it was read.
   */
  facts?: Partial<Omit<PageFacts, 'url'>>;
  /** robots.txt's verdicts for the search engines; by default every one is allowed. */
  robots_search?: SearchRobots;
}

/** A URL robots.txt kept our crawler from, and what it says to the search engines about it. */
export interface DisallowedSpec {
  path: string;
  /** The search engines that are disallowed too; by default all of them. */
  search?: readonly string[];
}

export interface SiteOptions {
  /** URLs discovered; defaults to the pages given (a complete crawl). */
  discovered?: number;
  cap?: number;
  status?: 'finished' | 'partial';
  previous?: Coverage | null;
  homepage?: string;
  /** `none`: no fact about any page was read. */
  facts?: 'none';
  /** URLs robots.txt kept our crawler from; discovered, and counted as excluded when every search engine is disallowed too. */
  disallowed?: readonly DisallowedSpec[];
}

const full = (p: string) => (p.startsWith('http') ? p : u(p));

export const templateOf = (path: string): string => {
  if (path === '/' || path === HOST) return '/';
  const first = new URL(full(path)).pathname.split('/').filter(Boolean)[0] ?? '';
  return `/${first}/{slug}`;
};

/** Every search engine allowed, or disallowed. */
export const searchVerdicts = (disallowed: readonly string[] = []): SearchRobots =>
  SEARCH_ENGINES.map((ua) => ({
    ua,
    verdict: disallowed.includes(ua) ? 'disallowed_by_robots' : 'allowed',
  }));

const isHttpUrl = (s: string) => HttpUrlSchema.safeParse(s).success;

/** A page's facts as the PageResult fields the worker records them in. */
export function contractFields(url: string, f: Omit<PageFacts, 'url'>) {
  return {
    final_url: f.final_url,
    redirect:
      f.redirect === null
        ? null
        : {
            hops: Array.from({ length: f.redirect.hops }, () => ({
              from: url,
              status: 301,
              location: f.final_url ?? url,
            })),
            loop: f.redirect.loop,
          },
    canonical_declared:
      f.canonical === null
        ? null
        : {
            href: f.canonical.href,
            url: f.canonical.href !== null && isHttpUrl(f.canonical.href) ? f.canonical.href : null,
          },
    hreflang:
      f.hreflang === null
        ? null
        : { links: f.hreflang.map((l) => ({ hreflang: l.lang, href: l.href })), complete: true },
    content_simhash: f.simhash,
    links_read: f.links_read,
  };
}

const UNREAD: Omit<PageFacts, 'url'> = {
  final_url: null,
  links_read: false,
  redirect: null,
  canonical: null,
  simhash: null,
  hreflang: null,
};

/** A page; its facts are `spec.facts` over a page read at its own URL (`readAtItself`). */
export function page(
  spec: PageSpec,
  base: Partial<Omit<PageFacts, 'url'>> = readAtItself(spec),
): PageResult {
  const links = spec.links ?? [];
  const facts = { ...UNREAD, ...base, ...spec.facts };
  return PageResultSchema.parse({
    check_id: CHECK_ID,
    url: full(spec.path),
    template_key: spec.template ?? templateOf(spec.path),
    kind: spec.kind ?? 'content',
    status_code: spec.status ?? 200,
    depth: 0,
    links_in: 1,
    links_out: spec.links_out ?? links.length,
    pagerank_share: spec.pr === undefined ? 0 : spec.pr,
    is_orphan: false,
    js_only: false,
    found_via: 'link',
    sitemap_lastmod: null,
    suggested_parent_url: null,
    sampled: false,
    without_js: null,
    crawlers_reached: null,
    crawlers_reading_text: null,
    content_failures: null,
    ...contractFields(full(spec.path), facts),
    robots_search: spec.robots_search ?? searchVerdicts(),
  });
}

export function edge(from: string, link: string | LinkSpec): LinkEdge {
  const l = typeof link === 'string' ? { to: link } : link;
  return LinkEdgeSchema.parse({
    check_id: CHECK_ID,
    from_url: full(from),
    to_url: full(l.to),
    anchor_text: l.anchor ?? `About ${l.to}`,
    is_generic_anchor: l.generic ?? false,
    js_only: false,
  });
}

export function coverageOf(
  pages: readonly PageResult[],
  discovered: number,
  excludedByRobots = 0,
): Coverage {
  const counts = new Map<string, number>();
  for (const p of pages) counts.set(p.template_key, (counts.get(p.template_key) ?? 0) + 1);
  return CoverageSchema.parse({
    pages_discovered: discovered,
    pages_crawled: pages.length,
    pages_sampled: 0,
    templates: [...counts]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([template_key, n]) => ({ template_key, label: template_key, pages: n })),
    sample_strategy: { method: 'stratified_by_template', max_pages: 1 },
    gradeable: pages.filter((p) => p.kind === 'content' && p.status_code === 200).length,
    excluded: [],
    excluded_by_robots: excludedByRobots,
  });
}

function readAtItself(s: PageSpec): Partial<Omit<PageFacts, 'url'>> {
  return (s.status ?? 200) === 200 ? { final_url: full(s.path), links_read: true } : {};
}

/** A check over `specs`, complete unless the options say otherwise. */
export function site(specs: readonly PageSpec[], opts: SiteOptions = {}): DetectorInput {
  const pages = specs.map((s) => (opts.facts === 'none' ? page(s, {}) : page(s)));
  const disallowed = (opts.disallowed ?? []).map((d) => ({
    url: full(d.path),
    robots_search: searchVerdicts(d.search ?? SEARCH_ENGINES),
  }));
  return {
    check: {
      status: opts.status ?? 'finished',
      coverage: coverageOf(
        pages,
        opts.discovered ?? pages.length + disallowed.length,
        excludedByRobots(disallowed).size,
      ),
    },
    page_cap: opts.cap ?? 10_000,
    homepage_url: full(opts.homepage ?? '/'),
    pages,
    edges: specs.flatMap((s) => (s.links ?? []).map((l) => edge(s.path, l))),
    disallowed,
    previous_coverage: opts.previous ?? null,
  };
}

/** A same-length hex simhash `bits` bits away from `base` (flips the lowest bits). */
export function simhashAway(base: string, bits: number): string {
  let v = BigInt(`0x${base}`);
  for (let b = 0; b < bits; b++) v ^= 1n << BigInt(b);
  return v.toString(16).padStart(16, '0');
}
