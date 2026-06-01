/** Cost control #5: free crawls are capped + sequential; Pro is bigger + concurrent. */
export function tierLimits(isPro: boolean): { pageCap: number; perHostConcurrency: number } {
  return isPro ? { pageCap: 2000, perHostConcurrency: 8 } : { pageCap: 500, perHostConcurrency: 1 };
}
