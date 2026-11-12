import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { SeatsScreen } from '@/components/v2/screens/seats/SeatsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { billingV2Enabled } from '@/lib/billing/flags';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { noticeLine } from '@/lib/v2/copy/notices';
import { seatsView } from '@/lib/v2/view/seats';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Seats of the account the caller acts in (CC-31 D3, D4). A 404 while V2_CHECKS_PUBLIC is off; the
 * sign-in page for a caller who is not signed in. The seats are read with the caller's own client,
 * so row security decides which of them a member sees; the seat limit is the viewer's.
 */
export default async function SeatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat, limits } = r.viewer;
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  return (
    <LiveActions>
      <SeatsScreen
        data={seatsView(d, viewer, { seatLimit: limits.seats, billing: billingV2Enabled() })}
        notice={noticeLine(await searchParams, account.timezone)}
      />
    </LiveActions>
  );
}
