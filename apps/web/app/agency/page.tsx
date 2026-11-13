import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { MatrixScreen } from '@/components/v2/screens/agency/MatrixScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { noticeLine } from '@/lib/v2/copy/notices';
import { agencyHomeView } from '@/lib/v2/view/agency-matrix';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Clients',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * The client matrix (CC-31 D5), for the account the caller acts in. A 404 while V2_CHECKS_PUBLIC is
 * off; the sign-in page for a caller who is not signed in. On an account below Agency the page is
 * the gate, and for a caller acting in an account that is not an agency while holding a seat on
 * one, the switch to it (docs/specs/v2/31-agency.md §8). The records are read for the caller's own
 * seat, so a seat that covers some clients lists those and no others.
 */
export default async function AgencyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat, accounts, tier } = r.viewer;
  const sb = await supabaseServer();
  const { d, viewer } = await readAccount(sb, account.id, seat.id, new Date());
  // Whether a client report was sent: the caller's own read, of the clients their seat covers. The
  // matrix shows "Send the first report" to a seat that covers every client and to no other.
  const sent = await sb
    .from('reports')
    .select('id')
    .eq('account_id', account.id)
    .eq('kind', 'client_report')
    .eq('status', 'sent')
    .limit(1);
  if (sent.error) throw new Error(`reports read failed: ${sent.error.message}`);
  return (
    <LiveActions>
      <MatrixScreen
        data={agencyHomeView(d, viewer, {
          accounts,
          billing: billingV2Enabled(),
          reportSent: (sent.data ?? []).length > 0,
        })}
        // The form a plan's limit refuses here is the add-client form: its notice names the limit.
        notice={noticeLine(await searchParams, account.timezone, tier)}
      />
    </LiveActions>
  );
}
