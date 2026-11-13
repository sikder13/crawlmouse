import { checksPublicEnabled } from '@/lib/auth/flags';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';
import { isId, meantMethod, notFound, readBody, refuse, refuseTo } from '@/lib/v2/account/route';
import { CLIENT_REPORTS_PAGE, clearSchedule, saveSchedule } from '@/lib/v2/agency/schedules';
import { clientReportsGate, clientSiteOf } from '@/lib/v2/agency/schedules-caller';
import { supabaseSchedulesStore } from '@/lib/v2/agency/schedules-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ siteId: string }> };

/** Save a client site's report schedule: `{cadence, isoWeekday, timeLocal, timezone, sendWhenUnchanged}` (CC-31 D8). */
export async function PUT(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, 'PUT');
}

/** Remove a client site's report schedule: no more reports are sent for it. */
export async function DELETE(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, 'DELETE');
}

/** A form's PUT or DELETE, posted with `_method` (`meantMethod`). */
export async function POST(req: Request, ctx: Context) {
  if (!checksPublicEnabled()) return notFound();
  return act(req, ctx, null);
}

/**
 * For a seat that covers the site (`is_member_for_site`: any other site is a 404) and whose role
 * `seat_may` lets schedule reports (the owner or an account manager: docs/specs/v2/31-agency.md §3;
 * a developer is 403), both asked through the caller's own session before the service-role client is
 * made. Client reports are Agency's: any other plan is 402 with the gate's name.
 *
 * The path is `…/schedules/site/<id>`: directly under `/api/report-files`, `schedules/<id>` would be
 * read as a report's `[id]/…` routes too, and the route registry holds each path to one row.
 */
async function act(req: Request, { params }: Context, method: 'PUT' | 'DELETE' | null) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return refuse(401, 'auth_required');

  const { siteId } = await params;
  if (!isId(siteId)) return notFound();
  const { data: member, error: memberError } = await sb.rpc('is_member_for_site', {
    p_site: siteId,
  });
  if (memberError) throw new Error(`is_member_for_site failed: ${memberError.message}`);
  if (member !== true) return notFound();
  const site = await clientSiteOf(sb, siteId);
  if (site === null) return notFound();
  const { data: allowed, error: guardError } = await sb.rpc('seat_may', {
    p_account: site.accountId,
    p_action: 'schedule_report',
  });
  if (guardError) throw new Error(`seat_may failed: ${guardError.message}`);
  if (allowed !== true) return refuseTo(req, CLIENT_REPORTS_PAGE, 403, 'role_refused');

  const body = await readBody(req);
  const kind = body?.kind ?? 'json';
  const gated = await clientReportsGate(sb, site.accountId, kind, new Date());
  if (gated) return gated;

  const meant = body === null ? null : meantMethod(req, body);
  const verb = method ?? meant?.method;
  const store = supabaseSchedulesStore(supabaseAdmin());
  if (verb === 'DELETE') return clearSchedule({ store }, site, kind);
  if (verb !== 'PUT') return refuse(405, 'method_not_allowed');
  return saveSchedule(
    { store, now: () => new Date() },
    site,
    body && meant ? { kind: body.kind, fields: meant.fields } : null,
  );
}
