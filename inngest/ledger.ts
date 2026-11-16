/**
 * The research ledger's two functions (CC-41 D4). The work is injected
 * (apps/web/lib/v2/ledger/functions.ts): this package does not import the app.
 *
 * `crawlmouse.ledger.write` runs on `check.finished`, which the check function sends after the check
 * is persisted, so it is a run of its own and nothing it does reaches the check. It does not retry:
 * a write that throws is reported by the work and retried once by the backfill.
 *
 * `crawlmouse.ledger.backfill` runs every six hours and writes the checks whose draft was stored in
 * the six hours that ended one hour before its slot (apps/web/lib/v2/ledger/write.ts,
 * `backfillSlot`): the slots' windows meet edge to edge, and a run that starts late reads its own
 * slot's window. The cron is BACKFILL_MINUTE past every BACKFILL_EVERY_HOURS hours (write.test.ts
 * holds them equal).
 */
import { inngest } from './client';
import { sized } from './check';

export const LEDGER_WRITE_FN_ID = 'crawlmouse.ledger.write';
export const LEDGER_BACKFILL_FN_ID = 'crawlmouse.ledger.backfill';

export interface LedgerWork {
  /** Writes one check's ledger rows; resolves with what it did, never throws. */
  write(checkId: string): Promise<string>;
  /** The six-hourly backfill; resolves with counts, never throws for one check's failure. */
  backfill(now: Date): Promise<Record<string, unknown>>;
}

export function createLedgerWriteFn(work: () => LedgerWork) {
  return inngest.createFunction(
    {
      id: LEDGER_WRITE_FN_ID,
      // One run per check for 24 hours, whatever sends the event again (Inngest's idempotency key).
      idempotency: 'event.data.checkId',
      retries: 0,
      concurrency: { limit: 5 },
    },
    { event: 'check.finished' },
    async ({ event, step }) =>
      step.run('write', async () => ({ outcome: await work().write(event.data.checkId) })),
  );
}

export function createLedgerBackfillFn(work: () => LedgerWork) {
  return inngest.createFunction(
    { id: LEDGER_BACKFILL_FN_ID, concurrency: { limit: 1 }, retries: 0 },
    // Every six hours (BACKFILL_EVERY_HOURS), off the hour and away from the other sweeps.
    { cron: '41 */6 * * *' },
    async ({ step }) =>
      step.run('backfill', async () => sized('backfill', await work().backfill(new Date()))),
  );
}
