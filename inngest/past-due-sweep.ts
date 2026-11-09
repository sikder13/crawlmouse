/**
 * pastDueSweepFn, `crawlmouse.billing.past-due-sweep` (CC-03 D9c): every hour, applies
 * `past_due_lapsed` to past-due accounts whose grace may have run out, and `trial_expired` to no-card
 * trials whose end has passed (the backstop for a trial whose `trial.started` was never sent). The
 * list only narrows which accounts to look at; for each one the entitlement machine decides, on the
 * account as it is read in that account's step.
 *
 * Steps: `now` reads the time once; `candidates` lists at most SWEEP_LIMIT accounts at that time;
 * then per account `lapse-<id>` or `expire-<id>` applies the event and `lapse-effects-<id>` or
 * `expire-effects-<id>` sends its plan, a step of its own so a failed send is retried with the
 * recorded plan. What each step does is injected (`SweepClock`, built in
 * apps/web/lib/billing/clock.ts).
 *
 * An account whose step still fails after Inngest's retries does not hold up the accounts after it:
 * its error is caught, the others are swept, and the run then ends failed, naming it. The next hour's
 * run reads it again if it is still due.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';
import type { ClockDecision } from './trial-lifecycle';

export const PAST_DUE_SWEEP_FN_ID = 'crawlmouse.billing.past-due-sweep';

/** The most accounts one run looks at: two steps each, well inside Inngest's steps per run. */
export const SWEEP_LIMIT = 100;

export interface SweepCandidate {
  accountId: string;
  /** `lapse` applies `past_due_lapsed`; `expire` applies `trial_expired`. */
  kind: 'lapse' | 'expire';
}

export interface SweepClock {
  /** The time now, in ms since the epoch. */
  now(): number;
  /** At most `limit` accounts that may lapse or expire at `at`, longest overdue first. */
  candidates(at: Date, limit: number): Promise<SweepCandidate[]>;
  /** Applies `past_due_lapsed` at `at` to the account as it is read now. */
  lapse(accountId: string, at: Date): Promise<ClockDecision>;
  /** Applies `trial_expired` at `at` to the account as it is read now. */
  expire(accountId: string, at: Date): Promise<ClockDecision>;
  /** Sends a plan that a deciding step recorded. Throws when the send fails. */
  dispatch(planned: unknown[]): Promise<void>;
}

export function createPastDueSweepFn(clock: () => SweepClock) {
  return inngest.createFunction(
    { id: PAST_DUE_SWEEP_FN_ID, concurrency: { limit: 1 } },
    { cron: '0 * * * *' },
    async ({ step }) => {
      const at = new Date(await step.run('now', async () => new Date(clock().now()).toISOString()));
      const due = await step.run('candidates', () => clock().candidates(at, SWEEP_LIMIT));

      const decided = { applied: 0, ignored: 0 };
      const failed: string[] = [];
      for (const { accountId, kind } of due) {
        try {
          const decision = await step.run(`${kind}-${accountId}`, () =>
            kind === 'lapse' ? clock().lapse(accountId, at) : clock().expire(accountId, at),
          );
          await step.run(`${kind}-effects-${accountId}`, () => clock().dispatch(decision.planned));
          decided[decision.outcome] += 1;
        } catch {
          failed.push(accountId);
        }
      }
      if (failed.length > 0) {
        throw new NonRetriableError(
          `past-due sweep: ${failed.length} of ${due.length} accounts failed: ${failed.join(', ')}`,
        );
      }
      return { swept: due.length, ...decided };
    },
  );
}
