import { checksPublicEnabled } from '@/lib/auth/flags';
import { resolveOrigin } from '@/lib/origin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { confirmDeletion } from '@/lib/v2/account/deletion';
import { postDeletionLink } from '@/lib/v2/account/deletion-link';
import { routeDeletionPorts } from '@/lib/v2/account/deletion-ports';
import { notFound } from '@/lib/v2/account/route';

/**
 * The confirmation page's button (D4): confirms the deletion of the link's token, read from its
 * cookie. Sign-in stops at once (the Auth ban); the Auth user is deleted only by the purge, seven days
 * on. POST only: a link scanner's GET cannot delete. A 404 with V2_CHECKS_PUBLIC unset.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  return postDeletionLink(req, resolveOrigin(req), 'deleteConfirm', confirmDeletion, () =>
    routeDeletionPorts(supabaseAdmin(), req.headers.get('cookie')),
  );
}
