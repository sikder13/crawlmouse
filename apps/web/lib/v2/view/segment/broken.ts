/**
 * Which pages of a check's record answer an error, read through the pages CSV's accessor
 * (reports/csv.ts), so the Links and pages screen, its door, the tab's figure and the CSV agree.
 */
import type { PageResult } from '@crawlmouse/types/v2';
import { PAGE_CELLS } from '../../reports/csv';
import type { ViewDataset } from '../../fixtures';

/** A page answers an error: a status of 400 or more. */
export const isBroken = (p: PageResult): boolean => PAGE_CELLS.status_code(p) >= 400;

/** The pages of check `checkId` that answer an error, in the record's order. */
export const brokenPagesOf = (d: ViewDataset, checkId: string): PageResult[] =>
  d.page_results.filter((p) => p.check_id === checkId && isBroken(p));
