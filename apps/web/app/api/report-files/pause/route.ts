import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { linkToken } from '@/lib/v2/account/link-cookie';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound, readBody, refuse } from '@/lib/v2/account/route';
import { useRecipientLink } from '@/lib/v2/agency/schedules';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Presses one address may send in an hour. */
const PER_IP_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A client report's recipient pauses the reports, from the page the pause link landed on (CC-31 D8):
 * none is sent until the account resumes them.
 * The token in the `cm_link_report_pause` cookie, which the link's own GET set, is the credential: it is read
 * from the cookie and from nowhere else, and the person need hold no account. POST only: a GET here
 * is answered 405 by Next, so a link scanner changes nothing. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  const limit = await checkRateLimit(
    `report-pause-use:ip:${ipHash(getClientIp(req))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) return refuse(429, 'rate_limited');
  return useRecipientLink(
    { store: supabaseSchedulesStore(supabaseAdmin()), now: () => new Date() },
    'pause',
    linkToken(req.headers.get('cookie'), 'reportPause'),
    await readBody(req),
  );
}
