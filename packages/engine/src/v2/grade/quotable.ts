/**
 * Quotable (max 20): the mean pass rate of the counted content checks over the graded pages.
 *
 *   rate(k) = pages passing k / pages k was decided on
 *   Quotable = 20 × mean of rate(k) over the counted checks decided on at least one page
 *
 * The counted checks are those CONTENT_CHECKS marks `scored`. A check that applies to no page drops
 * out. Pages a check could not be decided on because they were not read (served for JavaScript to fill
 * in) make Quotable a range: on each such page the check could pass or fail, so rate(k) lies between
 * passing/(decided + unread) and (passing + unread)/(decided + unread), and a check decided on no read
 * page lies anywhere from 0 to 1. Nothing decided and nothing unread is the range 0 to 20.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import { mean, ranged, scored, type Measure } from './numbers.js';
import { AI_WEIGHTS } from './weights.js';

export interface Tally {
  passing: number;
  decided: number;
  /** Graded pages the check could not be decided on because they were not read. */
  unread: number;
}

export interface QuotableInput {
  /** The counted checks' tallies. */
  checks: Readonly<Partial<Record<ContentCheck, Tally>>>;
}

const tallies = ({ checks }: QuotableInput) => Object.values(checks) as Tally[];

/** The mean pass rate, 0..1, when no counted check has an unread page and one was decided; else null. */
export function quotableRate(input: QuotableInput): number | null {
  const ts = tallies(input);
  const rates = ts.filter((t) => t.decided > 0).map((t) => t.passing / t.decided);
  return ts.some((t) => t.unread > 0) || rates.length === 0 ? null : mean(rates);
}

export function quotableScore(input: QuotableInput): Measure {
  const ts = tallies(input);
  if (!ts.some((t) => t.unread > 0)) {
    const rate = quotableRate(input);
    return rate === null ? ranged(0, AI_WEIGHTS.quotable) : scored(AI_WEIGHTS.quotable * rate);
  }
  const open = ts.filter((t) => t.decided + t.unread > 0);
  const of = (rates: number[]) => AI_WEIGHTS.quotable * mean(rates);
  return ranged(
    of(open.map((t) => t.passing / (t.decided + t.unread))),
    of(open.map((t) => (t.passing + t.unread) / (t.decided + t.unread))),
  );
}
