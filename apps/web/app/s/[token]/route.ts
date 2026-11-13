import { checksPublicEnabled } from '@/lib/auth/flags';
import { getClientIp } from '@/lib/client-ip';
import { resolveOrigin } from '@/lib/origin';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ipHash } from '@/lib/v2/account/rate-keys';
import { notFound } from '@/lib/v2/account/route';
import { agencyCaptureFor } from '@/lib/v2/agency/events';
import { isShareToken, openShareLink, shareNotFound, shareTooMany } from '@/lib/v2/reports/share';
import { supabaseShareFiles, supabaseShareStore } from '@/lib/v2/reports/share-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Links one address may open in an hour: a reader's own use is far below it. */
const PER_IP_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A share link (CC-31 D7): `/s/<token>` opens one report for whoever holds the token, with no
 * account. A 404 with V2_CHECKS_PUBLIC unset, for a value that is not token-shaped (before the rate
 * limit and any database read) and for a token no link holds; 410 for a link that has expired or
 * was revoked. A link that opens is counted, and answered with a redirect: to a signed URL of the
 * stored file, or to the proof page with the token moved into that page's cookie
 * (`openShareLink`). The token is the credential, so the service-role client is made for whoever
 * sends one.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  if (!isShareToken(token)) return shareNotFound();

  const limit = await checkRateLimit(
    `share-open:ip:${ipHash(getClientIp(req))}`,
    PER_IP_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) {
    return shareTooMany(Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000));
  }
  const admin = supabaseAdmin();
  return openShareLink(
    {
      store: supabaseShareStore(admin),
      files: supabaseShareFiles(admin),
      capture: agencyCaptureFor(req),
      now: () => new Date(),
    },
    resolveOrigin(req),
    token,
  );
}
