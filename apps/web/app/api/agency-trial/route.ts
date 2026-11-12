import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { agencyTrial } from '@/lib/billing/agency-trial';
import { supabaseCheckoutAccounts } from '@/lib/billing/checkout-v2';
import { billingV2Enabled } from '@/lib/billing/flags';
import { refuse } from '@/lib/billing/request-body';
import { stripeAccount } from '@/lib/billing/stripe-account';
import { accountCatalog } from '@/lib/billing/stripe-catalog';
import { resolveOrigin } from '@/lib/origin';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { admittedHost } from '@/lib/v2/account/sites';
import { pricingCapture } from '@/lib/v2/pricing/events';
import { agencyCheckouts } from './_lib/checkouts';
import {
  AGENCY_TRIAL_PER_USER_PER_HOUR,
  startAgencyTrial,
  type StartedAccount,
} from './_lib/start';

const HOUR_MS = 60 * 60 * 1000;

export const runtime = 'nodejs';

const report = (message: string, extra: Readonly<Record<string, string>>) => {
  Sentry.captureMessage(message, { level: 'error', tags: { signal: message }, extra });
};

/**
 * Start the Agency trial (CC-29 D3): the second account, its first site, then CC-03's Checkout.
 * The caller's own session first (401 without one), then V2_BILLING (404 while it is off); the
 * service-role client is made only after both. What follows: ./_lib/start.ts.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');
  if (!billingV2Enabled()) return refuse(404, 'not_found');

  const admin = supabaseAdmin();
  const checkouts = agencyCheckouts(admin);
  const now = () => new Date();
  return startAgencyTrial(
    req,
    { id: user.id, email: user.email ?? null },
    {
      rateLimit: (key) => checkRateLimit(key, AGENCY_TRIAL_PER_USER_PER_HOUR, HOUR_MS),
      admit: (site) => admittedHost(site),
      async startAccount(userId, name, host) {
        const { data, error } = await admin.rpc('start_agency_trial_account', {
          p_user: userId,
          p_name: name,
          p_host: host,
        });
        if (error) throw new Error(`start_agency_trial_account failed: ${error.message}`);
        const r = data as { outcome: string; account_id?: string; site_id?: string };
        return (
          r.outcome === 'trial_used'
            ? { outcome: 'trial_used' }
            : { outcome: r.outcome, accountId: r.account_id, siteId: r.site_id }
        ) as StartedAccount;
      },
      openCheckout: (accountId) => checkouts.open(accountId),
      async storeCheckout(accountId, checkout) {
        // The session is open either way; without the stored URL a second submit opens another,
        // which expires this one (CC-03's startCheckout).
        await checkouts
          .store(accountId, checkout)
          .catch((err: Error) =>
            report('agency-trial.checkout-store-failed', { accountId, reason: err.message }),
          );
      },
      checkout: (input) =>
        agencyTrial(
          {
            accounts: supabaseCheckoutAccounts(admin),
            stripe: stripeAccount(),
            catalog: accountCatalog(),
            origin: resolveOrigin(req),
            now,
            report,
          },
          input,
        ),
      capture: pricingCapture(req.headers.get('cookie')),
      defer: (work) => after(work),
      now,
    },
  );
}
