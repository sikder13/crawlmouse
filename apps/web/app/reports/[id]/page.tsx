import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ProofScreen } from '@/components/v2/screens/proof/ProofScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId } from '@/lib/v2/account/route';
import { memberProof, pageCapture } from '@/lib/v2/reports/share-proof';
import { supabaseShareFiles } from '@/lib/v2/reports/share-store';
import { proofView } from '@/lib/v2/view/proof';

// Read per request: a build with the flag off would otherwise prerender this page as its 404.
export const dynamic = 'force-dynamic';

// A signed-in page: never a search result.
export const metadata: Metadata = {
  title: 'Report',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * A proof page, for a signed-in member whose seat covers its site (CC-31 D6b): the page a client is
 * shown through the report's share link, read here without one. A 404 while V2_CHECKS_PUBLIC is off,
 * the sign-in page for a caller who is not signed in, and a 404 for a report the caller's own
 * session does not read, one that is not a proof page, and one whose document is not stored.
 */
export default async function ReportProofPage({ params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!isId(id)) return notFound();
  const admin = supabaseAdmin();
  const proof = await memberProof({ session, admin, files: supabaseShareFiles(admin) }, id);
  if (proof === null) return notFound();
  await (
    await pageCapture()
  )('proof_viewed', proof.accountId, { via: 'account' });
  return <ProofScreen data={proofView(proof.doc)} />;
}
