/**
 * The v1 audits behind the dashboard's "Your earlier audits are still at their links" (CC-36 D5).
 *
 * Read through the service role and keyed on the signed-in viewer's own user id, never the account
 * owner's: a v1 audit id is a capability URL (`/audit/<id>`), so the list may only show audits that
 * are already the viewer's. The filter on `user_id` is the one row security applies to the
 * viewer's own session (`audits_owner_read`), so this reads no row that session could not.
 * Completed audits only, newest first, at most `EARLIER_AUDITS_LIMIT`, and none whose expiry has
 * passed: the expiry clause is the one v1's own list sends (`lib/audits.ts`), with `now` given.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EarlierAudit } from '@/lib/v2/view/dashboard';

export const EARLIER_AUDITS_LIMIT = 20;

export async function readEarlierAudits(
  admin: SupabaseClient,
  userId: string,
  now: Date,
): Promise<EarlierAudit[]> {
  const { data, error } = await admin
    .from('audits')
    .select('id, url, grade, completed_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order('completed_at', { ascending: false })
    .limit(EARLIER_AUDITS_LIMIT);
  if (error) throw new Error(`earlier audits: read failed: ${error.message}`);
  return (data ?? []).map(
    (r: { id: string; url: string; grade: string | null; completed_at: string }) => ({
      id: r.id,
      url: r.url,
      grade: r.grade,
      completedAt: r.completed_at,
    }),
  );
}
