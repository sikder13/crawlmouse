/**
 * Which empty-root pages a check renders, in a phase of its own after the graded sample (run.ts).
 *
 * An empty-root page answered 200 with HTML, v1's classifier classed it `thin`, and v1's JS detector
 * read the bytes the crawl fetched as an app shell (`content_features.client_rendered`,
 * content/read.ts). Such a page is not graded, so `selectRenders` never picks it; without a render of
 * it, a template of such pages gets no `client_rendered_template` record (detectors/rendered.ts).
 *
 * The pool is every crawled page; the crawl fetched each as our crawler under our robots.txt group.
 * The picks are the empty-root pages of templates with no graded page in the pool (`isGraded`): the
 * detector judges a template that has a graded page on its graded renders alone, so an empty-root
 * render there would decide nothing. They are ordered by template key, then PageRank (highest first),
 * then URL, taking at most EMPTY_ROOT_PER_TEMPLATE of a template and EMPTY_ROOT_MAX_RENDERS in all. A URL
 * the pool lists twice is taken once, by `oncePerUrl`'s rule, and not at all when any listing of it is
 * not an empty-root page. So the order the pool lists its pages in does not change the result.
 */
import { isGraded } from '../grade/technical-seo.js';
import { oncePerUrl, type RenderCandidate } from './sample.js';

/** The most empty-root pages one check renders. */
export const EMPTY_ROOT_MAX_RENDERS = 5;
/** The most empty-root pages of one template one check renders. */
export const EMPTY_ROOT_PER_TEMPLATE = 2;

export interface EmptyRootCandidate extends RenderCandidate {
  /** The crawl row's `content_features.client_rendered`; false when the row has no features. */
  client_rendered: boolean;
}

export interface EmptyRootPick {
  url: string;
  template_key: string;
  picked_for: 'empty_root';
}

export const emptyRoot = (p: EmptyRootCandidate): boolean =>
  p.fetched_under_our_robots &&
  p.kind === 'thin' &&
  p.status_code === 200 &&
  p.is_html &&
  p.client_rendered;

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function selectEmptyRoots(
  pool: readonly EmptyRootCandidate[],
  maxRenders: number,
): EmptyRootPick[] {
  if (!Number.isInteger(maxRenders) || maxRenders < 0) {
    throw new RangeError(`maxRenders must be a whole number of renders, got ${maxRenders}`);
  }
  const barred = new Set(pool.filter((p) => !emptyRoot(p)).map((p) => p.url));
  const gradedTemplates = new Set(pool.filter(isGraded).map((p) => p.template_key));
  const ordered = oncePerUrl(
    pool.filter((p) => !barred.has(p.url) && !gradedTemplates.has(p.template_key)),
  ).sort(
    (a, b) =>
      order(a.template_key, b.template_key) ||
      (b.pagerank_share ?? -1) - (a.pagerank_share ?? -1) ||
      order(a.url, b.url),
  );
  const perTemplate = new Map<string, number>();
  const picked: EmptyRootPick[] = [];
  for (const p of ordered) {
    if (picked.length >= maxRenders) break;
    const n = perTemplate.get(p.template_key) ?? 0;
    if (n >= EMPTY_ROOT_PER_TEMPLATE) continue;
    perTemplate.set(p.template_key, n + 1);
    picked.push({ url: p.url, template_key: p.template_key, picked_for: 'empty_root' });
  }
  return picked;
}
