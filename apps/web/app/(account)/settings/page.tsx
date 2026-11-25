import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { SettingsNotYoursScreen } from '@/components/v2/screens/settings/SettingsNotYoursScreen';
import { SettingsScreen } from '@/components/v2/screens/settings/SettingsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { settingsNotice } from '@/lib/v2/copy/settings-notices';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { checkoutOpen, withSwitcher } from '@/lib/v2/view/account-shell';
import { settingsNotYoursView, settingsView } from '@/lib/v2/view/settings';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings (CC-27b D6, spec 27 `emailSettings`): the account's address, name and email kinds, the
 * plan card and the danger zone, for the owner or an account manager. A developer gets a page that
 * says the settings are changed by those roles (D-03). Everyone gets a 404 while V2_CHECKS_PUBLIC is off. A signed-out caller is sent to sign in.
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
  const { accountId } = page.viewer;
  // A seat that may not change settings reads a page that says so, in its rail (D-03).
  if (page.role !== 'owner' && page.role !== 'account_manager') {
    return (
      <LiveActions>
        <SettingsNotYoursScreen
          data={withSwitcher(
            settingsNotYoursView(page.d, page.viewer, page.role),
            page.accounts,
            accountId,
          )}
        />
      </LiveActions>
    );
  }
  return (
    <LiveActions>
      <SettingsScreen
        notice={settingsNotice(await searchParams, 'settings')}
        data={withSwitcher(
          settingsView(page.d, page.viewer, {
            billingEnd: page.billingEnd,
            role: page.role,
            subscriptionStatus: page.subscriptionStatus,
            undeliverable: page.undeliverable,
            billingOpen: checkoutOpen(process.env, page.userId),
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
