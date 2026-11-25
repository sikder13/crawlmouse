import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AgencyTrialScreen } from '@/components/v2/screens/agency-trial/AgencyTrialScreen';
import { agencySalesOpen, billingOpenTo, billingV2Enabled } from '@/lib/billing/flags';
import { supabasePortalAccounts } from '@/lib/billing/portal-v2';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { loadViewer } from '@/lib/v2/account/viewer';
import { readAgencyAccounts } from '@/lib/v2/pricing/read';
import { readUsedAgencyTrial } from '@/lib/v2/pricing/used-trial';
import { agencyStanding, agencyTrialPath, agencyTrialView } from '@/lib/v2/view/agency-trial';
import { intervalFrom } from '@/lib/v2/view/pricing';

// Read per request: it reads the session, and a build with the flag off would otherwise prerender
// the 404.
export const dynamic = 'force-dynamic';

// A signed-in step, not a public page: never indexed, not in the sitemap (owner ruling Q9). The
// root layout's canonical ("/") would be wrong here, so it is cleared.
export const metadata: Metadata = {
  title: 'Start your Agency trial',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * The Agency trial page (CC-29 D3). With V2_BILLING off, or Agency not on sale (V2_AGENCY_SALES),
 * it sends the visitor to For agencies (RC-01, a temporary redirect), and reads nothing. While paying is kept to
 * one user (V2_BILLING_ONLY_USER), a signed-in visitor who is not that user is sent there too, once the
 * session is read. A signed-out visitor is sent to
 * sign in and back here. The form posts to /api/agency-trial. An owned agency account on the trial,
 * Agency or past due gets its Manage billing and Cancel here, naming the account (Q26);
 * `?cancel=<id>` shows that account's confirmation, CC-03's second click.
 */
export default async function AgencyTrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!billingV2Enabled()) redirect('/agencies');
  if (!agencySalesOpen()) redirect('/agencies');
  const params = await searchParams;
  const interval = intervalFrom(params.interval);
  const r = await loadViewer();
  if (r.kind === 'signed_out') {
    redirect(`/login?next=${encodeURIComponent(agencyTrialPath(interval))}`);
  }
  const now = new Date();
  const userId = r.kind === 'viewer' ? r.viewer.userId : r.userId;
  // While paying is kept to one user (V2_BILLING_ONLY_USER), the trial is that user's alone.
  if (!billingOpenTo(userId)) redirect('/agencies');
  const rows = await readAgencyAccounts(await supabaseServer(), userId);
  const admin = supabaseAdmin();
  const used = await readUsedAgencyTrial(admin, userId);
  const standing = agencyStanding(rows, used, now);
  // The portal's own reader, for the accounts this page offers it on (Q26).
  const portal = supabasePortalAccounts(admin);
  const customers = new Map(
    await Promise.all(
      standing.billing.map(async (r) => [r.id, await portal.customerOf(r.id)] as const),
    ),
  );
  const view = agencyTrialView(
    {
      email: r.kind === 'viewer' ? r.viewer.email : null,
      interval,
      timeZone: r.kind === 'viewer' ? r.viewer.account.timezone : 'UTC',
      standing,
      customers,
      cancelAsked: typeof params.cancel === 'string' ? params.cancel : null,
    },
    now,
  );
  return <AgencyTrialScreen view={view} />;
}
