import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { notFound } from '@/lib/v2/account/route';

/**
 * The emailed deletion confirmation link (D4). It changes nothing: the token goes into the flow's
 * cookie and the answer is a 303 to /account/delete, whose URL holds no token. A 404 with
 * V2_CHECKS_PUBLIC unset.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'deleteConfirm', token);
}
