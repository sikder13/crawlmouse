import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveOrigin } from '@/lib/origin';
import { agencyTrial, parseAgencyTrial } from '@/lib/billing/agency-trial';
import { supabaseCheckoutAccounts } from '@/lib/billing/checkout-v2';
import { billingV2Enabled } from '@/lib/billing/flags';
import { readBody, refuse, respond } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';
import { accountCatalog } from '@/lib/billing/stripe-catalog';

const report = (message: string, extra: Readonly<Record<string, string>>) => {
  Sentry.captureMessage(message, { level: 'error', tags: { signal: message }, extra });
};

/**
 * Start the Agency trial with a card (CC-03 D7). A 404 with V2_BILLING unset. The request names the
 * account (questions Q15), which must answer 'owner' to the caller's own session before the
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
  const input = body && parseAgencyTrial(body);
  if (!body || !input) return refuse(400, 'invalid');
  const { data: role, error: roleError } = await sb.rpc('member_role', {
    p_account: input.accountId,
  });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (role !== 'owner') return refuse(403, 'not_owner');

  const result = await agencyTrial(
    {
      accounts: supabaseCheckoutAccounts(supabaseAdmin()),
      stripe: stripeAccount(),
      catalog: accountCatalog(),
      origin: resolveOrigin(req),
      now: () => new Date(),
      report,
    },
    { accountId: input.accountId, email: user.email ?? null, interval: input.interval },
  );
  return result.ok
    ? respond(body.kind, result.url)
    : refuse(result.status, result.error, result.detail);
}
