/**
 * The groups of verdicts the access rules are written in, and the two conditions both the matrix and
 * the detectors decide on. One definition of each, so the site verdict and the records cannot
 * disagree about whether robots.txt or a user-agent rule keeps a crawler out.
 */
import { UNMEASURED_VERDICTS, type Verdict } from '@crawlmouse/types/v2';
import { EDGE_DETECT_SHARE } from './thresholds.js';
import type { Cell } from './types.js';

export const SERVED: readonly Verdict[] = ['allowed', 'allowed_thin'];

/** Verdicts whose real crawler, from its own addresses, may get something else. */
export const UNCERTAIN: readonly Verdict[] = ['challenged_ua', 'refused_unverified'];

/** Answers that keep the crawler out without being a block or a refusal. */
export const OTHER_ANSWERS: readonly Verdict[] = [
  'rate_limited',
  'payment_required',
  'redirected_away',
];

/** The verdicts that say how the site answered the crawler's own request. */
export const EDGE_ANSWERED: readonly Verdict[] = [
  ...SERVED,
  'blocked_by_ua_rule',
  ...UNCERTAIN,
  ...OTHER_ANSWERS,
];

export const isMeasured = (v: Verdict): boolean => !UNMEASURED_VERDICTS.includes(v);

export const having = (cells: readonly Cell[], vs: readonly Verdict[]): Cell[] =>
  cells.filter((c) => vs.includes(c.verdict));

/**
 * The cells whose robots.txt rules were read for the crawler: every verdict but `not_measured`. A
 * search engine's reading says so itself. For a worker row, `disallowed_by_robots` is the reading, and
 * any other verdict but `not_measured` was decided after robots.txt allowed the crawler on the page,
 * since the worker decides a disallow first; a `not_measured` row may come before robots.txt was read.
 */
export const robotsRead = (cells: readonly Cell[]): Cell[] =>
  cells.filter((c) => c.verdict !== 'not_measured');

/** robots.txt disallows the crawler on each page whose rules were read for it, one at least. */
export function robotsHolds(cells: readonly Cell[]): boolean {
  const read = robotsRead(cells);
  return read.length > 0 && read.every((c) => c.verdict === 'disallowed_by_robots');
}

/**
 * Of the pages the site answered the crawler on (EDGE_ANSWERED), user-agent blocks hold on at least
 * EDGE_DETECT_SHARE, and outnumber the challenges and unverified refusals together.
 */
export function uaBlockHolds(answered: readonly Cell[]): boolean {
  const blocked = having(answered, ['blocked_by_ua_rule']).length;
  return (
    answered.length > 0 &&
    blocked >= EDGE_DETECT_SHARE * answered.length &&
    blocked > having(answered, UNCERTAIN).length
  );
}
