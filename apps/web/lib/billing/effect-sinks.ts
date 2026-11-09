import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { inngest } from '@crawlmouse/inngest';
import { dispatchPlanned, type EffectSinks, type PlannedEffect } from './effects';
import { billingV2Enabled } from './flags';

type Env = Readonly<Record<string, string | undefined>>;

/** Where effects go in production: Inngest for events, Sentry for the founder alert. */
export function productionSinks(): EffectSinks {
  return {
    async send(events) {
      // Each event matches one entry of PlannedEffectSchema, whose shapes are inngest/client.ts's.
      await inngest.send(events as unknown as Parameters<typeof inngest.send>[0]);
    },
    alert(alert) {
      Sentry.captureMessage('billing.dispute', {
        level: 'error',
        tags: { signal: 'billing-dispute' },
        extra: { accountId: alert.accountId, source: alert.source },
      });
    },
  };
}

/**
 * The first-login hook's dispatcher (CC-03 D9b): with V2_BILLING set it sends the trial's planned
 * effects; unset, it sends nothing, as before this step.
 */
export function billingDispatcher(
  env: Env = process.env,
): (planned: readonly PlannedEffect[]) => Promise<void> {
  if (!billingV2Enabled(env)) return async () => {};
  const sinks = productionSinks();
  return (planned) => dispatchPlanned(planned, sinks);
}
