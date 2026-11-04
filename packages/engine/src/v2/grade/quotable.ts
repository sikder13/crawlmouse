/**
 * Quotable (max 20): the mean pass rate of the five content checks over the graded pages.
 *
 *   rate(k) = pages passing k / pages k was decided on
 *   Quotable = 20 × mean of rate(k) over the checks decided on at least one page
 *
 * A check that applies to no page drops out. Pages not read for content (served as an empty shell for
 * JavaScript to fill) make it a range: on each such page every check could pass or fail, so
 * rate(k) lies between passing/(decided + unread) and (passing + unread)/(decided + unread), and a
 * check decided on no read page lies anywhere from 0 to 1. Nothing decided and nothing unread is the
 * range 0 to 20.
 */
import type { ContentCheck } from '@crawlmouse/types/v2';
import { mean, ranged, scored, type Measure } from './numbers.js';
import { AI_WEIGHTS } from './weights.js';

export interface QuotableInput {
  /** Graded pages not read for content. */
  unread: number;
  checks: Readonly<Record<ContentCheck, { passing: number; decided: number }>>;
}

export function quotableScore({ unread, checks }: QuotableInput): Measure {
  const tallies = Object.values(checks);
  const of = (rates: number[]) => AI_WEIGHTS.quotable * mean(rates);
  if (unread === 0) {
    const rates = tallies.filter((t) => t.decided > 0).map((t) => t.passing / t.decided);
    return rates.length === 0 ? ranged(0, AI_WEIGHTS.quotable) : scored(of(rates));
  }
  const low = tallies.map((t) => t.passing / (t.decided + unread));
  const high = tallies.map((t) => (t.passing + unread) / (t.decided + unread));
  return ranged(of(low), of(high));
}
