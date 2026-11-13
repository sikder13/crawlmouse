import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { ClientReportsScreen } from '@/components/v2/screens/agency/ReportsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { readClientReports } from '@/lib/v2/agency/client-reports-read';
import { CLIENT_REPORTS_PAGE } from '@/lib/v2/agency/schedules';
import { noticeLine } from '@/lib/v2/copy/notices';
import { agencyReportsView } from '@/lib/v2/view/agency-reports';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Client reports',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * The agency's client reports (CC-31 D8), for the account the caller acts in: each client's
 * contact, schedule and next run, the forms that change them, and the reports sent. A 404 while
 * V2_CHECKS_PUBLIC is off; the sign-in page for a caller who is not signed in. On an account below
 * Agency the page is the gate, and for a caller acting in an account that is not an agency while
 * holding a seat on one, the switch to it, as `/agency` is (docs/specs/v2/31-agency.md §8).
 *
 * The records and the sent reports are read with the caller's own client, for their own seat, so a
 * seat that covers some clients lists those. `?client=<site id>` opens that client's forms, for a
 * seat that may schedule reports; a form's answer comes back as `?notice=`.
 */
export default async function ClientReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat, accounts } = r.viewer;
  const session = await supabaseServer();
  const read = await readAccount(session, account.id, seat.id, new Date());
  const { d, side } = await readClientReports({ session, admin: supabaseAdmin() }, read.d);
  const query = await searchParams;
  return (
    <LiveActions>
      <ClientReportsScreen
        data={agencyReportsView(
          d,
          read.viewer,
          typeof query.client === 'string' ? { client: query.client } : {},
          CLIENT_REPORTS_PAGE,
          side,
          { accounts },
        )}
        notice={noticeLine(query, account.timezone)}
      />
    </LiveActions>
  );
}
