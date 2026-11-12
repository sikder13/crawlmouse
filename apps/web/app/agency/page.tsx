import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { MatrixScreen } from '@/components/v2/screens/agency/MatrixScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { noticeLine } from '@/lib/v2/copy/notices';
import { agencyHomeView } from '@/lib/v2/view/agency-matrix';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
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
  const { account, seat, accounts } = r.viewer;
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  return (
    <LiveActions>
      <MatrixScreen
        data={agencyHomeView(d, viewer, { accounts })}
        notice={noticeLine(await searchParams, account.timezone)}
      />
    </LiveActions>
  );
}
