/**
 * Access (max 40): of the pages each scored crawler was tested on, the share it was served, averaged
 * over the scored crawlers that were measured.
 *
 *   share(c) = Σ ACCESS_CELL_WEIGHT[verdict] / (pages whose verdict has a weight)
 *   Access   = 40 × mean of share(c) over the measured scored crawlers
 *
 * A crawler is measured with MIN_ACCESS_PAGES pages or more in its denominator. One that robots.txt
 * disallows on every page whose rules were read is blocked by choice and left out of the mean: the
 * block is not scored as a block, so Access moves to the mean of the others, up when the crawler's
 * share was below it and down when above, while enough crawlers stay measured. With fewer than
 * MIN_MEASURED_CRAWLERS measured:
 *   - when every scored crawler that is not measured is blocked by choice, none with a page refused
 *     as unverified, Access is scored from the measured ones, and `scored_from` records how many
 *     (owner ruling, 2026-11-05); the measured crawlers' own pages follow the ordinary rules;
 *   - when every scored crawler is blocked by choice, Access has no score: `blocked_by_choice`;
 *   - otherwise it has no score: `too_few_crawlers_measured`, with the range the score could take
 *     when each unmeasured crawler is anything from 0 to 1.
 * So disallowing a crawler whose share is below the others' mean raises Access, as unblocking it
 * would, when the others' mean is 1. A disallow is the site's stated intent (R11 decision 5), and no
 * fix recommends it.
 *
 * Words served are compared with the browser control's words for the same static page (the worker's
 * `allowed_thin`, packages/worker/src/verdict/table.ts), so a page that needs JavaScript reads the same
 * for both and is counted once, in Readable.
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
  /** How many crawlers Access was scored from, when fewer than MIN_MEASURED_CRAWLERS; else null. */
  scored_from: number | null;
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
  const ours = crawlers.filter((c) => c.scored);
  const shares = ours.map(crawlerShare);
  const measured = shares.flatMap((s) => (s.share === null ? [] : [s.share]));
  const unmeasured = shares.filter((s) => s.standing === 'unmeasured').length;
  // the crawlers that are not measured must each be blocked by choice, none with a page refused as
  // unverified; the measured ones' own pages follow the ordinary rules (owner ruling, 2026-11-05)
  const unverified = ours.some(
    (c, i) => shares[i]!.standing !== 'measured' && (c.counts.refused_unverified ?? 0) > 0,
  );
  if (measured.length >= MIN_MEASURED_CRAWLERS) {
    return { ...scored(AI_WEIGHTS.access * mean(measured)), reason: null, scored_from: null };
  }
  if (measured.length > 0 && unmeasured === 0 && !unverified) {
    return {
      ...scored(AI_WEIGHTS.access * mean(measured)),
      reason: null,
      scored_from: measured.length,
    };
  }
  if (measured.length === 0 && unmeasured === 0 && shares.length > 0) {
    return { ...ranged(0, AI_WEIGHTS.access), reason: 'blocked_by_choice', scored_from: null };
  }
  const known = measured.reduce((a, b) => a + b, 0);
  const n = measured.length + unmeasured;
  const range =
    n === 0
      ? ranged(0, AI_WEIGHTS.access)
      : ranged((AI_WEIGHTS.access * known) / n, (AI_WEIGHTS.access * (known + unmeasured)) / n);
  return { ...range, reason: 'too_few_crawlers_measured', scored_from: null };
}
