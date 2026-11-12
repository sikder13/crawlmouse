import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import { SiteScreen } from '@/components/v2/screens/site/SiteScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId } from '@/lib/v2/account/route';
import { readAccount, siteOfCaller } from '@/lib/v2/account/pages';
import { readNextChecks } from '@/lib/v2/account/sites-store';
import { viewAt } from '@/lib/v2/view/account';
import { accountShellView } from '@/lib/v2/view/account-shell';
import { sitePage } from '@/lib/v2/view/site';
import { noticeLine } from '@/lib/v2/copy/notices';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * One site of the caller's account (CC-26b D8). A 404 while V2_CHECKS_PUBLIC is off, and for a
 * malformed id, a site that does not exist, a removed one, or one on an account the caller does
 * not sit on; the sign-in page for a caller who is not signed in.
 */
export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const { id } = await params;
  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) redirect('/login');
  if (!isId(id)) notFound();
  const now = new Date();
  const site = await siteOfCaller(session, user.id, id, now);
  if (site === null) notFound();
  const { d, viewer } = await readAccount(session, site.accountId, site.seatId, now);
  // The scheduler's own column (CC-28 D8), read once the caller's seat is established.
  const page = sitePage(d, viewer, id, await readNextChecks(supabaseAdmin(), [id]));
  const notice = noticeLine(await searchParams, d.accounts[0]!.timezone);
  return (
    <LiveActions>
      {page.kind === 'site' ? (
        <SiteScreen
          data={page.site}
          shell={accountShellView(viewAt(d, viewer), 'Sites')}
          notice={notice}
        />
      ) : (
        <FirstCheckScreen data={page.first} notice={notice} />
      )}
    </LiveActions>
  );
}
