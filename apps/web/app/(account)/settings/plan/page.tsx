import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { PlanScreen } from '@/components/v2/screens/settings/PlanScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { checkoutOpen, withSwitcher } from '@/lib/v2/view/account-shell';
import { cancelStepFrom, settingsView } from '@/lib/v2/view/settings';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Plan' };

/**
 * Settings › Plan (spec 27 `plan`, "Settings › Plan with no sites"): the plan card, for the owner,
 * whether or not the account holds a site; after a cancel it shows the plan until the paid period
 * ends. The cancel route sends its form back here with `?cancel=confirm` after the first click,
 * where the card offers the second, and `?cancel=done` after it. Any other role gets a 404, as does
 * everyone while V2_CHECKS_PUBLIC is off.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none' || page.role !== 'owner') notFound();
  const cancelStep = cancelStepFrom((await searchParams).cancel);
  return (
    <LiveActions>
      <PlanScreen
        data={withSwitcher(
          settingsView(page.d, page.viewer, {
            billingEnd: page.billingEnd,
            role: page.role,
            subscriptionStatus: page.subscriptionStatus,
            cancelStep,
            billingOpen: checkoutOpen(process.env, page.userId),
          }),
          page.accounts,
          page.viewer.accountId,
        )}
      />
    </LiveActions>
  );
}
