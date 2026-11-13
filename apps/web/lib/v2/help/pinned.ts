/**
 * Facts the help articles state that live where this module cannot import them: the grade formulas'
 * weights (packages/engine/src/v2/grade/weights.ts, which the engine's published surfaces do not
 * export), the crawl worker's identity (packages/worker/src/identities.ts; the worker is not a
 * dependency of the app) and the verdicts' labels (components/v2/verdicts.ts, which lib may not
 * import: preview-guard.test.ts). `pinned.test.ts` holds each value equal to its source.
 */
import type { Verdict } from '@crawlmouse/types/v2';

/** AI readability's four parts and their maxima. */
export const AI_WEIGHTS = { access: 40, readable: 30, quotable: 20, signals: 10 } as const;

/** Technical SEO's two parts and their weights. */
export const SEO_WEIGHTS = { structure: 60, crawlability: 40 } as const;

/** The declarations that add points to Signals; the others are listed and count nothing. */
export const SCORED_SIGNALS = ['schema_org', 'content_signals'] as const;

/** The user agent of our own crawl and of robots.txt reads. */
export const CRAWL_USER_AGENT =
  'Mozilla/5.0 (compatible; Crawlmouse/2.0; +https://crawlmouse.com/bot)';

/** What is appended to each crawler's user agent when the audit requests as that crawler. */
export const CRAWLER_TAG = 'Crawlmouse/2.0 (+https://crawlmouse.com/bot)';

/** What the result calls a verdict the help articles explain. */
export const VERDICT_LABELS: Readonly<
  Record<
    Extract<Verdict, 'disallowed_by_robots' | 'blocked_by_ua_rule' | 'refused_unverified'>,
    string
  >
> = {
  disallowed_by_robots: 'blocked by robots.txt',
  blocked_by_ua_rule: 'blocked by a rule',
  refused_unverified: 'challenged: the real crawler may pass',
};

/** The robots.txt groups that bind the worker's requests. */
export const OUR_ROBOTS_TOKENS = ['Crawlmouse', 'CrawlmouseBot'] as const;
