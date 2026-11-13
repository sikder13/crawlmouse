import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { isId, notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { loadViewer } from '@/lib/v2/account/viewer';
import { inviteMailPerDay, resendInvite, SEATS_PAGE } from '@/lib/v2/agency/seats';
import { inngestInviteMail, supabaseSeatsStore } from '@/lib/v2/agency/seats-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The bounds of POST /api/seats: a resend counts into the same two buckets. */
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_IP_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Send an invited seat its next invitation (CC-31 D3): the link sent before stops working. A 404
 * with V2_CHECKS_PUBLIC unset, and for a seat that is not one of the account the caller acts in.
 * The caller's role must be one `seat_may` lets invite, asked through their own session before the
 * service-role client is made.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { id } = await params;
  if (!isId(id)) return notFound();
  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return refuse(401, 'auth_required');
  if (viewer.kind !== 'viewer') return notFound();
  const { id: accountId, state } = viewer.viewer.account;

  const { data: allowed, error } = await sb.rpc('seat_may', {
    p_account: accountId,
    p_action: 'invite_seat',
  });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  if (allowed !== true) return refuseTo(req, SEATS_PAGE, 403, 'role_refused');

  const ip = getClientIp(req);
  const body = await readBody(req);
  return resendInvite(
    {
      store: supabaseSeatsStore(supabaseAdmin()),
      mail: inngestInviteMail(),
      limits: {
        perAccount: () =>
          checkRateLimit(`seat-invite:account:${accountId}`, inviteMailPerDay(state), DAY_MS, {
            failClosed: true,
          }),
        perIp: () =>
          checkRateLimit(`seat-invite:ip:${ipHash(ip)}`, PER_IP_HOUR, HOUR_MS, {
            failClosed: true,
          }),
      },
      now: () => new Date(),
    },
    accountId,
    id,
    body?.kind ?? 'json',
  );
}
