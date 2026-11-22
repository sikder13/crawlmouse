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
    'check_id' | 'status_code' | 'is_html' | 'links_read' | 'kind' | 'template_key'
  >[];
};

const rowsOf = (d: PageRows, check: Check) => d.page_results.filter((p) => p.check_id === check.id);

function accessLevel(check: Check): MeasuredLevel {
  const ai = check.crawlers.filter((c) => c.group !== 'search_engine');
  const answered = ai.filter(
    (c) => c.verdict !== 'not_measured' && c.verdict !== 'edge_blocks_automation',
  );
  if (!answered.length) return 'none';
  const sampled = check.coverage?.pages_sampled ?? 0;
  // A verdict robots.txt states holds for the site; one from our requests rests on its pages.
  const enough = (c: Check['crawlers'][number]) =>
    c.evidence_class === 'declared' || c.pages_measured >= sampled;
  return answered.length === ai.length && ai.every(enough) ? 'full' : 'partial';
}

/** A status that means we were kept from the page. A 3xx, 404 or 410 is the site's own answer. */
const keptFromPage = (status: number) =>
  status === 401 || status === 403 || status === 429 || status >= 500;

/** Pages whose links we read in full, of the pages the crawl found. */
export function pagesRead(d: PageRows, check: Check) {
  const rows = rowsOf(d, check);
  // Counted from the pages known not read: a stored record can hold fewer rows than were crawled.
  const unread = rows.filter((p) => !(p.status_code === 200 && p.is_html && p.links_read)).length;
  const crawled = check.coverage?.pages_crawled ?? rows.length;
  return {
    read: Math.max(crawled - unread, 0),
    total: check.coverage?.pages_discovered ?? crawled,
  };
}

function structureLevel(d: PageRows, check: Check): MeasuredLevel {
  const s = check.structure;
  // A graph with no link has no orphans, so its zero says nothing about the site.
  if (!s || (s.internal_links === 0 && s.js_only_pages === 0)) return 'none';
  const rows = rowsOf(d, check);
  const coverage = check.coverage;
  const short = !!coverage && coverage.pages_crawled < coverage.pages_discovered;
  const kept = rows.some((p) => keptFromPage(p.status_code));
  const unread = rows.some((p) => p.status_code === 200 && p.is_html && !p.links_read);
  return short || kept || unread ? 'partial' : 'full';
}

function contentLevel(d: PageRows, check: Check): MeasuredLevel {
  const read = new Set(
    (check.content?.checks ?? []).flatMap((c) =>
      c.by_template.filter((r) => r.total > 0).map((r) => r.template_key),
    ),
  );
  if (!read.size) return 'none';
  // Thin, archive, 404 and non-HTML pages are never evaluated, so only gradeable pages count.
  const eligible = rowsOf(d, check).filter((p) => p.kind === 'content' && p.status_code === 200);
  return eligible.every((p) => read.has(p.template_key)) ? 'full' : 'partial';
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
      return contentLevel(d, check);
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
export const partlyRead = ({ read, total }: { read: number; total: number }) =>
  `${count(read)} of ${count(total)} pages had their links read.`;
