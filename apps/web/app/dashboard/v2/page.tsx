import '../../../styles/v2/tokens.css';
import * as Sentry from '@sentry/nextjs';
import { notFound, redirect } from 'next/navigation';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { DashboardScreen } from '@/components/v2/screens/dashboard/DashboardScreen';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAlertRulePorts } from '@/lib/v2/account/alert-rules';
import { readAccount } from '@/lib/v2/account/pages';
import { readNextChecks } from '@/lib/v2/account/sites-store';
import { loadViewer } from '@/lib/v2/account/viewer';
import { reachedByRewrite } from '@/lib/v2/rewrite-target';
import { withSwitcher } from '@/lib/v2/view/account-shell';
import { dashboardView, withoutTrialOffer } from '@/lib/v2/view/dashboard';
import { withSlackConnected } from '@/lib/v2/view/integrations';
import { noticeLine } from '@/lib/v2/copy/notices';
import { readEarlierAudits } from './earlier-audits';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// Signed-in application surface, as v1's /dashboard: never a search result.
export const metadata = {
  // The rail's name for this page, under the root layout's "%s · Crawlmouse" (D-31).
  title: 'Sites',
  robots: { index: false, follow: true },
  alternates: { canonical: '/dashboard' },
};

/**
 * The v2 dashboard (CC-26b D8). With V2_CHECKS_PUBLIC on, the middleware rewrites `/dashboard` here;
 * v1's `app/dashboard/page.tsx` imports nothing of it, so neither this page nor its stylesheets are
 * in v1's graph. With the flag off it is a 404, reached or not. It shows the account the caller
 * acts in, and for a caller with seats on several accounts its rail has the switcher (CC-31 D2b).
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
  const { account, seat, accounts, tier, userId } = r.viewer;
  const now = new Date();
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, now);
  const [next, earlier, slackLast4] = await Promise.all([
    // The scheduler's own column (CC-28 D8), for the sites the caller's session read.
    readNextChecks(
      supabaseAdmin(),
      d.sites.map((s) => s.id),
    ),
    // The signed-in viewer's own v1 audits (CC-36 D5): their id, not the account owner's, since a
    // v1 audit id is a capability URL. A failed read is reported and the line left out: it is not
    // worth the dashboard.
    readEarlierAudits(supabaseAdmin(), userId, now).catch((cause: unknown) => {
      Sentry.captureException(cause);
      return [];
    }),
    // Whether Slack is connected, for the set-up list. Only that it is set reaches the view. A
    // failed read is reported and taken as not set: the list then offers Slack again.
    supabaseAlertRulePorts(supabaseAdmin())
      .slackLast4(account.id)
      .catch((cause: unknown) => {
        Sentry.captureException(cause);
        return null;
      }),
  ]);
  const query = await searchParams;
  return (
    <LiveActions>
      <DashboardScreen
        data={withSwitcher(
          withoutTrialOffer(
            dashboardView(
              withSlackConnected(d, account.id, slackLast4 !== null),
              viewer,
              next,
              earlier,
            ),
            query,
          ),
          accounts,
          account.id,
        )}
        // The form a plan's limit refuses here is the add-site form: its notice names the limit.
        notice={noticeLine(query, account.timezone, tier)}
      />
    </LiveActions>
  );
}
