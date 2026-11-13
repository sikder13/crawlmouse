import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { linkToken } from '@/lib/v2/account/link-cookie';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { acceptInvite } from '@/lib/v2/agency/seats';
import { supabaseSeatsStore } from '@/lib/v2/agency/seats-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept an invitation from the page its link landed on (CC-31 D3). The caller is signed in and need
 * hold no seat yet; the token in the `cm_link_invite` cookie names the invitation, and
 * `accept_seat_invite` accepts it only for the user whose address is the invited one. The token is
 * read from the cookie, not from the URL or the body. POST only: a GET here is answered 405 by Next,
 * so a link scanner cannot accept. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  return acceptInvite(
    {
      store: supabaseSeatsStore(supabaseAdmin()),
      capture: agencyCaptureFor(req),
      now: () => new Date(),
    },
    {
      userId: user.id,
      token: linkToken(req.headers.get('cookie'), 'invite'),
      secure: new URL(req.url).protocol === 'https:',
    },
    await readBody(req),
  );
}
