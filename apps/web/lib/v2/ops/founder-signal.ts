/**
 * The founder functions' own failure (D3; inngest/founder.ts): a run that failed past its retries is
 * Sentry's `signal: founder-notice-failed`, tagged with the function's id, with Inngest's run id as an
 * extra. The run's error is not handed here, so nothing it carried reaches Sentry.
 */
import * as Sentry from '@sentry/nextjs';
import type { FounderFailure } from '../../../../../inngest/founder';

const FLUSH_MS = 2000;

/**
 * The signal; flushed before the handler ends, since the function's process may not outlive it. With
 * no client, or a client with no DSN (`Sentry.init` without SENTRY_DSN builds one that sends nothing),
 * it is logged instead.
 */
export async function reportFounderFailure({ fnId, runId }: FounderFailure): Promise<void> {
  Sentry.captureMessage('founder-notice-failed', {
    level: 'error',
    tags: { signal: 'founder-notice-failed', function: fnId },
    extra: { runId },
  });
  if (!Sentry.getClient()?.getDsn()) {
    console.error(
      JSON.stringify({ event: 'ops.founder_failed', function: fnId, run: runId, sentry: 0 }),
    );
    return;
  }
  if (!(await Sentry.flush(FLUSH_MS)))
    throw new Error('the founder signal was not flushed in time');
}
