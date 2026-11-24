/**
 * Which pages of a check's record are missing (they answer 404 or 410) and which answer another
 * error, read through the pages CSV's status accessor (reports/csv.ts), and where each answered: a
 * page reached by a redirect answered at its final URL. The link map, the Links and pages screen,
 * its door, the tab's figure and the PDF all read the statuses and the grouping below from here, so
 * the map's count of missing pages and the Links screen's cannot disagree.
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

/** The request for `p` went through at least one recorded redirect. */
export const redirected = (p: PageResult): boolean => (p.redirect?.hops.length ?? 0) > 0;

/**
 * Where the request for `p` answered with its status: its final URL when it was redirected and the
 * final URL is recorded, otherwise its own URL.
 */
export const answeredAt = (p: PageResult): string =>
  (redirected(p) ? PAGE_CELLS.final_url(p) : null) ?? p.url;

/**
 * The pages of `pages` that answered an error, grouped by where they answered (`answeredAt`) and by
 * whether the answer was missing, in first-seen order: a final URL the record also holds as a page
 * is one group, not two. The two kinds are kept apart because one URL can answer both ways in one
 * check (a request redirected there got a 429, the page itself a 410), and a group's status is
 * that of every member.
 */
export function errorGroups(pages: readonly PageResult[]): [string, PageResult[]][] {
  const groups = new Map<string, { at: string; members: PageResult[] }>();
  for (const p of pages.filter((x) => isMissing(x) || isOtherError(x))) {
    const at = answeredAt(p);
    const key = `${isMissing(p) ? 'missing' : 'error'} ${at}`;
    const g = groups.get(key) ?? { at, members: [] };
    g.members.push(p);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => [g.at, g.members]);
}

/** The groups of `errorGroups` whose answer was missing: one per missing page, however reached. */
export const missingGroups = (pages: readonly PageResult[]): [string, PageResult[]][] =>
  errorGroups(pages).filter(([, members]) => isMissing(members[0]!));

/** The pages of check `checkId` that are missing, in the record's order. */
export const missingPagesOf = (d: ViewDataset, checkId: string): PageResult[] =>
  d.page_results.filter((p) => p.check_id === checkId && isMissing(p));
