import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { landLink } from '@/lib/v2/account/link-cookie';
import { notFound } from '@/lib/v2/account/route';

/** The emailed confirmation link: its token goes into the flow's cookie, and nothing changes. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { token } = await params;
  return landLink(resolveOrigin(req), 'emailChange', token);
}
