import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { SettingsScreen } from '@/components/v2/screens/settings/SettingsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { settingsView } from '@/lib/v2/view/settings';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Settings (CC-27b D6, spec 27 `emailSettings`): the account's address, name and email kinds, the
 * plan card and the danger zone, for the owner or an account manager; a developer gets a 404, as
 * does everyone while V2_CHECKS_PUBLIC is off. A signed-out caller is sent to sign in.
 */
export default async function SettingsPage() {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none') notFound();
  if (page.role !== 'owner' && page.role !== 'account_manager') notFound();
  return (
    <LiveActions>
      <SettingsScreen data={settingsView(page.d, page.viewer, { billingEnd: page.billingEnd })} />
    </LiveActions>
  );
}
