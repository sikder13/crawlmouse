import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { IntegrationsScreen } from '@/components/v2/screens/integrations/IntegrationsScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseAlertRulePorts } from '@/lib/v2/account/alert-rules';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { settingsNotice } from '@/lib/v2/copy/settings-notices';
import { withSwitcher } from '@/lib/v2/view/account-shell';
import { integrationsView } from '@/lib/v2/view/integrations';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Integrations' };

/**
 * Settings › Integrations: the account's Slack destination, for the roles that may edit it (the
 * owner or an account manager, as `PUT /api/alert-rules` requires). A developer gets a 404, as on
 * Settings, and so does everyone while V2_CHECKS_PUBLIC is off. The role is read through the
 * caller's own session before the service-role read of the webhook's last four characters.
 */
export default async function IntegrationsPage({
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
  const last4 = await supabaseAlertRulePorts(supabaseAdmin()).slackLast4(accountId);
  return (
    <LiveActions>
      <IntegrationsScreen
        notice={settingsNotice(await searchParams, 'integrations')}
        data={withSwitcher(
          integrationsView(page.d, page.viewer, last4, page.role),
          page.accounts,
          accountId,
        )}
      />
    </LiveActions>
  );
}
