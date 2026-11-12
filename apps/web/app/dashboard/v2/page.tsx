import '../../../styles/v2/tokens.css';
import { notFound, redirect } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { DashboardScreen } from '@/components/v2/screens/dashboard/DashboardScreen';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { readNextChecks } from '@/lib/v2/account/sites-store';
import { loadViewer } from '@/lib/v2/account/viewer';
import { reachedByRewrite } from '@/lib/v2/rewrite-target';
import { dashboardView } from '@/lib/v2/view/dashboard';
import { noticeLine } from '@/lib/v2/copy/notices';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// Signed-in application surface, as v1's /dashboard: never a search result.
export const metadata = {
  robots: { index: false, follow: true },
  alternates: { canonical: '/dashboard' },
};

/**
 * The v2 dashboard (CC-26b D8). With V2_CHECKS_PUBLIC on, the middleware rewrites `/dashboard` here;
 * v1's `app/dashboard/page.tsx` imports nothing of it, so neither this page nor its stylesheets are
 * in v1's graph. With the flag off it is a 404, reached or not.
 */
export default async function V2Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  // Only through the middleware's rewrite of /dashboard: the page has no address of its own.
  if (!(await reachedByRewrite())) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat } = r.viewer;
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  // The scheduler's own column (CC-28 D8), for the sites the caller's session read.
  const next = await readNextChecks(
    supabaseAdmin(),
    d.sites.map((s) => s.id),
  );
  return (
    <LiveActions>
      <DashboardScreen
        data={dashboardView(d, viewer, next)}
        notice={noticeLine(await searchParams, account.timezone)}
      />
    </LiveActions>
  );
}
