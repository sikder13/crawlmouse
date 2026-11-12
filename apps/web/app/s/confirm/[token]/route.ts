import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { notFound } from '@/lib/v2/account/route';

/**
 * The confirmation link of a client report's recipient (CC-31 D8): its token goes into the
 * `cm_link_report_confirm` cookie and the browser is sent to `/s/confirm`, whose address holds no
 * token. Nothing changes here; confirming is that page's POST. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'reportConfirm', token);
}
