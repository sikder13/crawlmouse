/**
 * Raw exports of one check (CC-31 D6): its pages as CSV, its links as an edge list, and its records
 * as JSON.
 *
 * `record` writes each cell of both CSV files through `csvCell`. A value that starts with one of
 * `FORMULA_STARTS` gets an apostrophe before it, so a spreadsheet shows it as text instead of
 * running it as a formula; then the cell is put in double quotes with each quote in it doubled
 * (RFC 4180), whatever it holds. Records end with CRLF. `csv.test.ts` reads the files back with a
 * reader of its own, over generated strings.
 *
 * The CSV holds the page's single-valued fields, in `PAGE_COLUMNS`' order; what was not read is an
 * empty cell. The redirects, the declared canonical, hreflang and the search engines' robots.txt
 * verdicts of a page are in the JSON file, which holds each record whole.
 */
import type { AccessTest, Check, LinkEdge, PageResult } from '@crawlmouse/types/v2';

/** A spreadsheet reads a cell that starts with one of these as a formula. */
export const FORMULA_STARTS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

type Value = string | number | boolean | null;

/** One cell: text, neutralised against formula injection, in double quotes. */
export function csvCell(value: Value): string {
  const text = value === null ? '' : String(value);
  const safe = FORMULA_STARTS.includes(text.charAt(0)) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const record = (values: readonly Value[]): string => `${values.map(csvCell).join(',')}\r\n`;

/** The pages file's columns, in order. Each is the contract's field of that name, or as noted. */
const PAGE_CELLS = {
  url: (p) => p.url,
  final_url: (p) => p.final_url,
  status_code: (p) => p.status_code,
  kind: (p) => p.kind,
  template_key: (p) => p.template_key,
  /** `title.text`: the page's first `<title>`, as kept. */
  title: (p) => p.title?.text ?? null,
  /** `meta_description.text`. */
  meta_description: (p) => p.meta_description?.text ?? null,
  depth: (p) => p.depth,
  links_in: (p) => p.links_in,
  links_out: (p) => p.links_out,
  pagerank_share: (p) => p.pagerank_share,
  is_orphan: (p) => p.is_orphan,
  js_only: (p) => p.js_only,
  found_via: (p) => p.found_via,
  sitemap_lastmod: (p) => p.sitemap_lastmod,
  suggested_parent_url: (p) => p.suggested_parent_url,
  sampled: (p) => p.sampled,
  /** `without_js.raw_words`, `.rendered_words`, `.text_share` and `.state`. */
  raw_words: (p) => p.without_js?.raw_words ?? null,
  rendered_words: (p) => p.without_js?.rendered_words ?? null,
  text_share: (p) => p.without_js?.text_share ?? null,
  text_state: (p) => p.without_js?.state ?? null,
  crawlers_reached: (p) => p.crawlers_reached,
  crawlers_reading_text: (p) => p.crawlers_reading_text,
  /** The checks the page fails, separated by spaces; empty when it was not evaluated or fails none. */
  content_failures: (p) => (p.content_failures?.length ? p.content_failures.join(' ') : null),
  is_html: (p) => p.is_html,
  links_read: (p) => p.links_read,
} as const satisfies Record<string, (p: PageResult) => Value>;

export const PAGE_COLUMNS = Object.keys(PAGE_CELLS) as (keyof typeof PAGE_CELLS)[];

/** One record per page response of `checkId`, after a record of the column names. */
export function pagesCsv(d: { page_results: readonly PageResult[] }, checkId: string): string {
  const pages = d.page_results.filter((p) => p.check_id === checkId);
  return [
    record(PAGE_COLUMNS),
    ...pages.map((p) => record(PAGE_COLUMNS.map((c) => PAGE_CELLS[c](p)))),
  ].join('');
}

export const EDGE_COLUMNS = ['from', 'to', 'anchor'] as const;

/** One record per link of `checkId`: the page it is on, the page it names, and its anchor text. */
export function edgeListCsv(d: { link_edges: readonly LinkEdge[] }, checkId: string): string {
  const edges = d.link_edges.filter((e) => e.check_id === checkId);
  return [
    record(EDGE_COLUMNS),
    ...edges.map((e) => record([e.from_url, e.to_url, e.anchor_text])),
  ].join('');
}

/**
 * The check and its page results, link edges and access tests, each as its contract record: the
 * fields a member's own session reads of those four tables (`csv.columns.test.ts` asks the database
 * for each).
 */
export function checkJson(
  d: {
    checks: readonly Check[];
    page_results: readonly PageResult[];
    link_edges: readonly LinkEdge[];
    access_tests: readonly AccessTest[];
  },
  checkId: string,
): string {
  const check = d.checks.find((c) => c.id === checkId);
  if (!check) throw new Error(`checkJson: no check ${checkId} in the records`);
  const ofCheck = <T extends { check_id: string }>(rows: readonly T[]) =>
    rows.filter((r) => r.check_id === checkId);
  return JSON.stringify({
    check,
    page_results: ofCheck(d.page_results),
    link_edges: ofCheck(d.link_edges),
    access_tests: ofCheck(d.access_tests),
  });
}
