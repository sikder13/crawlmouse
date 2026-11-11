/**
 * How long a rate-limit window may be, and when a row is old enough to delete. Kept apart from
 * `rate-limit.ts` (which is server-only) so the retention tests can import the same numbers.
 *
 * `checkRateLimit` refuses a window longer than MAX_RATE_LIMIT_WINDOW_MS, and the database's
 * `public.prune_rate_limits` deletes only rows whose window started more than PRUNE_AFTER_MS ago
 * (its SQL states the same 25 hours). `__tests__/rate-limits-prune.test.ts` pins both against these
 * constants: `pnpm --filter @crawlmouse/web exec vitest run __tests__/rate-limits-prune.test.ts`.
 */
export const MAX_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The longest window plus one hour of margin. */
export const PRUNE_AFTER_MS = MAX_RATE_LIMIT_WINDOW_MS + 60 * 60 * 1000;

/**
 * The start of the window `nowMs` falls in: windows are aligned to multiples of their length since
 * the epoch, so every caller of one bucket counts into the same row. `checkRateLimit` uses it, and
 * so does the SQL that takes a `global:audits:day` slot itself (migration 20261112000001), which is
 * passed this value rather than computing its own.
 */
export function rateLimitWindowStart(nowMs: number, windowMs: number): Date {
  return new Date(Math.floor(nowMs / windowMs) * windowMs);
}
