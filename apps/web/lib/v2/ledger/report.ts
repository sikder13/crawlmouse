/**
 * The ledger's two Sentry signals (CC-41 D4). `ledger-write-failed`: a draft or a write that threw.
 * The check is named by its `check_ref` (a hash; its id is the capability to read it), and the error's
 * message is not sent, since a database error can quote a value. `ledger-key-missing`:
 * RESEARCH_SITE_KEY is unset or unusable, reported once per process. Each is flushed before it
 * resolves, since the function's process may not outlive it, except a failed draft, which the check's
 * build step reports: that one is queued and not waited for, so the check is not held up by it.
 */
import * as Sentry from '@sentry/nextjs';
import { checkRef } from '../pipeline/public';

const FLUSH_MS = 2000;
let keyMissingReported = false;

export type LedgerStage = 'draft' | 'write' | 'backfill';

export async function reportLedgerFailure(stage: LedgerStage, checkId: string): Promise<void> {
  queueLedgerFailure(stage, checkId);
  await Sentry.flush(FLUSH_MS);
}

/** The signal, queued on Sentry's client and not flushed. */
export function queueLedgerFailure(stage: LedgerStage, checkId: string): void {
  Sentry.captureMessage('ledger-write-failed', {
    level: 'error',
    tags: { signal: 'ledger-write-failed', stage },
    extra: { check_ref: checkRef(checkId) },
  });
  console.error(JSON.stringify({ event: 'ledger.write_failed', stage }));
}

export async function reportLedgerKeyMissing(): Promise<void> {
  if (keyMissingReported) return;
  keyMissingReported = true;
  Sentry.captureMessage('ledger-key-missing', {
    level: 'warning',
    tags: { signal: 'ledger-key-missing' },
  });
  console.warn(JSON.stringify({ event: 'ledger.key_missing' }));
  await Sentry.flush(FLUSH_MS);
}

/** For a test: forget that the missing key was reported. */
export function resetLedgerReportsForTest(): void {
  keyMissingReported = false;
}
