/**
 * Which pages of a check's record are missing (they answer 404 or 410) and which answer another
 * error, read through the pages CSV's status accessor (reports/csv.ts). The link map, the Links and
 * pages screen, its door, the tab's figure and the PDF all read the statuses below from here.
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
 * The page exists but answered an error: a status of 400 or more outside MISSING_STATUSES (a 403,
 * a 429, a 503). It is not called broken or missing.
 */
export const isOtherError = (p: PageResult): boolean =>
  PAGE_CELLS.status_code(p) >= 400 && !isMissing(p);

/** The pages of check `checkId` that are missing, in the record's order. */
export const missingPagesOf = (d: ViewDataset, checkId: string): PageResult[] =>
  d.page_results.filter((p) => p.check_id === checkId && isMissing(p));
