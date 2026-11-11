import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { TrialEndedScreen, TrialEndScreen } from '@/components/v2/screens/trial-end/TrialEndScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { trialPage } from '@/lib/v2/view/trial-end';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Your trial' };

/**
 * Trial ending (spec 27 `trialEnded`), one page for both states, for any member: before the end,
 * read now, and after it, back on Free. An account with no trial to show, or no primary site to show
 * it of, is sent to Settings › Plan; a 404 while V2_CHECKS_PUBLIC is off.
 */
export default async function TrialEndedPage() {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none') notFound();
  const shown = trialPage(page.d, page.viewer);
  if (shown === null) redirect(page.role === 'owner' ? '/settings/plan' : '/dashboard');
  return (
    <LiveActions>
      {shown.kind === 'before' ? (
        <TrialEndScreen data={shown.view} />
      ) : (
        <TrialEndedScreen data={shown.view} />
      )}
    </LiveActions>
  );
}
