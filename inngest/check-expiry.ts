/**
 * `crawlmouse.check.expiry` (CC-22b D8): once a day, deletes the audits nobody kept once they have
 * expired, with their evidence objects, then moves what kept audits still hold under `anon/`.
 *
 * The work is injected (apps/web/lib/v2/pipeline/expire.ts): this package does not import the app.
 * Each job is one step and returns counts, which stay small whatever the number of rows. Both are
 * safe to run again: a retried step lists what is still there.
 */
import { inngest } from './client';
import { sized } from './check';

export const CHECK_EXPIRY_FN_ID = 'crawlmouse.check.expiry';

/** Counts of one run of the expire step. */
export interface ExpiredCounts {
  sites: number;
  checks: number;
  skipped: number;
  left: number;
}

/** Counts of one run of the settle step. */
export interface SettledCounts {
  moved: number;
  nothing: number;
  failed: number;
  left: number;
}

export interface ExpiryWork {
  expireUnkept(): Promise<ExpiredCounts>;
  settleKept(): Promise<SettledCounts>;
}

export function createExpireAnonymousChecksFn(work: ExpiryWork) {
  return inngest.createFunction(
    { id: CHECK_EXPIRY_FN_ID, concurrency: { limit: 1 } },
    // Away from v1's cleanup (04:00) and the billing reconcile (03:00), and off the hour.
    { cron: '17 5 * * *' },
    async ({ step }) => {
      const expired = await step.run('expire-unkept', async () =>
        sized('expire-unkept', await work.expireUnkept()),
      );
      const settled = await step.run('settle-kept', async () =>
        sized('settle-kept', await work.settleKept()),
      );
      return { expired, settled };
    },
  );
}
