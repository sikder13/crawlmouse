import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { FirstCheckScreen } from '@/components/v2/screens/site/FirstCheckScreen';
import { SiteScreen } from '@/components/v2/screens/site/SiteScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { seedDefaultAlertRules } from '@/lib/v2/monitor/alert-defaults';
import { supabaseServer } from '@/lib/supabase/server';
import { isId } from '@/lib/v2/account/route';
import { readAccount, siteOfCaller } from '@/lib/v2/account/pages';
import { readNextChecks } from '@/lib/v2/account/sites-store';
import { chosenFromRequest, readViewer } from '@/lib/v2/account/viewer';
import { viewAt } from '@/lib/v2/view/account';
import { accountShellView, withSwitcher } from '@/lib/v2/view/account-shell';
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
 * not sit on; the sign-in page for a caller who is not signed in. It seeds the account's default
 * alert rules before it reads them (CC-28 S4).
 *
 * The page shows the site's own account, which for a caller with several seats need not be the one
 * they act in (CC-31 D2b). Then the rail says so, offers the switch to the site's account, and
 * leaves out Keep and the billing links, whose routes act on the account acted in.
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
  // The account's default rules exist before the page reads them (Q13), as on /alerts: a new
  // account's site lists its six rules before it ever opens /alerts or its first alert runs.
  await seedDefaultAlertRules(supabaseAdmin(), site.accountId);
  const { d, viewer } = await readAccount(session, site.accountId, site.seatId, now);
  const found = await readViewer(
    { session, admin: supabaseAdmin(), now: () => now },
    { id: user.id, email: user.email ?? null },
    await chosenFromRequest(),
  );
  // A caller the viewer cannot place on one account acts in none: the rail has no switcher.
  const reader =
    found.kind === 'viewer'
      ? { accounts: found.viewer.accounts, actingIn: found.viewer.account.id }
      : null;
  // The scheduler's own column (CC-28 D8), read once the caller's seat is established.
  const page = sitePage(d, viewer, id, await readNextChecks(supabaseAdmin(), [id]));
  const notice = noticeLine(await searchParams, d.accounts[0]!.timezone);
  return (
    <LiveActions>
      {page.kind === 'site' ? (
        <SiteScreen
          data={page.site}
          shell={accountShellView(viewAt(d, viewer), 'Sites', reader ?? {})}
          notice={notice}
        />
      ) : (
        <FirstCheckScreen
          data={
            reader
              ? withSwitcher(page.first, reader.accounts, site.accountId, reader.actingIn)
              : page.first
          }
          notice={notice}
        />
      )}
    </LiveActions>
  );
}
