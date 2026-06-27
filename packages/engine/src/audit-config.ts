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

/**
 * Hard wall-clock budget (ms) for the WHOLE crawl. The crawler had no overall deadline: worst case
 * ~500 pages × 10s per-page ÷ 8 concurrency ≈ 625s, far past the 300s Vercel function ceiling
 * (maxDuration) — so a pathological site got KILLED mid-run by the runtime instead of failing
 * cleanly. Bound the crawl to 240s by default so it aborts and surfaces a clean, classified timeout
 * failure (Issue 2's classifier maps "...timed out..." to the `timeout` bucket) with room to spare
 * for the homepage fetch + persist + overhead before 300s. Env-tunable at runtime via
 * `CRAWL_WALL_CLOCK_MS`.
 */
export const DEFAULT_CRAWL_WALL_CLOCK_MS = 240_000;

/**
 * Clamp bounds for the crawl-budget env override. The MAX is held under the 300s function ceiling
 * WITH headroom because the crawl is not the only work in the worker invocation: the homepage fetch
 * (up to homepageFetchTimeoutMs, default 15s) and sitemap discovery run BEFORE it, and persistence
 * runs AFTER — all sharing the same 300s maxDuration. 260s leaves ~40s for that prelude + persist
 * under the DEFAULT homepage budget. NOTE these phases are ADDITIVE: an operator who raises
 * HOMEPAGE_FETCH_TIMEOUT_MS toward its 60s ceiling must lower CRAWL_WALL_CLOCK_MS to keep
 * (homepage + crawl + persist) under 300s — the clamp bounds each knob, not their sum.
 */
export const MIN_CRAWL_WALL_CLOCK_MS = 30_000;
export const MAX_CRAWL_WALL_CLOCK_MS = 260_000;

/** Resolve the crawl wall-clock budget from the environment, same env-as-config pattern as above. */
export function crawlWallClockMs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CRAWL_WALL_CLOCK_MS);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CRAWL_WALL_CLOCK_MS;
  return Math.min(Math.max(n, MIN_CRAWL_WALL_CLOCK_MS), MAX_CRAWL_WALL_CLOCK_MS);
}

/**
 * Engine v2 cutover flag (SPEC 01 v2 §8). v2 makes blocked/dead fetches CRAWL OUTCOMES
 * rather than gradeable nodes (killing the §0 false-orphan/unreachable bug), retires the
 * `unreachable_page` finding, and (in later tasks) adds crawl-health/confidence and
 * deterministic reachability. Default OFF so the live grade is unchanged until the
 * backtest gate (`scripts/backtest-engine.ts`) signs off and this default is flipped; an
 * env flip then reverts instantly with no redeploy. Read at runtime (env-as-config, same
 * pattern as the budgets above). Unit tests force the path via `InternalAuditFlags.engineV2`
 * rather than mutating the process env. Accepts the usual truthy spellings; anything else
 * (unset / '0' / 'false' / unknown) stays on v1.
 */
export function engineV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.ENGINE_V2 ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
