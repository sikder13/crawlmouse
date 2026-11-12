import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { DeleteScreen } from '@/components/v2/screens/settings/DeleteScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { settingsNotice } from '@/lib/v2/copy/settings-notices';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { deletionAccounts, deletionBlocked } from '@/lib/v2/account/deletion-plan';
import { readSettingsPage } from '@/lib/v2/account/settings-pages';
import { deleteStepView } from '@/lib/v2/view/settings';

// Not indexed, not in the sitemap and rendered per request: the (account) layout says so for
// every page in the group.
export const metadata: Metadata = { title: 'Delete this account' };

/**
 * Settings › Delete (spec 27 `deleteConfirm`): the owner re-types the primary site's hostname and
 * asks for the confirmation link; the page lists the accounts the deletion removes, read from the
 * erasure's plan once the session has shown the caller is the owner. Any other role gets a 404, as
 * does everyone while V2_CHECKS_PUBLIC is off. A caller acting in an account that is not their own
 * personal account is sent to Settings, which says deleting belongs to that account and offers the
 * switch (CC-31 D2b): `DELETE /api/account` would answer them 409.
 */
export default async function DeletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const page = await readSettingsPage();
  if (page.kind === 'signed_out') redirect('/login');
  if (page.kind === 'none' || page.role !== 'owner') notFound();
  if (page.ownPersonalId !== page.viewer.accountId) redirect('/settings');
  const admin = supabaseAdmin();
  const removes = await deletionAccounts(admin, page.userId);
  const blocked = await deletionBlocked(admin, page.viewer.accountId, page.userId);
  return (
    <LiveActions>
      <DeleteScreen
        notice={settingsNotice(await searchParams, 'delete')}
        data={deleteStepView(page.d, page.viewer, {
          removes,
          role: page.role,
          blocked,
          subscriptionStatus: page.subscriptionStatus,
        })}
      />
    </LiveActions>
  );
}
