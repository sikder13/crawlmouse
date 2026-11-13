import '../../styles/v2/tokens.css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LiveActions } from '@/components/v2/screens/account/LiveActions';
import { InviteScreen } from '@/components/v2/screens/invite/InviteScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { LINK_FLOWS } from '@/lib/v2/account/link-cookie';
import { isToken } from '@/lib/v2/account/tokens';
import { supabaseSeatsStore } from '@/lib/v2/agency/seats-store';
import { noticeLine } from '@/lib/v2/copy/notices';
import { inviteView } from '@/lib/v2/view/seats';

// Read per request: the page is the cookie's, and a build with the flag off would prerender a 404.
export const dynamic = 'force-dynamic';

// Reached from an emailed link: never a search result.
export const metadata: Metadata = {
  title: 'An invitation to Crawlmouse',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

/**
 * Where an invitation's link lands (CC-31 D3): `/invite/[token]` put the token in the
 * `cm_link_invite` cookie, so this page's address holds none. It reads what the invitation is
 * (`read_seat_invite`, which returns no address) and changes nothing; accepting is the form's POST
 * to /api/seats/accept. With no token in the cookie it says to open the mailed link again, and
 * names no cause of a link that cannot be used; unless the accept route sent the form back for a
 * link that is gone (it cleared the cookie), which the page then says. A 404 until
 * V2_CHECKS_PUBLIC=1.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!checksPublicEnabled()) return notFound();
  const raw = (await cookies()).get(LINK_FLOWS.invite.cookie)?.value;
  const session = await supabaseServer();
  const {
    data: { user },
  } = await session.auth.getUser();
  const invitation = isToken(raw)
    ? await supabaseSeatsStore(supabaseAdmin()).readInvite(raw, new Date())
    : 'no_link';
  const notice = noticeLine(await searchParams, 'UTC');
  return (
    <LiveActions>
      <InviteScreen data={inviteView(invitation, user !== null, notice)} />
    </LiveActions>
  );
}
