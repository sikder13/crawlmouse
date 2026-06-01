import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { resolveOrigin } from '@/lib/origin';

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const { data: row } = await sb.from('users').select('stripe_customer_id').eq('id', user.id).maybeSingle();
  if (!row?.stripe_customer_id) return NextResponse.json({ error: 'no_customer' }, { status: 400 });

  const origin = resolveOrigin(req);
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  });
  return NextResponse.json({ url: portal.url });
}
