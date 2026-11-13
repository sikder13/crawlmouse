import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { ReportsScreen } from '@/components/v2/screens/reports/ReportsScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { siteOrigin } from '@/lib/site-url';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { noticeLine } from '@/lib/v2/copy/notices';
import { madeLinkIn, SHARE_FLASH_COOKIE, shareUrl } from '@/lib/v2/reports/share';
import { reportFileStates } from '@/lib/v2/reports/share-proof';
import { withSwitcher } from '@/lib/v2/view/account-shell';
import { reportsView } from '@/lib/v2/view/reports';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Reports and exports',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Reports and exports of the account the caller acts in (CC-31 D6, D7). A 404 while V2_CHECKS_PUBLIC
 * is off; the sign-in page for a caller who is not signed in. The reports are read with the caller's
 * own client, so a seat that covers some clients lists those clients' reports. A share link made a
 * moment ago arrives in the share form's cookie and is shown on its report's row; the page's address
 * holds no part of it.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none') return notFound();

  const query = await searchParams;
  const made = madeLinkIn((await cookies()).get(SHARE_FLASH_COOKIE)?.value);
  const zone = page.d.accounts[0]?.timezone ?? 'UTC';
  return (
    <LiveActions>
      <ReportsScreen
        notice={noticeLine(query, zone)}
        data={withSwitcher(
          reportsView(
            page.d,
            page.viewer,
            { site: typeof query.site === 'string' ? query.site : undefined },
            '/reports',
            {
              fileStates: await reportFileStates(supabaseAdmin(), page.d.reports),
              role: page.role,
              madeLink: made && {
                reportId: made.reportId,
                url: shareUrl(siteOrigin(), made.token),
              },
            },
          ),
          page.accounts,
          page.viewer.accountId,
        )}
      />
    </LiveActions>
  );
}
