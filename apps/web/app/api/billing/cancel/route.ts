import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveOrigin } from '@/lib/origin';
import {
  cancelResponse,
  cancelSubscription,
  parseCancel,
  supabaseCancelAccounts,
} from '@/lib/billing/cancel';
import { billingV2Enabled } from '@/lib/billing/flags';
import { requestedAccountId } from '@/lib/billing/owner';
import { chosenInHeader } from '@/lib/v2/account/viewer-cookie';
import { readBody, refuse } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';

/**
 * Cancel the account's plan (CC-03 D8): the first post asks, the second (`confirm`) cancels. A 404
 * with V2_BILLING unset. The account must answer 'owner' to the caller's own session before the
 * service-role client is made.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  if (!billingV2Enabled()) return refuse(404, 'not_found');

  const body = await readBody(req);
  const input = body && parseCancel(body);
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

  const result = await cancelSubscription(
    {
      accounts: supabaseCancelAccounts(supabaseAdmin()),
      stripe: stripeAccount(),
      now: () => new Date(),
    },
    { accountId: target.accountId, confirmed: input.confirmed },
  );
  return cancelResponse(body.kind, resolveOrigin(req), result);
}
