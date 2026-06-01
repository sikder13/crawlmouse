import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';

const schema = z.object({ priceId: z.string() });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const allowed = [process.env.STRIPE_PRICE_ID_PRO_MONTHLY, process.env.STRIPE_PRICE_ID_PRO_YEARLY];
  if (!allowed.includes(parsed.data.priceId)) return NextResponse.json({ error: 'bad_price' }, { status: 400 });

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_BASE_URL!;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: parsed.data.priceId, quantity: 1 }],
    client_reference_id: user.id,
    customer_email: user.email ?? undefined,
    allow_promotion_codes: true,
    success_url: `${origin}/dashboard?upgraded=1`,
    cancel_url: `${origin}/pricing`,
  });
  return NextResponse.json({ url: session.url });
}
