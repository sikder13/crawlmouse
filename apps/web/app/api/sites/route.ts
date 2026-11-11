import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { scheduleFor } from '@/lib/auth/schedule';
import { isCrawlPaused } from '@/lib/crawl-pause';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor } from '@/lib/v2/account/events';
import { notFound, paywall, readBody, refuse, respond } from '@/lib/v2/account/route';
import { admittedHost, parseAddBody, tooSoon } from '@/lib/v2/account/sites';
import { supabaseAddSite } from '@/lib/v2/account/sites-store';
import { loadViewer } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Add a site to the account the caller acts in (CC-26b D6, ARCH-2 §5 "First-run dashboard"):
 * `{url}`. A 404 with V2_CHECKS_PUBLIC unset; 503 while crawls are paused or the pipeline is off,
 * since adding a site requests its first audit. The caller's seat on the account must be the owner's
 * or an account manager's, and unscoped, so a manager scoped to some clients cannot add a site they
 * would not then see (questions.md Q12). The host is canonicalised and admitted by the engine's SSRF
 * guard; the slot count, the per-day bound on first audits and the insert are one SQL transaction
 * (`add_site`). A form is answered with a 303 to the new site's page, JSON with its ids.
 */
export async function POST(req: Request) {
  if (!checksPublicEnabled()) return notFound();
  if (isCrawlPaused()) return refuse(503, 'crawl_paused');
  if (!pipelineEnabled()) return refuse(503, 'pipeline_off');

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const viewer = await loadViewer();
  if (viewer.kind === 'signed_out') return refuse(401, 'auth_required');
  if (viewer.kind === 'no_account') return refuse(409, 'no_account');
  if (viewer.kind === 'ambiguous') return refuse(409, 'account_ambiguous');
  const { account, seat, tier, limits } = viewer.viewer;

  const { data: role, error: roleError } = await sb.rpc('member_role', { p_account: account.id });
  if (roleError) throw new Error(`member_role failed: ${roleError.message}`);
  if (role !== 'owner' && role !== 'account_manager') return refuse(403, 'role_refused');
  const scope = await sb.from('seats').select('client_scope_all').eq('id', seat.id).maybeSingle();
  if (scope.error) throw new Error(`seats read failed: ${scope.error.message}`);
  if ((scope.data as { client_scope_all?: unknown } | null)?.client_scope_all !== true) {
    return refuse(403, 'scoped_seat');
  }

  const body = await readBody(req);
  const input = body && parseAddBody(body.fields);
  if (!body || !input) return refuse(400, 'invalid');
  const admitted = await admittedHost(input.url);
  if (!admitted.ok) return refuse(admitted.error === 'invalid_host' ? 400 : 422, admitted.error);

  // The schedule is the door's rule (lib/auth/schedule.ts): a Free account's first site is checked
  // monthly. Whether this is the first is read here; add_site counts the slots under its lock.
  const live = await sb
    .from('sites')
    .select('id')
    .eq('account_id', account.id)
    .is('staging_of_site_id', null)
    .is('removed_at', null);
  if (live.error) throw new Error(`sites read failed: ${live.error.message}`);
  const now = new Date();

  const added = await supabaseAddSite(supabaseAdmin())({
    accountId: account.id,
    ownerSeatId: seat.id,
    host: admitted.host,
    schedule: scheduleFor(tier, (live.data ?? []).length === 0, now, account.timezone),
    limit: limits.sites,
    requestedByUserId: user.id,
  });
  switch (added.outcome) {
    case 'created': {
      const capture = captureFor(req);
      await capture('site_added', account.id, { n: added.n });
      await capture('check_started', account.id, { trigger: 'first_audit' });
      return body.kind === 'form'
        ? respond('form', `/sites/${added.siteId}`)
        : Response.json({ siteId: added.siteId, checkId: added.checkId }, { status: 201 });
    }
    case 'exists':
      return refuse(409, 'site_exists', { siteId: added.siteId });
    case 'full':
      return paywall('sites');
    case 'adds_capped':
      return tooSoon('adds_capped', added.nextAllowedAt);
  }
}
