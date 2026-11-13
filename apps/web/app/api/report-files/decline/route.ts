import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';
import { declineFromPage } from '@/lib/v2/agency/schedules';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Presses one address may send in an hour. */
const PER_IP_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A client report's recipient answers "Don't ask me again" (CC-31 D8, owner ruling on Q42): no
 * request to confirm is sent to their address for that site again, and no report.
 * The token is a link cookie's and is read from nowhere else: the decline link's own
 * (`cm_link_report_decline`), or the cookie of the confirmation page or the pause page when the form
 * was on one of them and says so (`from`). The person need hold no account. POST only: a GET here is
 * answered 405 by Next, so a link scanner changes nothing. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const limit = await checkRateLimit(
    `report-decline-use:ip:${ipHash(getClientIp(req))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) return refuse(429, 'rate_limited');
  return declineFromPage(
    { store: supabaseSchedulesStore(supabaseAdmin()), now: () => new Date() },
    req.headers.get('cookie'),
    await readBody(req),
  );
}
