import '../../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ProofScreen } from '@/components/v2/screens/proof/ProofScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site-url';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { isId } from '@/lib/v2/account/route';
import { isShareToken, SHARE_COOKIE, sharedProof } from '@/lib/v2/reports/share';
import { parseStoredDoc } from '@/lib/v2/reports/share-doc';
import { pageCapture } from '@/lib/v2/reports/share-proof';
import { supabaseShareFiles, supabaseShareStore } from '@/lib/v2/reports/share-store';
import { proofView } from '@/lib/v2/view/proof';

/** Views of shared pages one address may ask for in an hour: the link's own bound (`/s/[token]`). */
const PER_IP_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

// Read per request: the page is the cookie's, and a build with the flag off would prerender a 404.
export const dynamic = 'force-dynamic';

// Reached from a share link: never a search result, and it sends no Referer onward.
export const metadata: Metadata = {
  title: 'A shared report',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  referrer: 'no-referrer',
};

/**
 * A proof page opened through its share link (CC-31 D6b, D7). `/s/[token]` put the token in a cookie
 * scoped to this page, so this address holds the report's id and no token. The link must still open
 * (`read_share_link`: not expired, not revoked) and be this report's; anything else is a 404. What
 * is drawn is the report's stored document. A 404 until V2_CHECKS_PUBLIC=1.
 */
export default async function SharedProofPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const { reportId } = await params;
  if (!isId(reportId)) return notFound();
  const raw = (await cookies()).get(SHARE_COOKIE)?.value;
  // No token, no read. With one, the page is bounded for an address as the link itself is, before
  // the link is read; past the bound it is a 404 like any other miss.
  if (!isShareToken(raw)) return notFound();
  const limit = await checkRateLimit(
    `share-view:ip:${ipHash(getClientIp(new Request(siteUrl('/'), { headers: new Headers(await headers()) })))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) return notFound();
  const admin = supabaseAdmin();
  const shared = await sharedProof(
    { store: supabaseShareStore(admin), files: supabaseShareFiles(admin), now: () => new Date() },
    reportId,
    raw,
  );
  const doc = shared && parseStoredDoc(shared.bytes);
  if (!shared || !doc) return notFound();
  await (
    await pageCapture()
  )('proof_viewed', shared.report.accountId, { via: 'share' });
  return <ProofScreen data={proofView(doc)} />;
}
