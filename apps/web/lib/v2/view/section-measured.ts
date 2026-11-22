/**
 * How much of a section a check measured: `full`, `partial` or `none`, decided from what it read and
 * not from whether a score was given (the engine withholds scores for reasons unrelated to reading).
 * A clean sentence needs `full`. The claims this governs are listed in the V2R question 011.
 */
import type { Check, FixSection, PageResult } from '@crawlmouse/types/v2';
import { count } from '../words';

export type MeasuredLevel = 'full' | 'partial' | 'none';
export const SECTIONS_MEASURED: readonly FixSection[] = [
  'crawler_access',
  'without_js',
  'structure',
  'content',
];

/** What the rule reads of a dataset: the page rows. */
export type PageRows = {
  page_results: readonly Pick<
    PageResult,
    'check_id' | 'status_code' | 'depth' | 'is_orphan' | 'js_only'
  >[];
};

function accessLevel(check: Check): MeasuredLevel {
  const ai = check.crawlers.filter((c) => c.group !== 'search_engine');
  const answered = ai.filter(
    (c) => c.verdict !== 'not_measured' && c.verdict !== 'edge_blocks_automation',
  );
  if (!answered.length) return 'none';
  const sampled = check.coverage?.pages_sampled ?? 0;
  // A verdict robots.txt states holds for the site; one from our requests rests on its pages.
  const enough = (c: Check['crawlers'][number]) =>
    c.evidence_class === 'declared' || c.pages_measured * 2 >= sampled;
  return answered.length === ai.length && ai.every(enough) ? 'full' : 'partial';
}

/** Of the pages that answered 200, those the graph accounts for: reached, orphaned or JS-only. */
export function placedPages(d: PageRows, check: Check) {
  const served = d.page_results.filter((p) => p.check_id === check.id && p.status_code === 200);
  const placed = served.filter((p) => p.depth !== null || p.is_orphan || p.js_only);
  return { placed: placed.length, total: served.length };
}

function structureLevel(d: PageRows, check: Check): MeasuredLevel {
  const s = check.structure;
  // A graph with no link has no orphans, so its zero says nothing about the site.
  if (!s || (s.internal_links === 0 && s.js_only_pages === 0)) return 'none';
  const { placed, total } = placedPages(d, check);
  return placed === total ? 'full' : 'partial';
}

function contentLevel(check: Check): MeasuredLevel {
  const read = new Set(
    (check.content?.checks ?? []).flatMap((c) =>
      c.by_template.filter((r) => r.total > 0).map((r) => r.template_key),
    ),
  );
  if (!read.size) return 'none';
  const templates = check.coverage?.templates ?? [];
  return templates.every((t) => read.has(t.template_key)) ? 'full' : 'partial';
}

export function measuredLevel(d: PageRows, check: Check, section: FixSection): MeasuredLevel {
  switch (section) {
    case 'crawler_access':
      return accessLevel(check);
    case 'without_js':
      return check.without_js === null ? 'none' : 'full';
    case 'structure':
      return structureLevel(d, check);
    case 'content':
      return contentLevel(check);
  }
}

export const measuredInFull = (d: PageRows, check: Check) =>
  SECTIONS_MEASURED.every((s) => measuredLevel(d, check, s) === 'full');

/** What "no fix here" means at each level. */
export const noFixWords = (level: MeasuredLevel) =>
  level === 'full'
    ? 'nothing to fix'
    : level === 'partial'
      ? 'nothing to fix in what was measured'
      : 'not measured';

/** The structure sentence at `partial`, in the check's own numbers. */
export const partlyPlaced = ({ placed, total }: { placed: number; total: number }) =>
  `${count(placed)} of ${count(total)} pages could be placed through the links we read.`;
