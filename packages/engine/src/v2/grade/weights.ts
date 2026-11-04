/**
 * Every weight and threshold the v2 grades are computed with. The spec
 * (docs/specs/v2/17-content-and-grade.md) is rendered from this module, and grade-guard.test.ts fails
 * when any file of the grade changes without expected.json.
 */
import type { Verdict } from '@crawlmouse/types/v2';

/** The version both grades are computed at; `Check.grade_version`. */
export const GRADE_VERSION = '2.0.0';

/** AI readability's components and their maxima (Access 40 / Readable 30 / Quotable 20 / Signals 10). */
export const AI_WEIGHTS = { access: 40, readable: 30, quotable: 20, signals: 10 } as const;

/** Technical SEO: site structure 60 / crawlability 40. */
export const SEO_WEIGHTS = { structure: 60, crawlability: 40 } as const;

/**
 * What one sampled page counts for in a crawler's Access ratio. Every verdict not listed is out of the
 * denominator: a robots.txt disallow is the site's choice; a challenge or an unverified refusal says
 * nothing about the real crawler; a rate limit, a pay-per-crawl answer, a redirect away, a block of
 * all automation and an unmeasured page say nothing about access.
 */
export const ACCESS_CELL_WEIGHT: Readonly<Partial<Record<Verdict, number>>> = {
  allowed: 1,
  allowed_thin: 0.5,
  blocked_by_ua_rule: 0,
};

/** A scored crawler counts as measured for Access with at least this many pages in its denominator. */
export const MIN_ACCESS_PAGES = 2;

/** Fewer measured scored crawlers than this withholds AI readability (FACTS I4). */
export const MIN_MEASURED_CRAWLERS = 2;

/** Signals: points for each declaration that counts (FACTS B5); the other declarations count nothing. */
export const SIGNAL_POINTS = { schema_org: 5, content_signals: 5 } as const;

/** Grades and components are given to this many decimal places. */
export const DECIMALS = 2;
