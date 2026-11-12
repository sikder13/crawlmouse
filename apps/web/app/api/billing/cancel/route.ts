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
import { readDefaultAccountId } from '@/lib/v2/account/viewer-read';
import { readBody, refuse } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';

/**
 * Cancel the account's plan (CC-03 D8): the first post asks, the second (`confirm`) cancels. A 404
 * with V2_BILLING unset. The account must answer 'owner' to the caller's own session before the
 * service-role client acts on it; before that, it reads only the caller's own default account, and
 * only when the request names none and the caller owns several (lib/billing/owner.ts).
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
  const target = await requestedAccountId(sb, user.id, input.accountId, () =>
    readDefaultAccountId(supabaseAdmin(), user.id),
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
