/**
 * `crawlmouse.check.reaper` (CC-20b D13): every ten minutes, fails the checks that stopped moving and
 * sends check.failed for each. `reap` does the work in one statement (`reap_stalled_checks`, which also
 * releases their posted batches) and reads its own clock; this function only schedules it and sends
 * the events.
 */
import { inngest } from './client';
import type { FailureReason } from './check-events';

export const CHECK_REAPER_FN_ID = 'crawlmouse.check.reaper';

/** A check the reaper failed: `stalled` when a run had claimed it, `not_started` when none had. */
export type ReapedCheck = {
  checkId: string;
  siteId: string;
  reason: Extract<FailureReason, 'stalled' | 'not_started'>;
};

export function createCheckReaperFn(reap: () => Promise<ReapedCheck[]>) {
  return inngest.createFunction(
    { id: CHECK_REAPER_FN_ID, concurrency: { limit: 1 } },
    { cron: '*/10 * * * *' },
    async ({ step }) => {
      const reaped = await step.run('reap', () => reap());
      if (reaped.length > 0) {
        await step.sendEvent(
          'emit-failed',
          reaped.map((r) => ({
            name: 'check.failed' as const,
            data: { checkId: r.checkId, siteId: r.siteId, reason: r.reason },
          })),
        );
      }
      return { reaped: reaped.length };
    },
  );
}
