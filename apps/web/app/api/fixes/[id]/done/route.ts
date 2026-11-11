import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { isCrawlPaused } from '@/lib/crawl-pause';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor } from '@/lib/v2/account/events';
import { markDone } from '@/lib/v2/account/fixes';
import { supabaseFixesStore } from '@/lib/v2/account/fixes-store';
import { isId, notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { supabaseRequestRecheck } from '@/lib/v2/account/sites-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mark a fix done (CC-26b D5, the markDone action): a 404 with V2_CHECKS_PUBLIC unset, for a fix
 * that is not the caller's and for no such fix; 503 while crawls are paused or the pipeline is off,
 * since the mark requests a fix re-check. Any member whose seat covers the fix's site may mark it
 * (questions.md Q12). There is no undo (owner ruling Q4).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  // Before the fix is read there is no site page to go back to: a form goes to the dashboard.
  if (isCrawlPaused()) return refuseTo(req, '/dashboard', 503, 'paused');
  if (!pipelineEnabled()) return refuseTo(req, '/dashboard', 503, 'unavailable');

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

  const admin = supabaseAdmin();
  const body = await readBody(req);
  return markDone(
    {
      session: sb,
      store: supabaseFixesStore(admin),
      capture: captureFor(req),
      now: () => new Date(),
      requestRecheck: supabaseRequestRecheck(admin),
    },
    { fixId: id, userId: user.id },
    body?.kind ?? 'json',
  );
}
