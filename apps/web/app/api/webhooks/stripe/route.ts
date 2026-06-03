import * as Sentry from '@sentry/nextjs';
import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { applyStripeEvent } from '@/lib/billing/apply-stripe-event';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('server misconfigured', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? '', secret);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err instanceof Error ? err.message : err);
    // Surface as a low-noise warning so an attacker probing the webhook (or a misconfigured
    // secret) is visible in Sentry without paging on every bad request.
    Sentry.captureMessage('stripe.webhook.signature_failed', {
      level: 'warning',
      tags: { signal: 'stripe-webhook-sig-fail' },
    });
    return new Response('invalid signature', { status: 400 });
  }

  try {
    await applyStripeEvent(supabaseAdmin(), event, stripe);
  } catch (err) {
    // Return 500 so Stripe retries; the idempotency ledger makes retries safe.
    console.error(`[stripe-webhook] handler error for ${event.type} ${event.id}:`, err instanceof Error ? err.message : err);
    return new Response('handler error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
