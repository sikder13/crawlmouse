/**
 * Row 18: how often edits of one site's competitor list may ask for the list to be audited
 * (`competitors.requested`, sent by `app/api/sites/[id]/route.ts`).
 *
 * Each send starts a run of the competitors function. The function's own fail-closed per-account
 * daily bucket (`competitors:account:<id>`) bounds the crawls; this bounds the runs an edit loop can
 * start. A send it refuses is not lost: the site's next check plans its competitors again.
 *
 * The window, one hour, is a const in the route itself, where `lib/rate-limit-callers.test.ts` reads
 * it from source.
 */
export const COMPETITOR_REQUESTS_PER_SITE = 6;

export const competitorRequestBucket = (siteId: string): string =>
  `competitors:requested:site:${siteId}`;
