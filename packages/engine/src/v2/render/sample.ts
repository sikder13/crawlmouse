/**
 * Which pages a check renders: a pure function of the crawl.
 *
 * Only a graded page can be rendered (a 200 HTML content page, the population Readable is computed
 * over), and only one the crawl fetched as our crawler under our robots.txt group: a page robots.txt
 * disallows to us is never rendered. Picks are made in this order until `maxRenders` is reached:
 *
 *   1. PAGES_PER_FIX_TEMPLATE pages of each template that carries an open client-rendered fix, so the
 *      fix can be judged on more than one page (ENGINE-GAP §5);
 *   2. one page of every other template, largest template first;
 *   3. the highest-PageRank pages not yet picked.
 *
 * Within a template, pages go by PageRank, highest first. Every tie is broken by URL or template key,
 * so the order the crawl lists its pages in does not change the result. When the cap is below what
 * covering every template needs, some templates get no render: the estimate then says "K of T
 * templates" and Readable reports a range.
 */
import type { PageResult } from '@crawlmouse/types/v2';

export const FREE_MAX_RENDERS = 25;
export const PAGES_PER_FIX_TEMPLATE = 2;

export interface RenderCandidate extends Pick<
  PageResult,
  'url' | 'template_key' | 'kind' | 'status_code' | 'is_html' | 'pagerank_share'
> {
  /** The crawl fetched this page as our crawler, under our robots.txt group. */
  fetched_under_our_robots: boolean;
}

export type PickedFor = 'open_fix' | 'template' | 'pagerank';

export interface SampledPage {
  url: string;
  template_key: string;
  picked_for: PickedFor;
}

export const renderable = (p: RenderCandidate): boolean =>
  p.fetched_under_our_robots && p.kind === 'content' && p.status_code === 200 && p.is_html;

const byPagerank = (a: RenderCandidate, b: RenderCandidate): number =>
  (b.pagerank_share ?? -1) - (a.pagerank_share ?? -1) ||
  (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

export function selectRenders(
  candidates: readonly RenderCandidate[],
  openFixTemplates: readonly string[],
  maxRenders: number,
): SampledPage[] {
  if (!Number.isInteger(maxRenders) || maxRenders < 0) {
    throw new RangeError(`maxRenders must be a whole number of renders, got ${maxRenders}`);
  }
  const pool = candidates.filter(renderable).sort(byPagerank);
  const templates = new Map<string, RenderCandidate[]>();
  for (const p of pool)
    templates.set(p.template_key, [...(templates.get(p.template_key) ?? []), p]);

  const picked: SampledPage[] = [];
  const taken = new Set<string>();
  const take = (p: RenderCandidate, picked_for: PickedFor) => {
    if (picked.length >= maxRenders || taken.has(p.url)) return;
    taken.add(p.url);
    picked.push({ url: p.url, template_key: p.template_key, picked_for });
  };

  const fixes = new Set(openFixTemplates);
  const keys = [...templates.keys()].sort();
  for (const key of keys.filter((k) => fixes.has(k))) {
    for (const p of templates.get(key)!.slice(0, PAGES_PER_FIX_TEMPLATE)) take(p, 'open_fix');
  }
  const largestFirst = keys
    .filter((k) => !fixes.has(k))
    .sort((a, b) => templates.get(b)!.length - templates.get(a)!.length || (a < b ? -1 : 1));
  for (const key of largestFirst) take(templates.get(key)![0]!, 'template');
  for (const p of pool) take(p, 'pagerank');
  return picked;
}
