/**
 * `crawlmouse.alert.dispatch` (CC-28 D5): on `check.finished`, the check's alerts. One step plans
 * (whether the check can alert, and on which channels), then one step per channel sends and records
 * it. A step returns a small answer only; each channel step reads the check again, so no change list
 * crosses a step boundary.
 *
 * The work is injected (apps/web/lib/v2/monitor/alerts.ts): this package does not import the app. A
 * send worth retrying throws, so its step is retried. The email step sends to every seat before it
 * throws, so each run moves every seat one ledger attempt on (`sendEach`), and the send ledger and
 * the Slack ledger make a retry skip what already went. A channel step that fails every retry is
 * caught here, so the other channel's step still runs; the run then ends failed, without a retry
 * (`NonRetriableError`), naming the channels that failed.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import { sized } from './check';
import type { CheckFinished } from './check-events';
import { planSafeLimit } from './concurrency';

export const ALERT_FN_ID = 'crawlmouse.alert.dispatch';
/**
 * Five runs of a channel step: a seat's three ledger attempts, the run whose claim answers
 * `exhausted` and records the channel failed, and one for a claim left busy by a dead worker. Every
 * seat advances one attempt per run, so the count does not depend on the number of seats
 * (apps/web/lib/v2/monitor/alerts.test.ts, "gives every seat its three attempts…").
 */
export const ALERT_RETRIES = 4;

type Env = Readonly<Record<string, string | undefined>>;

export type AlertChannel = 'email' | 'slack';

export type AlertPlanAnswer = { skip: string } | { fired: number; channels: AlertChannel[] };
export type AlertChannelAnswer = { status: string; reason?: string | null };

export interface AlertWork {
  plan(checkId: string): Promise<AlertPlanAnswer>;
  deliver(checkId: string, channel: AlertChannel): Promise<AlertChannelAnswer>;
}

export function createAlertFn(work: AlertWork, env: Env = process.env) {
  return inngest.createFunction(
    {
      id: ALERT_FN_ID,
      retries: ALERT_RETRIES,
      concurrency: { limit: planSafeLimit(env.INNGEST_ALERT_CONCURRENCY, 1) },
    },
    { event: 'check.finished' },
    async ({ event, step }) => {
      const { checkId } = event.data as CheckFinished;
      const plan = await step.run('plan', async () => sized('plan', await work.plan(checkId)));
      if ('skip' in plan) return plan;
      const sent: Partial<Record<AlertChannel, AlertChannelAnswer>> = {};
      const failed: AlertChannel[] = [];
      for (const channel of plan.channels) {
        try {
          sent[channel] = await step.run(channel, async () =>
            sized(channel, await work.deliver(checkId, channel)),
          );
        } catch {
          // The step failed its last retry. Its error stays in that step's history; the run's
          // own error names the channel only.
          failed.push(channel);
        }
      }
      if (failed.length > 0) {
        throw new NonRetriableError(`alert channels failed: ${failed.join(', ')}`);
      }
      return { fired: plan.fired, sent };
    },
  );
}
