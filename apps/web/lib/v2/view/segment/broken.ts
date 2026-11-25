/**
 * Which pages of a check's record are missing (they answer 404 or 410) and which answer another
 * error, read through the pages CSV's status accessor (reports/csv.ts), and where each answered: a
 * page reached by a redirect answered at its final URL when that URL is recorded. The link map
 * counts its missing pages with `missingUrls`, and the Links and pages screen, its door, the tab's
 * figure and the PDF count theirs from `errorRows`, which `missingUrls` reads: one rule for which
 * statuses are missing and where each answered. What each surface says around its count is its own.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { PAGE_CELLS } from '../../reports/csv';
import type { ViewDataset } from '../../fixtures';

/** The statuses that say a page is not there: the link map labels them missing, this view broken. */
export const MISSING_STATUSES: readonly number[] = [404, 410];

/** The page is not there: it answered one of MISSING_STATUSES. */
export const isMissing = (p: PageResult): boolean =>
  MISSING_STATUSES.includes(PAGE_CELLS.status_code(p));

/**
 * The page answered an error other than 404 or 410, which does not tell whether it exists: a status
 * of 400 or more outside MISSING_STATUSES (a 403, a 429, a 503). It is not called broken or missing.
 */
export const isOtherError = (p: PageResult): boolean =>
  PAGE_CELLS.status_code(p) >= 400 && !isMissing(p);

/** The request for `p` went through at least one recorded redirect. */
export const redirected = (p: PageResult): boolean => (p.redirect?.hops.length ?? 0) > 0;

/**
 * Where the request for `p` answered with its status: its final URL when it was redirected and the
 * final URL is recorded, otherwise its own URL.
 */
export const answeredAt = (p: PageResult): string =>
  (redirected(p) ? PAGE_CELLS.final_url(p) : null) ?? p.url;

/**
 * What the link map says of a missing page, by where it answered (`answeredAt`), as the Links and
 * pages rows place it: "redirects to a missing page (404)" when the request answered at another URL,
 * "missing (404)" when it answered at its own (a redirect whose final URL is not recorded included);
 * null for a page that is not missing.
 */
export const missingLabel = (p: PageResult): string | null =>
  !isMissing(p)
    ? null
    : answeredAt(p) !== p.url
      ? `redirects to a missing page (${PAGE_CELLS.status_code(p)})`
      : `missing (${PAGE_CELLS.status_code(p)})`;

/** One row of the pages that answered an error: where they answered, the status, and the pages. */
export interface ErrorRow {
  at: string;
  status: number;
  missing: boolean;
  members: PageResult[];
}

/**
 * The pages of `pages` that answered an error, one row per pair of the URL where they answered
 * (`answeredAt`) and the status, in first-seen order. The status is part of the row's key, so two
 * statuses at one URL are two rows: a request redirected there that got a 429 and the page itself
 * answering 503, or a 404 and a 410.
 */
export function errorRows(pages: readonly PageResult[]): ErrorRow[] {
  const rows = new Map<string, ErrorRow>();
  for (const p of pages.filter((x) => isMissing(x) || isOtherError(x))) {
    const at = answeredAt(p);
    const status = PAGE_CELLS.status_code(p);
    const key = `${status} ${at}`;
    const row = rows.get(key) ?? { at, status, missing: isMissing(p), members: [] };
    row.members.push(p);
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The distinct URLs where a missing page answered, in first-seen order: one per missing page. */
export const missingUrls = (pages: readonly PageResult[]): string[] => [
  ...new Set(
    errorRows(pages)
      .filter((r) => r.missing)
      .map((r) => r.at),
  ),
];

/** The pages of check `checkId` that are missing, in the record's order. */
export const missingPagesOf = (d: ViewDataset, checkId: string): PageResult[] =>
  d.page_results.filter((p) => p.check_id === checkId && isMissing(p));
