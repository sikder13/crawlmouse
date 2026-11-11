import { checksPublicEnabled } from '@/lib/auth/flags';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor } from '@/lib/v2/account/events';
import { emailDeveloper } from '@/lib/v2/account/fixes';
import { supabaseFixesStore } from '@/lib/v2/account/fixes-store';
import { isId, notFound, readBody, refuse } from '@/lib/v2/account/route';
import { inngest } from '../../../../../../../inngest/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The fix page's limits (questions.md Q8): 3 per fix per day, 5 per user per hour, failing closed. */
const PER_FIX_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const PER_USER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Asks for a fix's packet to be emailed to a developer (CC-26b D9): a 404 with V2_CHECKS_PUBLIC
 * unset, for a fix that is not the caller's, and for no such fix. The limits run after the
 * membership check, so a stranger spends no one's budget. Nothing is emailed here (CC-28 sends).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  return emailDeveloper(
    {
      session: sb,
      store: supabaseFixesStore(supabaseAdmin()),
      capture: captureFor(req),
      now: () => new Date(),
      limits: {
        perFix: () =>
          checkRateLimit(`fix-email:fix:${id}`, PER_FIX_DAY, DAY_MS, { failClosed: true }),
        perUser: () =>
          checkRateLimit(`fix-email:user:${user.id}`, PER_USER_HOUR, HOUR_MS, { failClosed: true }),
      },
      send: (event) => inngest.send(event),
    },
    { fixId: id, userId: user.id },
    await readBody(req),
  );
}
