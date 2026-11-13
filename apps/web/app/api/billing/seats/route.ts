import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { requestedAccountId } from '@/lib/billing/owner';
import { stripeAccount } from '@/lib/billing/stripe-account';
import { accountCatalog } from '@/lib/billing/stripe-catalog';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { readEntitlement } from '@/lib/v2/account/viewer';
import { chosenInHeader } from '@/lib/v2/account/viewer-cookie';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import {
  changeExtras,
  extrasResponse,
  parseExtras,
  supabaseExtrasAccounts,
} from '@/lib/v2/agency/extras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BACK = '/seats';

/**
 * Set the Agency plan's extra seats and extra sites (CC-31 D4): `{seats, sites}`, the quantities
 * wanted beyond the plan's own. A 404 unless V2_CHECKS_PUBLIC and V2_BILLING are both on. The account
 * is the one the request names, else the one the caller owns (`requestedAccountId`, as the other
 * billing routes); the caller's role must be one `seat_may` lets buy (the owner), asked through
 * their own session before the service-role client is made; a tier below Agency is 402 with the
 * gate's name. The change goes to Stripe through `changeExtras`; the account's limits follow when the
 * webhook applies the subscription Stripe confirms.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  if (!billingV2Enabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const body = await readBody(req);
  const input = body && parseExtras(body);
  if (!body || !input) return refuseTo(req, BACK, 400, 'invalid');
  const target = await requestedAccountId(
    sb,
    user.id,
    input.accountId,
    chosenInHeader(req.headers.get('cookie')),
  );
  if (!target.ok) return refuse(target.status, target.error);
  const { data: allowed, error } = await sb.rpc('seat_may', {
    p_account: target.accountId,
    p_action: 'buy_seats',
  });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  if (allowed !== true) return refuseTo(req, BACK, 403, 'role_refused');
  const entitlement = await readEntitlement(sb, target.accountId, new Date());
  if (entitlement === null) return notFound();
  if (!entitlement.gates.agencyBranding) {
    return refuseTo(req, BACK, 402, 'upgrade_required', { gate: 'agencyBranding' });
  }

  const want = { seats: input.seats, sites: input.sites };
  const result = await changeExtras(
    {
      accounts: supabaseExtrasAccounts(supabaseAdmin()),
      stripe: stripeAccount(),
      catalog: accountCatalog(),
      now: () => new Date(),
    },
    { accountId: target.accountId, want },
  );
  // A purchase: a quantity rose. Lowering one buys nothing, and sends no event.
  if (result.ok && result.raised) {
    await agencyCaptureFor(req)('seats_bought', target.accountId, want);
  }
  return extrasResponse(body.kind, result);
}
