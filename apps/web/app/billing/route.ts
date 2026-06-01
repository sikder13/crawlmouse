import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /billing → redirect a Pro user to the Stripe Customer Portal (manage/cancel).
// Spec §4.1/§770. Link "Manage subscription" here from the dashboard.
export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const { data: row } = await sb.from('users').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (!row?.stripe_customer_id) return NextResponse.redirect(new URL('/pricing', req.url));

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL!;
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  });
  return NextResponse.redirect(portal.url, 303);
}
