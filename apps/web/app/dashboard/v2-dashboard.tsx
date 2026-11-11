import '../../styles/v2/tokens.css';
import { redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { DashboardScreen } from '@/components/v2/screens/dashboard/DashboardScreen';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { dashboardView } from '@/lib/v2/view/dashboard';

/**
 * The v2 dashboard (CC-26b D8), which `page.tsx` imports only while V2_CHECKS_PUBLIC is on, so
 * neither this module nor its stylesheets are in the v1 page's graph.
 */
export default async function V2Dashboard() {
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat } = r.viewer;
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  return (
    <LiveActions>
      <DashboardScreen data={dashboardView(d, viewer)} />
    </LiveActions>
  );
}
