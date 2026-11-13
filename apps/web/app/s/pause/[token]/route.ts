import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { resolveOrigin } from '@/lib/origin';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound, refuse } from '@/lib/v2/account/route';
import { isToken } from '@/lib/v2/account/tokens';
import { oneClickFields, oneClickPause } from '@/lib/v2/agency/schedules';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One-click requests one address may send in an hour. */
const PER_IP_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The pause link of a client report (CC-31 D8), as a person follows it: its token goes into the
 * `cm_link_report_pause` cookie and the browser is sent to `/s/pause`, whose address holds no token.
 * Nothing changes here; pausing is that page's POST. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'reportPause', token);
}

/**
 * The same address as a mail client posts to it for a one-click unsubscribe (RFC 8058): the body is
 * `List-Unsubscribe=One-Click`, form-encoded or as multipart form data, there is no cookie, and the
 * token in the path is the credential.
 * It pauses the schedule (`oneClickPause`). A token that is not token-shaped is a 404 before the
 * rate limit and any database call.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  if (!isToken(token)) return notFound();
  const limit = await checkRateLimit(
    `report-pause-click:ip:${ipHash(getClientIp(req))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) return refuse(429, 'rate_limited');
  return oneClickPause(
    { store: supabaseSchedulesStore(supabaseAdmin()), now: () => new Date() },
    token,
    await oneClickFields(req),
  );
}
