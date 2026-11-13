import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { resolveOrigin } from '@/lib/origin';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound, refuse } from '@/lib/v2/account/route';
import { isToken } from '@/lib/v2/account/tokens';
import { oneClickDecline, oneClickFields } from '@/lib/v2/agency/schedules';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One-click requests one address may send in an hour. */
const PER_IP_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

/**
 * "Don't ask me again", as a person follows the link in the mail that asks them to confirm a
 * client's reports (CC-31 D8, owner ruling on Q42): its token, the address's own
 * (`lib/v2/mail/report-decline-token.ts`), goes into the `cm_link_report_decline` cookie and the browser is sent to `/s/decline`, whose
 * address holds no token. Nothing changes here; the refusal is that page's POST. A 404 with
 * V2_CHECKS_PUBLIC unset.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'reportDecline', token);
}

/**
 * The same address as a mail client posts to it for a one-click unsubscribe (RFC 8058): the body is
 * `List-Unsubscribe=One-Click`, form-encoded or as multipart form data, there is no cookie, and the
 * token in the path is the credential. It records the refusal (`oneClickDecline`). A token that is
 * not token-shaped is a 404 before the rate limit and any database call.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  if (!isToken(token)) return notFound();
  const limit = await checkRateLimit(
    `report-decline-click:ip:${ipHash(getClientIp(req))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) return refuse(429, 'rate_limited');
  return oneClickDecline(
    { store: supabaseSchedulesStore(supabaseAdmin()), now: () => new Date() },
    token,
    await oneClickFields(req),
  );
}
