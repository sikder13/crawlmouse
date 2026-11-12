/**
 * `crawlmouse.alert.dispatch` (CC-28 D5): on `check.finished`, the check's alerts. One step plans
 * (whether the check can alert, and on which channels), then one step per channel sends and records
 * it. A step returns a small answer only; each channel step reads the check again, so no change list
 * crosses a step boundary.
 *
 * The work is injected (apps/web/lib/v2/monitor/alerts.ts): this package does not import the app. A
 * send worth retrying throws, so its step is retried: the send ledger and the Slack ledger make a
 * retry skip what already went, and allow three attempts, which the step's retries cover.
 */
import { inngest } from './client';
import { sized } from './check';
import type { CheckFinished } from './check-events';
import { planSafeLimit } from './concurrency';

export const ALERT_FN_ID = 'crawlmouse.alert.dispatch';
/** Enough attempts for the ledgers' three, and one for a claim left busy by a dead worker. */
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
      for (const channel of plan.channels) {
        sent[channel] = await step.run(channel, async () =>
          sized(channel, await work.deliver(checkId, channel)),
        );
      }
      return { fired: plan.fired, sent };
    },
  );
}
