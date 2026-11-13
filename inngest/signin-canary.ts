/**
 * `crawlmouse.ops.signin-canary` (CC-33 D6): every ten minutes, asks Supabase Auth for a sign-in link
 * to one address, waits five minutes, and looks for Resend's delivery of it. No delivery, or a
 * request Supabase refused, is reported (Sentry `signal: signin-canary`, wired in
 * apps/web/lib/v2/ops/functions.ts). The work is injected; this package stays Sentry-agnostic.
 *
 * The request time is taken before the request and kept in the `request` step's output, so a
 * replayed run looks from the same time. Each report is made inside its step, so a replay does not
 * report again.
 *
 * The canary reports its own failure too. A step that throws is retried by Inngest; once its retries
 * are used, `step.run` rejects in the handler with a `StepError` (inngest 3.54.2,
 * components/execution/v1.js, where `recentlyRejectedStepError` is set). The handler then reports
 * under the stage `request_error` or `look_error`, in a step of its own, and rethrows that error,
 * which Inngest does not retry again (the same file's `retriable` test), so the run ends failed.
 */
import { inngest } from './client';

export const SIGNIN_CANARY_FN_ID = 'crawlmouse.ops.signin-canary';
/** How long the canary waits for the delivery. */
export const CANARY_WAIT = '5m';

/**
 * Where the signal comes from: the request was refused (`request`), no delivery was recorded
 * (`delivery`), or asking (`request_error`) or looking (`look_error`) threw past its retries.
 */
export type CanaryStage = 'request' | 'delivery' | 'request_error' | 'look_error';

export interface CanaryWork {
  now(): Date;
  /** Asks for a sign-in link to the canary's address. */
  request(): Promise<'sent' | 'refused'>;
  /** Whether a delivery to the canary's address was recorded at or after `sinceIso`. */
  delivered(sinceIso: string): Promise<boolean>;
  /** Raises the signal, tagged with its stage. */
  report(stage: CanaryStage): Promise<void>;
}

export interface CanaryOutput {
  requested: 'sent' | 'refused';
  /** Null when nothing was asked for, so nothing was looked for. */
  delivered: boolean | null;
}

export function createSigninCanaryFn(work: () => CanaryWork) {
  return inngest.createFunction(
    { id: SIGNIN_CANARY_FN_ID, concurrency: { limit: 1 } },
    { cron: '*/10 * * * *' },
    async ({ step }): Promise<CanaryOutput> => {
      /** Reports a step that failed past its retries, then fails the run with its error. */
      const failed = async (stage: CanaryStage, error: unknown): Promise<never> => {
        await step.run(`report-${stage}`, () => work().report(stage));
        throw error;
      };
      let asked: { at: string; outcome: 'sent' | 'refused' };
      try {
        asked = await step.run('request', async () => {
          const w = work();
          const at = w.now().toISOString();
          const outcome = await w.request();
          if (outcome === 'refused') await w.report('request');
          return { at, outcome };
        });
      } catch (error) {
        return await failed('request_error', error);
      }
      if (asked.outcome === 'refused') return { requested: 'refused', delivered: null };
      await step.sleep('wait', CANARY_WAIT);
      let delivered: boolean;
      try {
        delivered = await step.run('look', async () => {
          const w = work();
          const seen = await w.delivered(asked.at);
          if (!seen) await w.report('delivery');
          return seen;
        });
      } catch (error) {
        return await failed('look_error', error);
      }
      return { requested: 'sent', delivered };
    },
  );
}
