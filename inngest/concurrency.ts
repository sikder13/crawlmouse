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

/**
 * The account's Inngest plan cap: Pro, 100 concurrent steps (Inngest dashboard, Billing, read
 * 2026-11-23; the owner upgraded on 21 Nov). A change of plan changes this, in the same change.
 */
export const PLAN_CONCURRENCY_CAP = 100;

/**
 * The batches a production worker machine runs at once: `BATCH_CONCURRENCY` in
 * `packages/worker/fly.production.toml`, which `concurrency.test.ts` reads.
 */
export const WORKER_BATCH_SLOTS = 16;

/**
 * checkFn's account-wide limit when INNGEST_CHECK_CONCURRENCY sets none. Inngest counts executing
 * steps, and a check sleeping between polls holds none, so this bounds the posts, polls, builds and
 * persists running at one moment, not the checks in flight or the worker's batches. Builds and
 * persists are the heavy ones; 16 lets as many checks build at once as one worker machine runs
 * batches. Their load on Vercel and Supabase at 16 is not measured yet.
 *
 * If the plan ever falls back to Hobby (a cap of 5), this default makes Inngest refuse the app sync.
 * Set INNGEST_CHECK_CONCURRENCY, and any other INNGEST_*_CONCURRENCY that is set, to 5 or less, then
 * redeploy: each variable can lower its function's limit.
 */
export const CHECK_CONCURRENCY_DEFAULT = WORKER_BATCH_SLOTS;

/**
 * v1's audit function when INNGEST_AUDIT_CONCURRENCY sets none: the 5 it ran at under Free. Each v1
 * audit crawls inside one step of a Vercel function, so it is not raised with the plan.
 */
export const AUDIT_CONCURRENCY_DEFAULT = 5;

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
