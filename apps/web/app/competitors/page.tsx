import type { Metadata, Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccountStateScreen } from '@/components/v2/screens/account/AccountStateScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { featureShown } from '@/lib/feature-switch';
import { supabaseServer } from '@/lib/supabase/server';
import { readAccount } from '@/lib/v2/account/pages';
import { loadViewer } from '@/lib/v2/account/viewer';
import { auditHrefs } from '@/lib/v2/view/audit-hrefs';
import { primarySite, primarySites, resultChecks, viewAt } from '@/lib/v2/view/account';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Competitors',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * The rail's "Competitors" (row 18): where a site's competitors are compared, its latest check's
 * Signals page. The site is the first of the reader's sites with a competitor named, or else their
 * first site; with no finished check yet, its site page, where competitors are named. There is no
 * page of its own here, so the link no longer answers 404 (F-256).
 *
 * A 404 while V2_CHECKS_PUBLIC is off; the dashboard while the RISK switch hides `competitors`, or
 * when the reader has no site; the sign-in page for a caller who is not signed in.
 */
export default async function CompetitorsPage() {
  if (!checksPublicEnabled()) return notFound();
  if (!featureShown('competitors')) redirect('/dashboard');
  const r = await loadViewer();
  if (r.kind === 'signed_out') redirect('/login');
  if (r.kind !== 'viewer') return <AccountStateScreen state={r.kind} />;
  const { d, viewer } = await readAccount(
    await supabaseServer(),
    r.viewer.account.id,
    r.viewer.seat.id,
    new Date(),
  );
  const v = viewAt(d, viewer);
  const sites = primarySites(v);
  if (sites.length === 0) redirect('/dashboard');
  const site = sites.find((s) => s.competitor_hosts.length > 0) ?? primarySite(v);
  const latest = resultChecks(v, site.id).at(-1);
  redirect((latest ? auditHrefs(latest.id).segment('signals') : `/sites/${site.id}`) as Route);
}
