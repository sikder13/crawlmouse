/**
 * The founder's notices (CC-33 D3), as three functions over injected work
 * (apps/web/lib/v2/ops/founder.ts; wired in apps/web/lib/v2/ops/functions.ts):
 *
 * - `crawlmouse.founder.entitlement`, on `entitlement.changed`: the event's id, as billing set it
 *   (`entitlement.changed:<account>:<source>`), is the notice's key, so an event delivered twice
 *   claims one notice.
 * - `crawlmouse.founder.sweep`, every five minutes: sign-ups, agency accounts and cancellations,
 *   which send no event.
 * - `crawlmouse.founder.digest`, hourly at :07: the daily and weekly digests when due, and the
 *   "N more" notice.
 *
 * Each is one step, retried as a whole. The notices and mails in it are keyed by their event, so a
 * retry claims the same rows and the mail ledger answers `done` for a mail already sent.
 * This package imports nothing from the app.
 */
import type { AccountState } from '@crawlmouse/types/v2';
import { inngest } from './client';
import { sized } from './check';

export const FOUNDER_ENTITLEMENT_FN_ID = 'crawlmouse.founder.entitlement';
export const FOUNDER_SWEEP_FN_ID = 'crawlmouse.founder.sweep';
export const FOUNDER_DIGEST_FN_ID = 'crawlmouse.founder.digest';
/**
 * Five runs of a step, as the summary's: a mail's three ledger attempts, the run whose claim answers
 * `exhausted`, and one for a claim left busy.
 */
export const FOUNDER_RETRIES = 4;

export interface FounderEntitlementEvent {
  id: string | undefined;
  accountId: string;
  from: AccountState;
  to: AccountState;
  occurredAt: string;
}

export interface FounderWork {
  entitlement(event: FounderEntitlementEvent): Promise<unknown>;
  sweep(): Promise<unknown>;
  digest(): Promise<unknown>;
}

export function createFounderEntitlementFn(work: () => FounderWork) {
  return inngest.createFunction(
    { id: FOUNDER_ENTITLEMENT_FN_ID, retries: FOUNDER_RETRIES, concurrency: { limit: 1 } },
    { event: 'entitlement.changed' },
    async ({ event, step }) =>
      step.run('notify', async () =>
        sized(
          'notify',
          await work().entitlement({
            id: event.id,
            accountId: event.data.accountId,
            from: event.data.from,
            to: event.data.to,
            occurredAt: new Date(event.ts ?? Date.now()).toISOString(),
          }),
        ),
      ),
  );
}

export function createFounderSweepFn(work: () => FounderWork) {
  return inngest.createFunction(
    { id: FOUNDER_SWEEP_FN_ID, retries: FOUNDER_RETRIES, concurrency: { limit: 1 } },
    { cron: '*/5 * * * *' },
    async ({ step }) => step.run('sweep', async () => sized('sweep', await work().sweep())),
  );
}

export function createFounderDigestFn(work: () => FounderWork) {
  return inngest.createFunction(
    { id: FOUNDER_DIGEST_FN_ID, retries: FOUNDER_RETRIES, concurrency: { limit: 1 } },
    { cron: '7 * * * *' },
    async ({ step }) => step.run('digest', async () => sized('digest', await work().digest())),
  );
}
