import type { CrawlHealth, Confidence } from '@crawlmouse/types';
import {
  BLOCK_RATE_LOW_CONFIDENCE,
  BLOCK_RATE_MEDIUM_CONFIDENCE,
  COVERAGE_LOW_CONFIDENCE,
  COVERAGE_MEDIUM_CONFIDENCE,
} from './constants.js';

export type FetchOutcome = 'ok' | 'blocked' | 'dead';

/**
 * §1 fetch-outcome taxonomy from an HTTP status. `ok` = 200 (the gradeable nodes). `blocked` =
 * throttled/blocked/timeout/reset (403/429/503, and 0, which is how the crawler records a 5xx /
 * network / timeout / connection-reset failure). Everything else (404/410/500/502…) is `dead`.
 * Redirects never reach here — the crawler follows them and records the final 200.
 */
export function classifyFetchOutcome(statusCode: number): FetchOutcome {
  if (statusCode === 200) return 'ok';
  if (statusCode === 0 || statusCode === 403 || statusCode === 429 || statusCode === 503) return 'blocked';
  return 'dead';
}

/**
 * §6 confidence from block-rate + coverage. Strict comparisons, so a value sitting exactly on a
 * threshold lands in the better bucket (e.g. block_rate 0.05 / coverage 0.9 is still `high`).
 */
export function classifyConfidence(blockRate: number, coveragePct: number): Confidence {
  if (blockRate > BLOCK_RATE_LOW_CONFIDENCE || coveragePct < COVERAGE_LOW_CONFIDENCE) return 'low';
  if (blockRate > BLOCK_RATE_MEDIUM_CONFIDENCE || coveragePct < COVERAGE_MEDIUM_CONFIDENCE) return 'medium';
  return 'high';
}

/**
 * §6 per-audit crawl-health. `discovered` is the count of unique internal URLs the crawl saw
 * (fetched ∪ link targets), computed by the caller from the crawl output — so a page-cap-truncated
 * site reports coverage < 1 and `partial = true` without any change to the crawler. `discovered`
 * is floored at `fetchedOk` (it can never be fewer URLs than we actually fetched OK).
 */
export function computeCrawlHealth(pages: { statusCode: number }[], discovered: number): CrawlHealth {
  const attempted = pages.length;
  let fetchedOk = 0;
  let blocked = 0;
  let dead = 0;
  for (const p of pages) {
    const outcome = classifyFetchOutcome(p.statusCode);
    if (outcome === 'ok') fetchedOk += 1;
    else if (outcome === 'blocked') blocked += 1;
    else dead += 1;
  }
  const discoveredSafe = Math.max(discovered, fetchedOk);
  const coveragePct = discoveredSafe > 0 ? fetchedOk / discoveredSafe : 0;
  const blockRate = attempted > 0 ? blocked / attempted : 0;
  return {
    discovered: discoveredSafe,
    fetchedOk,
    blocked,
    dead,
    attempted,
    coveragePct,
    blockRate,
    partial: discovered > attempted,
    confidence: classifyConfidence(blockRate, coveragePct),
  };
}
