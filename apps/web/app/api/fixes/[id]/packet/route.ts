import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor } from '@/lib/v2/account/events';
import { packet } from '@/lib/v2/account/fixes';
import { supabaseFixesStore } from '@/lib/v2/account/fixes-store';
import { isId, notFound, refuse } from '@/lib/v2/account/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A fix's packet (CC-26b D9, the copyFix action): a 404 with V2_CHECKS_PUBLIC unset, for a fix that
 * is not the caller's, and for no such fix; 402 `packets` for a fix the tier does not see.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');
  const { id } = await params;
  if (!isId(id)) return notFound();
  const { data: member, error } = await sb.rpc('is_member_for_fix', { p_fix: id });
  if (error) throw new Error(`is_member_for_fix failed: ${error.message}`);
  if (member !== true) return notFound();

  return packet(
    {
      session: sb,
      store: supabaseFixesStore(supabaseAdmin()),
      capture: captureFor(req),
      now: () => new Date(),
    },
    { fixId: id, userId: user.id },
  );
}
