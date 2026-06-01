import { FREE_PAGE_CAP, PRO_PAGE_CAP, FREE_CONCURRENCY, PRO_CONCURRENCY } from './limits';

/** Cost control #5: free crawls are capped + sequential; Pro is bigger + concurrent. */
export function tierLimits(isPro: boolean): { pageCap: number; perHostConcurrency: number } {
  return isPro
    ? { pageCap: PRO_PAGE_CAP, perHostConcurrency: PRO_CONCURRENCY }
    : { pageCap: FREE_PAGE_CAP, perHostConcurrency: FREE_CONCURRENCY };
}
