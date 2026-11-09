/**
 * trialLifecycleFn, `crawlmouse.trial.lifecycle` (CC-03 D9a): the no-card Pro trial runs on our
 * clock. Started by `trial.started`, it sleeps until three days before the trial ends and applies
 * `trial_reminder_due`, then sleeps until the end and applies `trial_expired`. Each apply reads the
 * account afresh and the entitlement machine decides, so a trial that converted or already ended is
 * recorded as ignored. A paid checkout from the trial sends `trial.converted`, which cancels the run.
 *
 * What each step does is injected (`TrialClock`, built in apps/web/lib/billing/clock.ts), so this
 * package imports nothing from the app. Applying and sending are separate steps: Inngest records a
 * step's output once it returns, so a failed send is retried with the recorded plan, and the event is
 * not applied a second time.
 *
 * Replays. Inngest runs the handler again from the top for each new step. The times the handler
 * uses come from the event; the one reading of the clock (is the reminder too late?) is made inside
 * the `remind` step, whose output is recorded.
 */
import { NonRetriableError } from 'inngest';
import { inngest } from './client';

export const TRIAL_LIFECYCLE_FN_ID = 'crawlmouse.trial.lifecycle';

/** The reminder is due this long before the trial ends: three days. */
export const TRIAL_REMINDER_LEAD_MS = 3 * 86_400_000;

/**
 * What a step that applied one of our clock's events decided: the machine's outcome, its reason when
 * it ignored the event, and the plan of effects to send. The plan is the app's (`PlannedEffect[]`);
 * this package carries it from the deciding step to the sending step without reading it.
 */
export interface ClockDecision {
  outcome: 'applied' | 'ignored';
  reason: string | null;
  planned: unknown[];
}

export interface TrialClock {
  /** The time now, in ms since the epoch. */
  now(): number;
  /** Applies `trial_reminder_due` at `at` to the account as it is read now. */
  remind(accountId: string, at: Date): Promise<ClockDecision>;
  /** Applies `trial_expired` at `at` to the account as it is read now. */
  expire(accountId: string, at: Date): Promise<ClockDecision>;
  /** Sends a plan that a deciding step recorded. Throws when the send fails. */
  dispatch(planned: unknown[]): Promise<void>;
}

/** The `remind` step's output when it woke at or after the trial's end: nothing applied, nothing sent. */
export interface SkippedReminder {
  outcome: 'skipped';
  reason: string;
}

const REMINDER_TOO_LATE: SkippedReminder = { outcome: 'skipped', reason: 'the trial has ended' };

export function createTrialLifecycleFn(clock: () => TrialClock) {
  return inngest.createFunction(
    {
      id: TRIAL_LIFECYCLE_FN_ID,
      idempotency: 'event.data.accountId',
      cancelOn: [{ event: 'trial.converted', match: 'data.accountId' }],
      concurrency: { limit: 2 },
    },
    { event: 'trial.started' },
    async ({ event, step }) => {
      const { accountId } = event.data;
      const end = Date.parse(event.data.trialEndsAt);
      if (!Number.isFinite(end)) {
        throw new NonRetriableError('trial.started carries no readable trialEndsAt');
      }
      const reminderAt = new Date(end - TRIAL_REMINDER_LEAD_MS);
      const endsAt = new Date(end);

      await step.sleepUntil('reminder-due', reminderAt);
      // A trial.started that arrived late wakes here at or after the end: no "three days left" then.
      const remind = await step.run(
        'remind',
        async (): Promise<ClockDecision | SkippedReminder> => {
          const c = clock();
          return c.now() >= end ? REMINDER_TOO_LATE : c.remind(accountId, reminderAt);
        },
      );
      if (remind.outcome !== 'skipped') {
        await step.run('remind-effects', () => clock().dispatch(remind.planned));
      }

      await step.sleepUntil('trial-ends', endsAt);
      const expire = await step.run('expire', () => clock().expire(accountId, endsAt));
      await step.run('expire-effects', () => clock().dispatch(expire.planned));

      return { remind: remind.outcome, expire: expire.outcome };
    },
  );
}
