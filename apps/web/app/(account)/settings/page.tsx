import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { SettingsScreen } from '@/components/v2/screens/settings/SettingsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { settingsNotice } from '@/lib/v2/copy/settings-notices';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { withSwitcher } from '@/lib/v2/view/account-shell';
import { settingsView } from '@/lib/v2/view/settings';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings (CC-27b D6, spec 27 `emailSettings`): the account's address, name and email kinds, the
 * plan card and the danger zone, for the owner or an account manager; a developer gets a 404, as
 * does everyone while V2_CHECKS_PUBLIC is off. A signed-out caller is sent to sign in.
 *
 * It shows the account the caller acts in. Where that is not their own personal account (an
 * agency's, say), the sign-in address and Delete are not offered: they belong to their own account,
 * and the page offers the switch to it (CC-31 D2b, docs/specs/v2/31-agency.md §5).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none') notFound();
  if (page.role !== 'owner' && page.role !== 'account_manager') notFound();
  const { accountId } = page.viewer;
  return (
    <LiveActions>
      <SettingsScreen
        notice={settingsNotice(await searchParams, 'settings')}
        data={withSwitcher(
          settingsView(page.d, page.viewer, {
            billingEnd: page.billingEnd,
            role: page.role,
            subscriptionStatus: page.subscriptionStatus,
            ...(page.ownPersonalId === accountId
              ? {}
              : { notOwnAccount: { personalAccountId: page.ownPersonalId } }),
          }),
          page.accounts,
          accountId,
        )}
      />
    </LiveActions>
  );
}
