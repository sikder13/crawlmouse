import type { ConfidenceBand, CrawlHealth } from '@crawlmouse/types';
import { CONFIDENCE_BAND_HIGH, CONFIDENCE_BAND_MEDIUM, CONFIDENCE_BAND_LOW } from './constants.js';

export interface SiteTotalEstimate {
  estimatedTotal: number | null;
  method: 'sitemap' | 'frontier' | 'none';
}

/**
 * §2 honest site-size estimate for the "based on N of ~M pages" copy. Never inflates:
 *  - a sitemap STRICTLY larger than what we fetched OK → its URL count (`'sitemap'`);
 *  - else, if the crawl discovered more internal URLs than it fetched OK (page-cap / wall-clock
 *    truncation, or simply unfetched link targets) → `discovered`, a true lower bound (`'frontier'`);
 *  - else → `null` (`'none'`): the crawl looks complete, so the UI shows only "based on N pages".
 * `discovered` is already floored at `fetchedOk` in computeCrawlHealth, so a non-null estimate is
 * always strictly greater than the crawled count — it can never read as fewer pages than we graded.
 */
export function estimateSiteTotal(health: CrawlHealth, sitemapUrlCount: number | null): SiteTotalEstimate {
  if (sitemapUrlCount != null && sitemapUrlCount > health.fetchedOk) {
    return { estimatedTotal: sitemapUrlCount, method: 'sitemap' };
  }
  if (health.discovered > health.fetchedOk) {
    return { estimatedTotal: health.discovered, method: 'frontier' };
  }
  return { estimatedTotal: null, method: 'none' };
}

function bandWidth(confidence: CrawlHealth['confidence']): number {
  if (confidence === 'high') return CONFIDENCE_BAND_HIGH;
  if (confidence === 'medium') return CONFIDENCE_BAND_MEDIUM;
  return CONFIDENCE_BAND_LOW;
}

/**
 * §2 confidence band around the deterministic point estimate. The point estimate is the REAL
 * computed score (UNCAPPED for low confidence — determinism preserved, SPEC 01 R1); the band width
 * reflects crawl confidence, and `isEstimate` flips the UI from "verdict" to "estimate" whenever the
 * crawl was partial or anything below high confidence. Bounds are rounded to whole points and clamped
 * to [0, 100]. PURE + deterministic: identical inputs → identical band.
 */
export function computeConfidenceBand(
  score: number,
  grade: string,
  health: CrawlHealth,
  est: SiteTotalEstimate,
): ConfidenceBand {
  const w = bandWidth(health.confidence);
  return {
    pointEstimate: score,
    grade,
    lower: Math.max(0, Math.round(score - w)),
    upper: Math.min(100, Math.round(score + w)),
    confidence: health.confidence,
    basis: {
      crawled: health.fetchedOk,
      estimatedTotal: est.estimatedTotal,
      method: est.method,
    },
    isEstimate: health.partial || health.confidence !== 'high',
  };
}
