/**
 * Inputs for the structure detectors' tests. Every PageResult, LinkEdge and Coverage here is parsed
 * by the contract's schema, so a fixture cannot be a shape the contract rejects.
 *
 * Deliberately misleading defaults: `links_in`, `is_orphan` and `depth` on each PageResult say
 * "linked, not an orphan, on the homepage". The detectors must compute those from the edges, and a
 * detector that read these fields instead would fail the tests.
 */
import {
  CoverageSchema,
  LinkEdgeSchema,
  PageResultSchema,
  type Coverage,
  type LinkEdge,
  type PageResult,
} from '@crawlmouse/types/v2';
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
  /** Present when given: the rest of PageFacts defaults to "not read". */
  facts?: Partial<Omit<PageFacts, 'url'>>;
}

export interface SiteOptions {
  /** URLs discovered; defaults to the pages given (a complete crawl). */
  discovered?: number;
  cap?: number;
  status?: 'finished' | 'partial';
  previous?: Coverage | null;
  robots?: readonly string[] | null;
  homepage?: string;
}

const full = (p: string) => (p.startsWith('http') ? p : u(p));

export const templateOf = (path: string): string => {
  if (path === '/' || path === HOST) return '/';
  const first = new URL(full(path)).pathname.split('/').filter(Boolean)[0] ?? '';
  return `/${first}/{slug}`;
};

export function page(spec: PageSpec): PageResult {
  const links = spec.links ?? [];
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

export function facts(path: string, f: Partial<Omit<PageFacts, 'url'>> = {}): PageFacts {
  return {
    url: full(path),
    final_url: null,
    redirect: null,
    canonical: null,
    simhash: null,
    hreflang: null,
    ...f,
  };
}

export function coverageOf(pages: readonly PageResult[], discovered: number): Coverage {
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
  });
}

/** A check over `specs`, complete unless the options say otherwise. */
export function site(specs: readonly PageSpec[], opts: SiteOptions = {}): DetectorInput {
  const pages = specs.map(page);
  return {
    check: {
      status: opts.status ?? 'finished',
      coverage: coverageOf(pages, opts.discovered ?? pages.length),
    },
    page_cap: opts.cap ?? 10_000,
    homepage_url: full(opts.homepage ?? '/'),
    pages,
    edges: specs.flatMap((s) => (s.links ?? []).map((l) => edge(s.path, l))),
    facts: specs.filter((s) => s.facts).map((s) => facts(s.path, s.facts)),
    robots_disallowed: opts.robots === undefined ? [] : opts.robots,
    previous_coverage: opts.previous ?? null,
  };
}

/** A same-length hex simhash `bits` bits away from `base` (flips the lowest bits). */
export function simhashAway(base: string, bits: number): string {
  let v = BigInt(`0x${base}`);
  for (let b = 0; b < bits; b++) v ^= 1n << BigInt(b);
  return v.toString(16).padStart(16, '0');
}
