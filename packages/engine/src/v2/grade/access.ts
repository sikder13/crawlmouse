/**
 * Access (max 40): of the pages each scored crawler was tested on, the share it was served, averaged
 * over the scored crawlers that were measured.
 *
 *   share(c) = Σ ACCESS_CELL_WEIGHT[verdict] / (pages whose verdict has a weight)
 *   Access   = 40 × mean of share(c) over the measured scored crawlers
 *
 * A crawler is measured with MIN_ACCESS_PAGES pages or more in its denominator. One that robots.txt
 * disallows on every page whose rules were read is blocked by choice and left out, so a deliberate
 * block never lowers the score. With fewer than MIN_MEASURED_CRAWLERS measured, Access has no score:
 * every scored crawler blocked by choice is `blocked_by_choice`; otherwise `too_few_crawlers_measured`,
 * with the range the score could take when each unmeasured crawler is anything from 0 to 1.
 *
 * Words served are compared with our control's words for the same static page (the worker's
 * `allowed_thin`), so a page that needs JavaScript reads the same for both and is counted once, in
 * Readable.
 */
import type { WithheldReason } from '@crawlmouse/types/v2';
import type { CrawlerAccess } from '../access/types.js';
import { mean, ranged, scored, type Measure } from './numbers.js';
import {
  ACCESS_CELL_WEIGHT,
  AI_WEIGHTS,
  MIN_ACCESS_PAGES,
  MIN_MEASURED_CRAWLERS,
} from './weights.js';

/** What Access reads of a crawler's row of the matrix. */
export type CrawlerTally = Pick<CrawlerAccess, 'ua' | 'scored' | 'counts' | 'extent'>;

export type Standing = 'measured' | 'blocked_by_choice' | 'unmeasured';

export interface CrawlerShare {
  ua: string;
  standing: Standing;
  /** Pages in the denominator. */
  pages: number;
  /** The share served; null unless measured. */
  share: number | null;
}

export type AccessMeasure = Measure & {
  reason: Extract<WithheldReason, 'too_few_crawlers_measured' | 'blocked_by_choice'> | null;
};

export function crawlerShare(c: CrawlerTally): CrawlerShare {
  let pages = 0;
  let points = 0;
  for (const [verdict, weight] of Object.entries(ACCESS_CELL_WEIGHT)) {
    const n = c.counts[verdict as keyof typeof c.counts] ?? 0;
    pages += n;
    points += n * weight;
  }
  const { disallowed, read } = c.extent.robots;
  if (read > 0 && disallowed === read)
    return { ua: c.ua, standing: 'blocked_by_choice', pages, share: null };
  if (pages < MIN_ACCESS_PAGES) return { ua: c.ua, standing: 'unmeasured', pages, share: null };
  return { ua: c.ua, standing: 'measured', pages, share: points / pages };
}

export function accessScore(crawlers: readonly CrawlerTally[]): AccessMeasure {
  const shares = crawlers.filter((c) => c.scored).map(crawlerShare);
  const measured = shares.flatMap((s) => (s.share === null ? [] : [s.share]));
  const unmeasured = shares.filter((s) => s.standing === 'unmeasured').length;
  if (measured.length >= MIN_MEASURED_CRAWLERS) {
    return { ...scored(AI_WEIGHTS.access * mean(measured)), reason: null };
  }
  if (measured.length === 0 && unmeasured === 0 && shares.length > 0) {
    return { ...ranged(0, AI_WEIGHTS.access), reason: 'blocked_by_choice' };
  }
  const known = measured.reduce((a, b) => a + b, 0);
  const n = measured.length + unmeasured;
  const range =
    n === 0
      ? ranged(0, AI_WEIGHTS.access)
      : ranged((AI_WEIGHTS.access * known) / n, (AI_WEIGHTS.access * (known + unmeasured)) / n);
  return { ...range, reason: 'too_few_crawlers_measured' };
}
