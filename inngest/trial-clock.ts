/**
 * trialClockFn, `crawlmouse.trial.clock`: once an hour, sends the reminder of no-card trials that are
 * inside their last three days and ends those whose time is up. It reads the accounts' state rather
 * than waiting on `trial.started`, so a trial started while V2_BILLING was off, whose event was
 * dropped, is covered with no backfill. It runs with V2_CHECKS_PUBLIC, beside `trialLifecycleFn` when
 * billing is on: the mail's idempotency key and the entitlement machine make a second application
 * send and change nothing.
 *
 * Steps: `now` reads the time once; `due` lists at most TRIAL_CLOCK_LIMIT accounts at that time; then
 * per account `remind-<id>` or `expire-<id>` applies the event, on the account as it is read in that
 * step, and `remind-effects-<id>` or `expire-effects-<id>` sends the plan, a step of its own so a
 * failed send is retried with the recorded plan.
 *
 * An account whose step still fails after Inngest's retries does not hold up the others: its error is
 * caught, the rest are handled, and the run then ends failed, naming it. The next hour's run reads it
 * again if it is still due. A reminder read that fails beside due expiries ends the run failed too,
 * after the expiries are done.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import type { ClockDecision } from './trial-lifecycle';

export const TRIAL_CLOCK_FN_ID = 'crawlmouse.trial.clock';

/** The most accounts one run handles: two steps each, well inside Inngest's steps per run. */
export const TRIAL_CLOCK_LIMIT = 100;

export interface TrialClockDue {
  accountId: string;
  kind: 'remind' | 'expire';
}

export interface TrialClockList {
  due: TrialClockDue[];
  reminderReadFailed: boolean;
}

export interface TrialClockPorts {
  /** The time now, in ms since the epoch. */
  now(): number;
  /**
   * At most `limit` accounts due at `at`, those whose trial has ended first. `reminderReadFailed`:
   * ended trials were listed but the reminders could not be read.
   */
  due(at: Date, limit: number): Promise<TrialClockList>;
  /** Applies `trial_reminder_due` at `at` to the account as it is read now. */
  remind(accountId: string, at: Date): Promise<ClockDecision>;
  /** Applies `trial_expired` at `at` to the account as it is read now. */
  expire(accountId: string, at: Date): Promise<ClockDecision>;
  /** Sends a plan that a deciding step recorded. Throws when the send fails. */
  dispatch(planned: unknown[]): Promise<void>;
}

export function createTrialClockFn(clock: () => TrialClockPorts) {
  return inngest.createFunction(
    { id: TRIAL_CLOCK_FN_ID, concurrency: { limit: 1 } },
    // Off the hour, away from the past-due sweep (:00).
    { cron: '20 * * * *' },
    async ({ step }) => {
      const at = new Date(await step.run('now', async () => new Date(clock().now()).toISOString()));
      const { due, reminderReadFailed } = await step.run('due', () =>
        clock().due(at, TRIAL_CLOCK_LIMIT),
      );

      const decided = { applied: 0, ignored: 0 };
      const failed: string[] = [];
      for (const { accountId, kind } of due) {
        try {
          const decision = await step.run(`${kind}-${accountId}`, () =>
            kind === 'remind' ? clock().remind(accountId, at) : clock().expire(accountId, at),
          );
          await step.run(`${kind}-effects-${accountId}`, () => clock().dispatch(decision.planned));
          decided[decision.outcome] += 1;
        } catch {
          failed.push(accountId);
        }
      }
      if (failed.length > 0) {
        throw new NonRetriableError(
          `trial clock: ${failed.length} of ${due.length} accounts failed: ${failed.join(', ')}`,
        );
      }
      // After the expiries, so a read that keeps failing cannot hold them up or go unnoticed.
      if (reminderReadFailed) {
        throw new NonRetriableError('trial clock: the reminders could not be read this run');
      }
      return { handled: due.length, ...decided };
    },
  );
}
