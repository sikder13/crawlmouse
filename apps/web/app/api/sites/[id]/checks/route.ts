import { checksPublicEnabled, pipelineEnabled } from '@/lib/auth/flags';
import { isCrawlPaused } from '@/lib/crawl-pause';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { captureFor, checkStarted } from '@/lib/v2/account/events';
import {
  isId,
  notFound,
  readBody,
  refuse,
  refuseTo,
  respond,
  tooSoonTo,
} from '@/lib/v2/account/route';
import { readSite } from '@/lib/v2/account/sites';
import { supabaseRequestRecheck } from '@/lib/v2/account/sites-store';
import { readEntitlement } from '@/lib/v2/account/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Re-check a site now (CC-26b D4, ARCH-2 §4.3 "Manual re-check"). A 404 with V2_CHECKS_PUBLIC unset;
 * 503 while crawls are paused or the pipeline is off. Any member whose seat covers the site may ask
 * (questions.md Q12); a site of another account, a malformed id and a removed site are the same 404.
 * The cap is the site's own account's (`manualChecksPerSiteDay`), and it is enforced in the statement
 * that records the request (`request_capped_check`), so two concurrent posts cannot both pass it; a
 * capped request is 429 with Retry-After. A request over the day's `global:audits:day` ceiling,
 * counted in the same statement, is 503 `capacity`. A repeat inside the 2-minute bucket finds the
 * queued check and is answered with it, `created: false`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checksPublicEnabled()) return notFound();
  const { id } = await params;
  // The site's page, or the dashboard for an id that names none (it is a 404 once signed in).
  const back = isId(id) ? `/sites/${id}` : '/dashboard';
  if (isCrawlPaused()) return refuseTo(req, back, 503, 'paused');
  if (!pipelineEnabled()) return refuseTo(req, back, 503, 'unavailable');

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  if (!isId(id)) return notFound();
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', { p_site: id });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const site = await readSite(sb, id);
  if (site === null || site.removed_at !== null) return notFound();
  if (site.paused_reason !== null) {
    return refuseTo(req, back, 409, 'site_paused', { pausedReason: site.paused_reason });
  }
  const entitlement = await readEntitlement(sb, site.account_id, new Date());
  if (entitlement === null) return notFound();

  // A button posts an empty form; a script may post `{}`. Neither carries a field.
  const body = await readBody(req);
  if (body !== null && Object.keys(body.fields).length > 0)
    return refuseTo(req, back, 400, 'invalid');

  const outcome = await supabaseRequestRecheck(supabaseAdmin())({
    siteId: id,
    trigger: 'manual',
    cap: entitlement.gates.manualChecksPerSiteDay,
    requestedByUserId: user.id,
  });
  if (outcome.queued) {
    if (outcome.created) {
      await captureFor(req)(
        'check_started',
        site.account_id,
        checkStarted('manual', outcome.checkId),
      );
    }
    return body?.kind === 'form'
      ? respond('form', `/sites/${id}`)
      : Response.json({ checkId: outcome.checkId, created: outcome.created }, { status: 202 });
  }
  switch (outcome.reason) {
    case 'capped':
      return tooSoonTo(req, back, 'capped', outcome.nextAllowedAt);
    case 'check_running':
      return refuseTo(req, back, 409, 'check_running', { checkId: outcome.checkId });
    case 'recently_checked':
      return tooSoonTo(req, back, 'recently_checked', outcome.nextAllowedAt);
    case 'capacity':
      return refuseTo(req, back, 503, 'capacity');
    case 'removed':
      return notFound();
    case 'paused':
      return refuseTo(req, back, 409, 'site_paused');
  }
}
