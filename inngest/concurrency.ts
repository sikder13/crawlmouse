/**
 * The concurrency limits the Inngest functions declare, and the plan cap they are held to.
 *
 * Inngest refuses the whole app sync when a function declares a concurrency limit above the
 * account plan's cap, and then no function runs: v1 audits stop (PROJECT_OVERVIEW §11, the June
 * outage). A limit read from the environment therefore goes through `planSafeLimit`.
 * `apps/web/lib/v2/pipeline/functions.test.ts` reads the declared limits of the functions the serve
 * route registers, in both states of the pipeline flag and over a sweep of values, and fails above
 * the cap: `pnpm --filter @crawlmouse/web exec vitest run lib/v2/pipeline/functions.test.ts`.
 */

/** The account's Inngest plan cap (Free). Raising the plan raises this, in the same change. */
export const PLAN_CONCURRENCY_CAP = 5;

/** checkFn's account-wide limit when INNGEST_CHECK_CONCURRENCY sets none: the audits share the cap. */
export const CHECK_CONCURRENCY_DEFAULT = 2;

type Env = Readonly<Record<string, string | undefined>>;

/** `raw` as a whole number from 1 up, at most PLAN_CONCURRENCY_CAP; `fallback` when it is not one. */
export function planSafeLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, PLAN_CONCURRENCY_CAP);
}

/** checkFn's account-wide limit, from INNGEST_CHECK_CONCURRENCY. */
export function checkConcurrencyLimit(env: Env = process.env): number {
  return planSafeLimit(env.INNGEST_CHECK_CONCURRENCY, CHECK_CONCURRENCY_DEFAULT);
}
