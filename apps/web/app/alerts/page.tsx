import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { AlertsScreen } from '@/components/v2/screens/alerts/AlertsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { seedDefaultAlertRules } from '@/lib/v2/monitor/alert-defaults';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAlertRulePorts } from '@/lib/v2/account/alert-rules';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { settingsNotice } from '@/lib/v2/copy/settings-notices';
import type { AccountDataset } from '@/lib/v2/view/account';
import { withSwitcher } from '@/lib/v2/view/account-shell';
import { alertsView } from '@/lib/v2/view/alerts';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Alerts',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Alerts (CC-28 D8, spec 27 `accountAlertRules`): what was sent, where alerts go and the account's
 * rules, from the account's own records, for any signed-in member of the account they act in. The
 * fired list is the account's changes whose `notified` alertFn wrote. A 404 while V2_CHECKS_PUBLIC is
 * off; the sign-in page for a caller who is not signed in. `?error=<code>` is the line for a form
 * `PUT /api/alert-rules` refused, read as Settings reads it.
 *
 * Whether Slack is set is read from the account's Slack destination (`account_slack_last4`), which
 * the dataset's `integrations` does not carry: the row says connected, with no channel name, since
 * only the URL's last four characters are kept.
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat, accounts } = r.viewer;
  // The account's default rules exist before the page reads them (Q13).
  await seedDefaultAlertRules(supabaseAdmin(), account.id);
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  const last4 = await supabaseAlertRulePorts(supabaseAdmin()).slackLast4(account.id);
  return (
    <LiveActions>
      <AlertsScreen
        data={withSwitcher(
          alertsView(withSlack(d, account.id, last4 !== null), viewer),
          accounts,
          account.id,
        )}
        notice={settingsNotice(await searchParams, 'alerts')}
      />
    </LiveActions>
  );
}

/** The dataset with the account's Slack destination as its one integration, when one is set. */
function withSlack(d: AccountDataset, accountId: string, set: boolean): AccountDataset {
  if (!set) return d;
  return {
    ...d,
    accounts: d.accounts.map((a) =>
      a.id === accountId
        ? { ...a, integrations: [{ kind: 'slack', connected: true, label: null }] }
        : a,
    ),
  };
}
