/**
 * `crawlmouse.ops.signin-canary` (CC-33 D6): every ten minutes, asks Supabase Auth for a sign-in link
 * to one address, waits five minutes, and looks for Resend's delivery of it. No delivery, or a
 * request Supabase refused, is reported (Sentry `signal: signin-canary`, wired in
 * apps/web/lib/v2/ops/functions.ts). The work is injected; this package stays Sentry-agnostic.
 *
 * The request time is taken before the request and kept in the `request` step's output, so a
 * replayed run looks from the same time. Each report is made inside its step, so a replay does not
 * report again.
 */
import { inngest } from './client';

export const SIGNIN_CANARY_FN_ID = 'crawlmouse.ops.signin-canary';
/** How long the canary waits for the delivery. */
export const CANARY_WAIT = '5m';

export interface CanaryWork {
  now(): Date;
  /** Asks for a sign-in link to the canary's address. */
  request(): Promise<'sent' | 'refused'>;
  /** Whether a delivery to the canary's address was recorded at or after `sinceIso`. */
  delivered(sinceIso: string): Promise<boolean>;
  /** Raises the signal: the request was refused, or no delivery was recorded. */
  report(stage: 'request' | 'delivery'): Promise<void>;
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
      const asked = await step.run('request', async () => {
        const w = work();
        const at = w.now().toISOString();
        const outcome = await w.request();
        if (outcome === 'refused') await w.report('request');
        return { at, outcome };
      });
      if (asked.outcome === 'refused') return { requested: 'refused', delivered: null };
      await step.sleep('wait', CANARY_WAIT);
      const delivered = await step.run('look', async () => {
        const w = work();
        const seen = await w.delivered(asked.at);
        if (!seen) await w.report('delivery');
        return seen;
      });
      return { requested: 'sent', delivered };
    },
  );
}
