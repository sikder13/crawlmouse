/**
 * deep_pages: a gradeable 200 page more than MAX_HEALTHY_DEPTH clicks from the homepage.
 *
 * Depth is v1's breadth-first `computeDepth`, run only when the homepage was crawled: without it v1
 * re-roots at other pages, and the result is no longer clicks from the homepage. Pages outside the
 * crawl can only add links, and links can only shorten a path, so an observed depth within the limit
 * is proven on any crawl, while one past it is proven only when `absenceUnproven` (scope.ts) finds
 * nothing the crawl missed, and the page is not served for JavaScript to fill in (`clientRendered`).
 */
import type { Coverage } from '@crawlmouse/types/v2';
import Graph from 'graphology';
import { computeDepth } from '../../analysis/depth.js';
import type { SiteGraph } from '../../graph.js';
import {
  absenceUnproven,
  byText,
  clientRendered,
  isGradeable,
  record,
  scopeOf,
  goneRecords,
  uncrawledRecords,
  type Scope,
} from './scope.js';
import { MAX_HEALTHY_DEPTH, MIN_STRATA_OVERLAP } from './thresholds.js';
import type { Detection, DetectorInput } from './types.js';

/**
 * How alike two checks' samples are: the template-weighted Jaccard of their page counts,
 * Σ min(previous, current) / Σ max(previous, current) over every template either has.
 */
export function strataOverlap(previous: Coverage, current: Coverage): number {
  const count = (c: Coverage) => new Map(c.templates.map((t) => [t.template_key, t.pages]));
  const [a, b] = [count(previous), count(current)];
  let shared = 0;
  let either = 0;
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    shared += Math.min(a.get(key) ?? 0, b.get(key) ?? 0);
    either += Math.max(a.get(key) ?? 0, b.get(key) ?? 0);
  }
  return either === 0 ? 1 : shared / either;
}

/**
 * The links of crawled 200 pages as a graph for v1's depth search. The homepage is always a node, so
 * `computeDepth` roots there and never takes its re-rooting fallback.
 */
function graphOf(s: Scope, homepage: string): SiteGraph {
  const g: SiteGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  const node = (url: string) => {
    if (!g.hasNode(url))
      g.addNode(url, { urlHash: url, statusCode: s.page.get(url)?.status_code ?? 0 });
  };
  node(homepage);
  for (const [from, edges] of s.out) {
    node(from);
    for (const e of edges) {
      node(e.to_url);
      g.addDirectedEdge(from, e.to_url, {
        anchorText: e.anchor_text,
        isGenericAnchor: e.is_generic_anchor,
      });
    }
  }
  return g;
}

/** One shortest path from the homepage to `url`, choosing the first linker by URL at each step. */
function pathTo(url: string, depths: Map<string, number>, s: Scope): string[] {
  const path = [url];
  let at = url;
  while (depths.get(at)! > 0) {
    const d = depths.get(at)!;
    at = (s.in.get(at) ?? [])
      .map((e) => e.from_url)
      .filter((f) => depths.get(f) === d - 1)
      .sort(byText)[0]!;
    path.push(at);
  }
  return path;
}

export function detectDeepPages(input: DetectorInput): Detection[] {
  const s = scopeOf(input);
  const home = s.page.get(input.homepage_url);
  const homeCrawled = home !== undefined && home.status_code === 200;
  const depths = homeCrawled
    ? computeDepth(graphOf(s, input.homepage_url), input.homepage_url)
    : new Map<string, number>();
  const sampleChanged =
    input.previous_coverage !== null &&
    input.check.coverage !== null &&
    strataOverlap(input.previous_coverage, input.check.coverage) < MIN_STRATA_OVERLAP;

  const judged = s.ok
    .map((url) => s.page.get(url)!)
    .filter((p) => isGradeable(p) && p.url !== input.homepage_url)
    .map((p) => {
      const depth = depths.get(p.url) ?? null;
      const path = depth === null ? [p.url] : pathTo(p.url, depths, s);
      const base = { measured: depth, affected: [p.url], pages: path };
      if (!homeCrawled) {
        return record('deep_pages', p.url, {
          ...base,
          state: 'indeterminate',
          reason: 'homepage_not_crawled',
        });
      }
      if (sampleChanged)
        return record('deep_pages', p.url, {
          ...base,
          state: 'indeterminate',
          reason: 'sample_changed',
        });
      if (depth !== null && depth <= MAX_HEALTHY_DEPTH)
        return record('deep_pages', p.url, { ...base, state: 'not_detected' });
      if (clientRendered(s, p)) {
        return record('deep_pages', p.url, {
          ...base,
          state: 'indeterminate',
          reason: 'client_rendered',
        });
      }
      const unproven = absenceUnproven(s);
      if (unproven !== null) {
        return record('deep_pages', p.url, { ...base, state: 'indeterminate', reason: unproven });
      }
      return record('deep_pages', p.url, { ...base, state: 'detected' });
    });
  return [...judged, ...goneRecords('deep_pages', s), ...uncrawledRecords('deep_pages', s)];
}
