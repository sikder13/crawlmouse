import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { inngest } from '@crawlmouse/inngest';
import { dispatchPlanned, type EffectSinks, type PlannedEffect } from './effects';
import { billingV2Enabled } from './flags';
import { stripeAccount } from './stripe-account';

type Env = Readonly<Record<string, string | undefined>>;

/** A subscription in one of these has ended; cancelling it again is done already. */
const ENDED = new Set(['canceled', 'incomplete_expired']);

/** How long an alert may wait for Sentry to take it before the dispatch fails. */
const ALERT_FLUSH_MS = 2000;

/**
 * Where effects go in production: Inngest for events, the Crawlmouse Stripe account for
 * cancellations, Sentry for founder alerts. An alert is flushed before it resolves, because a Vercel
 * function can freeze as soon as it answers, and the caller marks the plan done after it.
 */
export function productionSinks(): EffectSinks {
  return {
    async send(events) {
      // Each event matches one entry of PlannedEffectSchema, whose shapes are inngest/client.ts's.
      await inngest.send(events as unknown as Parameters<typeof inngest.send>[0]);
    },
    async cancel({ subscriptionId, reason }) {
      const stripe = stripeAccount();
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      if (ENDED.has(current.status)) return;
      await stripe.subscriptions.cancel(
        subscriptionId,
        { prorate: false },
        { idempotencyKey: `cancel:${subscriptionId}:${reason}` },
      );
    },
    async alert(alert) {
      Sentry.captureMessage(`billing.${alert.reason}`, {
        level: 'error',
        tags: { signal: `billing-${alert.reason.replace('_', '-')}` },
        extra: {
          accountId: alert.accountId,
          subscriptionId: alert.subscriptionId,
          source: alert.source,
        },
      });
      // Without a Sentry client (no DSN in this environment) there is nowhere to deliver it.
      if (Sentry.getClient() === undefined) {
        console.error(`[billing] ${alert.reason} alert with Sentry off`, alert.source);
        return;
      }
      if (!(await Sentry.flush(ALERT_FLUSH_MS)))
        throw new Error('the founder alert was not delivered');
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
