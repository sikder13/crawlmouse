/**
 * What the Result page's third card may say when a check has no fix. "No fix" alone proves nothing: a
 * check that read nothing has none. So the card says all-clear only on what was measured.
 */
export interface MeasuredFacts {
  /** Pages with a response of any status, as the check's page rows hold them. */
  pagesAnswered: number;
  /** Of those, pages that answered 200: what the row states, and no more. */
  pagesServed: number;
  /** The check holds a Technical SEO letter, so it is never described as having graded nothing. */
  graded: boolean;
  /** AI crawlers whose verdict is `not_measured`. */
  aiUnmeasured: number;
  /** The check read something of each section of the result (`everySectionMeasured`). */
  everySectionMeasured: boolean;
}

export type NoFixKind = 'not-served' | 'unmeasured' | 'all-clear';

export function noFixKind(f: MeasuredFacts): NoFixKind {
  if (f.pagesAnswered > 0 && f.pagesServed === 0 && !f.graded) return 'not-served';
  return f.pagesServed > 0 && f.aiUnmeasured === 0 && f.everySectionMeasured
    ? 'all-clear'
    : 'unmeasured';
}

/** The statuses that are a server saying no to the request. A 404 or a 500 is not one. */
const REFUSALS: ReadonlySet<number> = new Set([401, 403, 429, 451]);

/** `refused` when each status is a refusal; otherwise the pages were just not served. */
export const servedWord = (codes: readonly number[]): 'refused' | 'not-served' =>
  codes.length > 0 && codes.every((c) => REFUSALS.has(c)) ? 'refused' : 'not-served';
