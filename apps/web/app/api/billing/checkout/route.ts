import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { resolveOrigin } from '@/lib/origin';
import { checkoutV2, parseCheckout, supabaseCheckoutAccounts } from '@/lib/billing/checkout-v2';
import { billingV2Enabled } from '@/lib/billing/flags';
import { requestedAccountId } from '@/lib/billing/owner';
import { chosenInHeader } from '@/lib/v2/account/viewer-cookie';
import { readBody, refuse, respond } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';
import { accountCatalog } from '@/lib/billing/stripe-catalog';

const schema = z.object({ priceId: z.string() });

const report = (message: string, extra: Readonly<Record<string, string>>) => {
  Sentry.captureMessage(message, { level: 'error', tags: { signal: message }, extra });
};

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  if (billingV2Enabled()) {
    // CC-03 D6. The account must answer 'owner' to the caller's own session before the
    // service-role client is made.
    const body = await readBody(req);
    const input = body && parseCheckout(body);
    if (!body || !input) return refuse(400, 'invalid');
    const target = await requestedAccountId(
      sb,
      user.id,
      input.accountId,
      chosenInHeader(req.headers.get('cookie')),
    );
    if (!target.ok) return refuse(target.status, target.error);
    const { data: role, error: roleError } = await sb.rpc('member_role', {
      p_account: target.accountId,
    });
    if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
    if (role !== 'owner') return refuse(403, 'not_owner');
    const result = await checkoutV2(
      {
        accounts: supabaseCheckoutAccounts(supabaseAdmin()),
        stripe: stripeAccount(),
        catalog: accountCatalog(),
        origin: resolveOrigin(req),
        now: () => new Date(),
        report,
      },
      {
        accountId: target.accountId,
        email: user.email ?? null,
        plan: input.plan,
        interval: input.interval,
      },
    );
    return result.ok
      ? respond(body.kind, result.url)
      : refuse(result.status, result.error, result.detail);
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const allowed = [process.env.STRIPE_PRICE_ID_PRO_MONTHLY, process.env.STRIPE_PRICE_ID_PRO_YEARLY];
  if (!allowed.includes(parsed.data.priceId))
    return NextResponse.json({ error: 'bad_price' }, { status: 400 });

  // Reuse an existing Stripe customer (re-subscribe) instead of creating a duplicate.
  const { data: row } = await sb
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();
  const origin = resolveOrigin(req);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: parsed.data.priceId, quantity: 1 }],
    client_reference_id: user.id,
    ...(row?.stripe_customer_id
      ? { customer: row.stripe_customer_id }
      : { customer_email: user.email ?? undefined }),
    allow_promotion_codes: true,
    success_url: `${origin}/dashboard?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  });
  return NextResponse.json({ url: session.url });
}
