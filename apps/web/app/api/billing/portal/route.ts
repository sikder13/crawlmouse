import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';
import { resolveOrigin } from '@/lib/origin';
import { billingV2Enabled } from '@/lib/billing/flags';
import { requestedAccountId } from '@/lib/billing/owner';
import { chosenInHeader } from '@/lib/v2/account/viewer-cookie';
import { accountPortalConfiguration } from '@/lib/billing/portal-config';
import { parsePortal, portalV2, supabasePortalAccounts } from '@/lib/billing/portal-v2';
import { readBody, refuse, respond } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  if (billingV2Enabled()) {
    // CC-03 D8. The account must answer 'owner' to the caller's own session before the
    // service-role client is made.
    const body = await readBody(req);
    const input = body && parsePortal(body);
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
    const result = await portalV2(
      {
        accounts: supabasePortalAccounts(supabaseAdmin()),
        stripe: stripeAccount(),
        configuration: accountPortalConfiguration,
        origin: resolveOrigin(req),
      },
      target.accountId,
    );
    return result.ok
      ? respond(body.kind, result.url)
      : refuse(result.status, result.error, result.detail);
  }

  const { data: row } = await sb
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!row?.stripe_customer_id) return NextResponse.json({ error: 'no_customer' }, { status: 400 });

  const origin = resolveOrigin(req);
  const portal = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  });
  return NextResponse.json({ url: portal.url });
}
