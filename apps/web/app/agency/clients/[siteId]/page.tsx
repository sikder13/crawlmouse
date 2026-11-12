import '../../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { ClientScreen } from '@/components/v2/screens/agency/ClientScreen';
import { MatrixScreen } from '@/components/v2/screens/agency/MatrixScreen';
import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount, siteOfCaller } from '@/lib/v2/account/pages';
import { isId } from '@/lib/v2/account/route';
import { chosenFromRequest, readViewer } from '@/lib/v2/account/viewer';
import { noticeLine } from '@/lib/v2/copy/notices';
import { agencyClientView } from '@/lib/v2/view/agency-client';
import { agencyGate } from '@/lib/v2/view/agency-matrix';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * One client of an agency (CC-31 D5). A 404 while V2_CHECKS_PUBLIC is off, and for a malformed id,
 * a site that does not exist, a removed one, a staging copy, and a site the caller's seat does not
 * cover (`siteOfCaller` reads it with the caller's own client, whose row policy is
 * `is_member_for_site`); the sign-in page for a caller who is not signed in. On an account below
 * Agency the page is the gate.
 *
 * As the site page does, it shows the site's own account, which need not be the one the caller acts
 * in: then the rail offers the switch.
 */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const { siteId } = await params;
  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) redirect('/login');
  if (!isId(siteId)) notFound();
  const now = new Date();
  const site = await siteOfCaller(session, user.id, siteId, now);
  if (site === null) notFound();
  const { d, viewer } = await readAccount(session, site.accountId, site.seatId, now);
  const found = await readViewer(
    { session, admin: supabaseAdmin(), now: () => now },
    { id: user.id, email: user.email ?? null },
    await chosenFromRequest(),
  );
  const reader =
    found.kind === 'viewer'
      ? { accounts: found.viewer.accounts, actingIn: found.viewer.account.id }
      : {};

  const gate = agencyGate(d, viewer, reader);
  if (gate) {
    return (
      <LiveActions>
        <MatrixScreen data={gate} />
      </LiveActions>
    );
  }
  const page = agencyClientView(d, viewer, siteId, reader);
  if (page === null) notFound();
  const notice = noticeLine(await searchParams, d.accounts[0]!.timezone);
  return (
    <LiveActions>
      {page.kind === 'client' ? (
        <ClientScreen data={page} notice={notice} />
      ) : (
        <FirstCheckScreen data={page.first} notice={notice} />
      )}
    </LiveActions>
  );
}
