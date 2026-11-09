/**
 * `crawlmouse.check.reaper` (CC-20b D13): every ten minutes, fails the checks that stopped moving and
 * sends check.failed for each. `reap` does the work in one statement (`reap_stalled_checks`, which also
 * releases their posted batches) and reads its own clock.
 *
 * The events are sent inside the `reap` step, and the step returns counts: a list of the reaped
 * checks would grow with the number reaped, past the step output bound (correctness 9). Each event
 * carries its check's id (`check-failed:{checkId}`), so a send repeated by a retried step starts
 * nothing twice. What this does not cover: a send that fails after `reap_stalled_checks` committed,
 * once the client's own retries are spent, loses those events, because the step's retry reaps
 * nothing new.
 */
import { inngest } from './client';
import { sized } from './check';
import { checkFailedEventId, type CheckFailed, type FailureReason } from './check-events';

export const CHECK_REAPER_FN_ID = 'crawlmouse.check.reaper';

/** A check the reaper failed: `stalled` when a run had claimed it, `not_started` when none had. */
export type ReapedCheck = {
  checkId: string;
  siteId: string;
  reason: Extract<FailureReason, 'stalled' | 'not_started'>;
};

/** The `reap` step's output: how many checks it failed, by reason. */
export type ReapOutput = Record<ReapedCheck['reason'], number>;

export type ReapedEvent = { id: string; name: 'check.failed'; data: CheckFailed };

export function createCheckReaperFn(
  reap: () => Promise<ReapedCheck[]>,
  send: (events: ReapedEvent[]) => Promise<unknown> = (events) => inngest.send(events),
) {
  return inngest.createFunction(
    { id: CHECK_REAPER_FN_ID, concurrency: { limit: 1 } },
    { cron: '*/10 * * * *' },
    async ({ step }) =>
      step.run('reap', async (): Promise<ReapOutput> => {
        const reaped = await reap();
        if (reaped.length > 0) {
          await send(
            reaped.map((r) => ({
              id: checkFailedEventId(r.checkId),
              name: 'check.failed' as const,
              data: { checkId: r.checkId, siteId: r.siteId, reason: r.reason },
            })),
          );
        }
        const count = (reason: ReapedCheck['reason']) =>
          reaped.filter((r) => r.reason === reason).length;
        return sized('reap', { stalled: count('stalled'), not_started: count('not_started') });
      }),
  );
}
