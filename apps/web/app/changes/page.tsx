import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { ChangesLogScreen } from '@/components/v2/screens/changes-log/ChangesLogScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { changesLogView } from '@/lib/v2/view/changes-log';

export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Changes',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/** One value of a query parameter: a repeated one is read as not set. */
const one = (v: string | string[] | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * The Changes log (CC-28 D8, spec 27 `changeLog`): every change of the account the caller acts in,
 * newest first, filtered by `?site=&kind=&since=`, for any signed-in member. A 404 while
 * V2_CHECKS_PUBLIC is off; the sign-in page for a caller who is not signed in.
 */
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { account, seat } = r.viewer;
  const { d, viewer } = await readAccount(await supabaseServer(), account.id, seat.id, new Date());
  const q = await searchParams;
  return (
    <LiveActions>
      <ChangesLogScreen
        data={changesLogView(
          d,
          viewer,
          { site: one(q.site), kind: one(q.kind), since: one(q.since) },
          '/changes',
        )}
      />
    </LiveActions>
  );
}
