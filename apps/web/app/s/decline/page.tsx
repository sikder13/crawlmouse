import '../../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { RecipientLinkScreen } from '@/components/v2/screens/share/RecipientLinkScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import { noticeOf } from '@/lib/v2/account/route';
import { isToken } from '@/lib/v2/account/tokens';
import { recipientLinkView } from '@/lib/v2/agency/schedules-link-view';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

// Read per request: the page is the cookie's, and a build with the flag off would prerender a 404.
export const dynamic = 'force-dynamic';

// Reached from a mailed link: never a search result, and it sends no Referer onward.
export const metadata: Metadata = {
  title: 'Reports from a Crawlmouse customer',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  referrer: 'no-referrer',
};

/**
 * Where "Don't ask me again" lands (CC-31 D8, owner ruling on Q42): `/s/decline/[token]` put the
 * token in the link flow's cookie, so this page's address holds none. It reads what the link is
 * (`read_report_link`, which returns no address) and changes nothing; the refusal is the form's
 * POST to /api/report-files/decline. A token the read no longer answers for is still offered the
 * button: a refusal does not expire. A 404 until V2_CHECKS_PUBLIC=1.
 */
export default async function ReportDeclinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const raw = (await cookies()).get(LINK_FLOWS.reportDecline.cookie)?.value;
  const link = isToken(raw)
    ? await supabaseSchedulesStore(supabaseAdmin()).readLink(raw, new Date())
    : null;
  const notice = noticeOf(await searchParams)?.code ?? null;
  return (
    <LiveActions>
      <RecipientLinkScreen data={recipientLinkView('decline', link, notice, isToken(raw))} />
    </LiveActions>
  );
}
