import type { Tier } from '@crawlmouse/types';
import { FREE_PAGE_CAP, PRO_PAGE_CAP, FREE_CONCURRENCY, PRO_CONCURRENCY } from './limits';

export interface TierCrawlLimits { pageCap: number; perHostConcurrency: number }

/** Cost control #5: free crawls are capped + sequential; Pro is bigger + concurrent. */
export function tierLimits(isPro: boolean): TierCrawlLimits {
  return isPro
    ? { pageCap: PRO_PAGE_CAP, perHostConcurrency: PRO_CONCURRENCY }
    : { pageCap: FREE_PAGE_CAP, perHostConcurrency: FREE_CONCURRENCY };
}

/**
 * Tier-keyed crawl limits — the agency seam (parallels the entitlement seam in lib/entitlement.ts).
 * `agency` mirrors `pro` for crawl limits in this phase; TODO: dedicated agency limits when that tier
 * ships. No code path produces 'agency' yet, so this is dormant but keeps the surface ready for v1.2+.
 */
export function tierLimitsFor(tier: Tier): TierCrawlLimits {
  return tierLimits(tier !== 'free');
}
