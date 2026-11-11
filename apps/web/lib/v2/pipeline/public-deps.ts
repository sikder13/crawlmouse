/**
 * `PublicCheckDeps` and the viewer for a request (CC-22b D3), for the audit pages.
 *
 * The check, its site and its rows are read through the service role, after `readableCheck` has
 * decided the viewer may read them. Membership is asked through the caller's own session, so the
 * database's row-level policy on `sites` (`is_member_for_site`) answers it. The plan is read from
 * the account's row through the service role, which `loadCheckFor` asks for a kept check only, after
 * the membership answer.
 */
import 'server-only';
import { supabaseAdmin } from '../../supabase/admin';
import { supabaseServer } from '../../supabase/server';
import { supabaseEvidenceStore } from './evidence';
import { supabaseCheckReader } from './load';
import { ACCOUNT_CLOCK_COLUMNS, clockFromAccountRow, fixPlanOf } from './load-for';
import type { PublicCheckDeps, Viewer } from './public';

export interface RequestAccess {
  deps: PublicCheckDeps;
  viewer: Viewer;
}

/** The deps and the viewer of the request being served: one session client answers both. */
export async function requestAccess(): Promise<RequestAccess> {
  const session = await supabaseServer();
  const admin = supabaseAdmin();
  const { data } = await session.auth.getUser();
  const viewer: Viewer = { userId: data.user?.id ?? null };
  const now = () => Date.now();
  return {
    viewer,
    deps: {
      read: supabaseCheckReader(admin),
      evidence: supabaseEvidenceStore(admin),
      now,
      async isMember(siteId, userId) {
        // The session's own user is the one the policy answers for; any other is refused here.
        if (userId !== viewer.userId) return false;
        const { data: rows, error } = await session.from('sites').select('id').eq('id', siteId);
        if (error) throw new Error(`public check: reading the site as its member: ${error.code}`);
        return rows.length === 1;
      },
      async planOf(accountId) {
        const { data: row, error } = await admin
          .from('accounts')
          .select(ACCOUNT_CLOCK_COLUMNS)
          .eq('id', accountId)
          .maybeSingle();
        if (error) throw new Error(`public check: reading the account's plan: ${error.code}`);
        if (!row) throw new Error("public check: the site's account was not found");
        return fixPlanOf(clockFromAccountRow(row as Record<string, unknown>), new Date(now()));
      },
    },
  };
}
