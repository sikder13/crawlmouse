import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { loadViewer } from '@/lib/v2/account/viewer';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { inviteSeat, SEATS_PAGE } from '@/lib/v2/agency/seats';
import { inngestInviteMail, supabaseSeatsStore } from '@/lib/v2/agency/seats-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Invitation mail an account may ask for in a day, and one address in an hour; both fail closed. */
const PER_ACCOUNT_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_IP_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Invite a person to the account the caller acts in (CC-31 D3): `{email, role, scope}`, where
 * `scope` is `all` or the ids of the client sites the seat covers. A 404 with V2_CHECKS_PUBLIC
 * unset. The caller's role must be one `seat_may` lets invite (the owner:
 * docs/specs/v2/31-agency.md §3), asked through their own session before the service-role client is
 * made. The seat limit passed to `invite_seat` is the viewer's, never a value of the request.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return refuse(401, 'auth_required');
  if (viewer.kind === 'no_account') return refuseTo(req, SEATS_PAGE, 409, 'no_account');
  if (viewer.kind === 'ambiguous') return refuseTo(req, SEATS_PAGE, 409, 'account_ambiguous');
  const { account, tier, limits, gates } = viewer.viewer;

  const { data: allowed, error } = await sb.rpc('seat_may', {
    p_account: account.id,
    p_action: 'invite_seat',
  });
  if (error) throw new Error(`seat_may failed: ${error.message}`);
  if (allowed !== true) return refuseTo(req, SEATS_PAGE, 403, 'role_refused');

  const ip = getClientIp(req);
  return inviteSeat(
    {
      store: supabaseSeatsStore(supabaseAdmin()),
      capture: agencyCaptureFor(req),
      mail: inngestInviteMail(),
      limits: {
        perAccount: () =>
          checkRateLimit(`seat-invite:account:${account.id}`, PER_ACCOUNT_DAY, DAY_MS, {
            failClosed: true,
          }),
        perIp: () =>
          checkRateLimit(`seat-invite:ip:${ipHash(ip)}`, PER_IP_HOUR, HOUR_MS, {
            failClosed: true,
          }),
      },
      now: () => new Date(),
    },
    {
      accountId: account.id,
      tier,
      seatLimit: limits.seats,
      canBuySeats: gates.agencyBranding,
    },
    await readBody(req),
  );
}
