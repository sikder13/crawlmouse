import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { PlanScreen } from '@/components/v2/screens/settings/PlanScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { settingsView } from '@/lib/v2/view/settings';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Plan' };

/**
 * Settings › Plan (spec 27 `plan`, "Settings › Plan with no sites"): the plan card, for the owner,
 * whether or not the account holds a site; after a cancel it shows the plan until the paid period
 * ends. Any other role gets a 404, as does everyone while V2_CHECKS_PUBLIC is off.
 */
export default async function PlanPage() {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none' || page.role !== 'owner') notFound();
  return (
    <LiveActions>
      <PlanScreen
        data={settingsView(page.d, page.viewer, {
          billingEnd: page.billingEnd,
          role: page.role,
          subscriptionStatus: page.subscriptionStatus,
        })}
      />
    </LiveActions>
  );
}
