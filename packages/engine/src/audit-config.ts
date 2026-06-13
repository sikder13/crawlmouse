/**
 * The homepage fetch is the FIRST network call in an audit (`audit.ts`) and gates the entire run:
 * it must complete before Crawlee starts. The generic `safeFetch` default (10s) is sized for a
 * single crawl page, but the homepage — often the heaviest page, and sometimes behind slow TLS or
 * a cold origin — needs more headroom, or a momentarily-slow homepage fails the WHOLE audit as a
 * timeout (the Issue-2 production failure). Give it 15s by default, env-tunable via
 * `HOMEPAGE_FETCH_TIMEOUT_MS` so ops can widen it without a deploy. The per-page Crawlee timeout
 * stays tighter (10s) so one slow deep page can't blow the overall crawl budget.
 */
export const DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Anti-footgun clamp bounds for the env override. A non-positive / non-numeric value falls back to
 * the default; a positive value is clamped into [MIN, MAX] so a fat-finger can't make every audit
 * time out near-instantly (too small) or let one hung homepage consume the whole function budget
 * (too large). The DEFAULT, not these bounds, is the operative value in normal operation. Both the
 * 15s default and this 60s ceiling sit well under the SSE/worker function budget (maxDuration=300s),
 * so the homepage fetch alone can never exhaust it.
 */
export const MIN_HOMEPAGE_FETCH_TIMEOUT_MS = 1_000;
export const MAX_HOMEPAGE_FETCH_TIMEOUT_MS = 60_000;

/**
 * Resolve the homepage fetch budget (ms) from the environment with a plan-safe default, mirroring
 * the env-as-config pattern used for `auditConcurrencyLimit`. Read at runtime (not build), so the
 * operator can tune it via a Vercel runtime env var without a code change. A missing / empty /
 * zero / negative / non-numeric value yields the default; a valid positive value is clamped.
 */
export function homepageFetchTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.HOMEPAGE_FETCH_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HOMEPAGE_FETCH_TIMEOUT_MS;
  return Math.min(Math.max(n, MIN_HOMEPAGE_FETCH_TIMEOUT_MS), MAX_HOMEPAGE_FETCH_TIMEOUT_MS);
}
