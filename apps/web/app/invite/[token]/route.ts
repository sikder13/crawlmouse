import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { notFound } from '@/lib/v2/account/route';

/**
 * An invitation's emailed link (CC-31 D3): its token goes into the `cm_link_invite` cookie and the
 * browser is sent to `/invite`, whose address holds no token. Nothing changes here; accepting is the
 * page's POST. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'invite', token);
}
