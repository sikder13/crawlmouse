import { stripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { applyStripeEvent } from '@/lib/billing/apply-stripe-event';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig ?? '', process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response('invalid signature', { status: 400 });
  }
  try {
    await applyStripeEvent(supabaseAdmin(), event);
  } catch {
    return new Response('handler error', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
