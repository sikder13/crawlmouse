import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { restoreAccount } from '@/lib/v2/account/deletion';
import { postDeletionLink } from '@/lib/v2/account/deletion-link';
import { routeDeletionPorts } from '@/lib/v2/account/deletion-ports';
import { notFound } from '@/lib/v2/account/route';

/**
 * The restore page's button (D4): undoes a confirmed deletion inside its seven days, by the link's
 * token read from its cookie. POST only. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return postDeletionLink(req, resolveOrigin(req), 'restore', restoreAccount, () =>
    routeDeletionPorts(supabaseAdmin(), req.headers.get('cookie')),
  );
}
