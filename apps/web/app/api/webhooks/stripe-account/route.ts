import * as Sentry from '@sentry/nextjs';
import Stripe from 'stripe';
import { productionSinks } from '@/lib/billing/effect-sinks';
import { billingV2Enabled } from '@/lib/billing/flags';
import { expectedLivemode, stripeAccount } from '@/lib/billing/stripe-account';
import { accountCatalog } from '@/lib/billing/stripe-catalog';
import { applyStripeEvent, stripeReads, type WebhookReport } from '@/lib/billing/stripe-webhook';
import { supabaseWebhookDb } from '@/lib/billing/webhook-db';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The v2 Stripe webhook (CC-03 D2): events of the Crawlmouse account, signed with
 * STRIPE_ACCOUNT_WEBHOOK_SECRET. The v1 endpoint, /api/webhooks/stripe, is separate and unchanged.
 *
 * The signature is checked on the raw body before anything else is called or parsed; the flag is
 * read after it (questions Q8), so with V2_BILLING unset a verified event gets a 404. What it logs
 * is a fixed line, the event's type and id, and an error's message; not the body or the signature.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long a report may wait for Sentry before the response goes out. */
const REPORT_FLUSH_MS = 2000;

export async function POST(req: Request) {
  const secret = process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe-account-webhook] STRIPE_ACCOUNT_WEBHOOK_SECRET is not set');
    return new Response('server misconfigured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, sig ?? '', secret);
  } catch (err) {
    console.error(
      '[stripe-account-webhook] signature verification failed:',
      err instanceof Error ? err.message : 'unknown error',
    );
    Sentry.captureMessage('stripe.account_webhook.signature_failed', {
      level: 'warning',
      tags: { signal: 'stripe-account-webhook-sig-fail' },
    });
    return new Response('invalid signature', { status: 400 });
  }

  if (!billingV2Enabled()) return new Response('not found', { status: 404 });

  let reported = false;
  try {
    const result = await applyStripeEvent(
      event,
      {
        db: supabaseWebhookDb(supabaseAdmin()),
        stripe: stripeReads(stripeAccount()),
        catalog: accountCatalog(),
        sinks: productionSinks(),
        livemode: expectedLivemode(),
      },
      {
        report: (r) => {
          reported = true;
          report(r);
        },
      },
    );
    if (result.outcome === 'refused') return new Response('livemode mismatch', { status: 400 });
    return new Response('ok', { status: 200 });
  } catch (err) {
    // 500, so Stripe retries; the ledger makes a retry safe.
    console.error(
      `[stripe-account-webhook] handler error for ${event.type} ${event.id}:`,
      err instanceof Error ? err.message : 'unknown error',
    );
    return new Response('handler error', { status: 500 });
  } finally {
    if (reported) await Sentry.flush(REPORT_FLUSH_MS);
  }
}

/** Below the handler: CC-SEC's check reads call positions, and nothing may come before the verifier. */
function report(r: WebhookReport): void {
  Sentry.captureMessage(r.message, {
    level: r.level,
    tags: { signal: 'stripe-account-webhook' },
    extra: { eventId: r.eventId, type: r.type, accountId: r.accountId, ...r.detail },
  });
}
